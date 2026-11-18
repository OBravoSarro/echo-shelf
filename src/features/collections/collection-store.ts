import { create } from 'zustand'
import type { BookCollection } from '../../domain/audiobook'
import { canUseReadingSync, pushCloudCollection, subscribeCloudCollections } from '../../infrastructure/firebase/reading-sync'
import { db } from '../../infrastructure/persistence/db'
import {
  activeCollections,
  applyBookMembership,
  createCollectionId,
  findCollectionByName,
  mergeCollections,
  normalizeCollectionName,
} from './collection-utils'

interface CollectionState {
  /** Todos los registros, incluidos los borrados (tombstones) */
  records: Record<string, BookCollection>
  /** Colecciones visibles, ordenadas por fecha de creacion */
  collections: BookCollection[]
  bootstrapped: boolean
  bootstrap: () => Promise<void>
  /** Crea una coleccion (o devuelve la existente con el mismo nombre). */
  createCollection: (name: string, bookIds?: string[]) => Promise<BookCollection | undefined>
  renameCollection: (id: string, name: string) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  addBooks: (id: string, bookIds: string[]) => Promise<void>
  removeBook: (id: string, bookId: string) => Promise<void>
  setBookIds: (id: string, bookIds: string[]) => Promise<void>
  /** Fija las colecciones a las que pertenece un libro, creando las nuevas por nombre. */
  setBookMembership: (bookId: string, collectionIds: string[], newNames?: string[]) => Promise<void>
  startCloudSync: (userId: string) => void
  stopCloudSync: () => void
}

let cloudUnsubscribe: (() => void) | undefined
let cloudUserId: string | undefined
let bootstrapPromise: Promise<void> | undefined

const withRecords = (records: Record<string, BookCollection>) => ({ records, collections: activeCollections(records) })

const pushIfSyncing = (items: BookCollection[]) => {
  if (!cloudUserId || !canUseReadingSync()) return
  const userId = cloudUserId
  for (const item of items) void pushCloudCollection(userId, item)
}

export const useCollectionStore = create<CollectionState>((set, get) => {
  /** Persiste localmente, actualiza el estado y sube a la nube. */
  const commit = async (items: BookCollection[]) => {
    if (items.length === 0) return
    await db.collections.bulkPut(items)
    const records = { ...get().records }
    for (const item of items) records[item.id] = item
    set(withRecords(records))
    pushIfSyncing(items)
  }

  const touch = (item: BookCollection, patch: Partial<BookCollection>): BookCollection => ({
    ...item,
    ...patch,
    updatedAt: new Date().toISOString(),
  })

  const updateActive = async (id: string, patch: (item: BookCollection) => Partial<BookCollection> | undefined) => {
    const current = get().records[id]
    if (!current || current.deleted) return
    const next = patch(current)
    if (!next) return
    await commit([touch(current, next)])
  }

  const uniqueIds = (ids: string[]) => Array.from(new Set(ids))

  return {
    records: {},
    collections: [],
    bootstrapped: false,
    bootstrap() {
      bootstrapPromise ??= db.collections.toArray().then((stored) => {
        const records = Object.fromEntries(stored.map((item) => [item.id, item]))
        set({ ...withRecords(records), bootstrapped: true })
      })
      return bootstrapPromise
    },
    async createCollection(name, bookIds = []) {
      const normalized = normalizeCollectionName(name)
      if (!normalized) return undefined
      const existing = findCollectionByName(get().collections, normalized)
      if (existing) {
        if (bookIds.length > 0) await get().addBooks(existing.id, bookIds)
        return get().records[existing.id]
      }
      const now = new Date().toISOString()
      const item: BookCollection = {
        id: createCollectionId(),
        name: normalized,
        bookIds: uniqueIds(bookIds),
        createdAt: now,
        updatedAt: now,
      }
      await commit([item])
      return item
    },
    async renameCollection(id, name) {
      const normalized = normalizeCollectionName(name)
      if (!normalized) return
      await updateActive(id, (item) => (item.name === normalized ? undefined : { name: normalized }))
    },
    async deleteCollection(id) {
      await updateActive(id, () => ({ deleted: true, bookIds: [] }))
    },
    async addBooks(id, bookIds) {
      await updateActive(id, (item) => {
        const next = uniqueIds([...item.bookIds, ...bookIds])
        return next.length === item.bookIds.length ? undefined : { bookIds: next }
      })
    },
    async removeBook(id, bookId) {
      await updateActive(id, (item) => (item.bookIds.includes(bookId) ? { bookIds: item.bookIds.filter((value) => value !== bookId) } : undefined))
    },
    async setBookIds(id, bookIds) {
      await updateActive(id, () => ({ bookIds: uniqueIds(bookIds) }))
    },
    async setBookMembership(bookId, collectionIds, newNames = []) {
      const selected = new Set(collectionIds)
      const created: BookCollection[] = []
      const now = new Date().toISOString()
      for (const rawName of newNames) {
        const name = normalizeCollectionName(rawName)
        if (!name) continue
        const existing = findCollectionByName([...get().collections, ...created], name)
        if (existing) {
          selected.add(existing.id)
          continue
        }
        created.push({ id: createCollectionId(), name, bookIds: [bookId], createdAt: now, updatedAt: now })
      }
      const changes = applyBookMembership(get().collections, bookId, selected)
      const records = get().records
      const updated = changes.map((change) => touch(records[change.id], { bookIds: change.bookIds }))
      await commit([...created, ...updated])
    },
    startCloudSync(userId) {
      if (!canUseReadingSync()) return
      if (cloudUserId === userId && cloudUnsubscribe) return
      cloudUnsubscribe?.()
      cloudUserId = userId
      let initialSnapshotHandled = false
      cloudUnsubscribe = subscribeCloudCollections(
        userId,
        async (remote) => {
          // El merge necesita los registros locales cargados de IndexedDB
          await get().bootstrap()
          if (cloudUserId !== userId) return
          const { toApply, toPush } = mergeCollections(get().records, remote)
          if (toApply.length > 0) {
            void db.collections.bulkPut(toApply)
            const records = { ...get().records }
            for (const item of toApply) records[item.id] = item
            set(withRecords(records))
          }
          // Solo en el primer snapshot subimos lo que es mas nuevo en local (cambios offline);
          // despues, cada mutacion local ya se sube en el momento.
          if (!initialSnapshotHandled) {
            initialSnapshotHandled = true
            pushIfSyncing(toPush)
          }
        },
        (error) => {
          console.warn('[collections] cloud sync error', error)
        },
      )
    },
    stopCloudSync() {
      cloudUnsubscribe?.()
      cloudUnsubscribe = undefined
      cloudUserId = undefined
    },
  }
})
