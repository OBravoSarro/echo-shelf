import type { Audiobook, BookCollection } from '../../domain/audiobook'

export const COLLECTION_NAME_MAX_LENGTH = 60

/** Recorta y colapsa espacios. Devuelve '' si no queda nada util. */
export const normalizeCollectionName = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, COLLECTION_NAME_MAX_LENGTH)

const nameKey = (value: string) =>
  normalizeCollectionName(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase()

export const findCollectionByName = (collections: BookCollection[], name: string): BookCollection | undefined => {
  const key = nameKey(name)
  if (!key) return undefined
  return collections.find((item) => !item.deleted && nameKey(item.name) === key)
}

export const createCollectionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const timestampOf = (collection: Pick<BookCollection, 'updatedAt'>): number => {
  const ms = Date.parse(collection.updatedAt)
  return Number.isFinite(ms) ? ms : 0
}

/** Colecciones visibles en orden de creacion (las mas antiguas primero). */
export const activeCollections = (records: Record<string, BookCollection>): BookCollection[] =>
  Object.values(records)
    .filter((item) => !item.deleted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))

/**
 * Fusiona registros remotos con los locales (last-write-wins por coleccion).
 * Devuelve los registros que han cambiado localmente y los que hay que subir.
 */
export const mergeCollections = (
  local: Record<string, BookCollection>,
  remote: BookCollection[],
): { toApply: BookCollection[]; toPush: BookCollection[] } => {
  const toApply: BookCollection[] = []
  const toPush: BookCollection[] = []
  const remoteIds = new Set<string>()
  for (const item of remote) {
    remoteIds.add(item.id)
    const current = local[item.id]
    if (!current || timestampOf(item) > timestampOf(current)) {
      toApply.push(item)
    } else if (timestampOf(current) > timestampOf(item)) {
      toPush.push(current)
    }
  }
  for (const item of Object.values(local)) {
    if (!remoteIds.has(item.id)) toPush.push(item)
  }
  return { toApply, toPush }
}

/** Calcula el nuevo `bookIds` de cada coleccion tras fijar la pertenencia de un libro. */
export const applyBookMembership = (
  collections: BookCollection[],
  bookId: string,
  selectedIds: ReadonlySet<string>,
): { id: string; bookIds: string[] }[] => {
  const changes: { id: string; bookIds: string[] }[] = []
  for (const item of collections) {
    if (item.deleted) continue
    const has = item.bookIds.includes(bookId)
    const wants = selectedIds.has(item.id)
    if (has === wants) continue
    changes.push({
      id: item.id,
      bookIds: wants ? [...item.bookIds, bookId] : item.bookIds.filter((id) => id !== bookId),
    })
  }
  return changes
}

export const resolveCollectionBooks = (collection: BookCollection, booksById: Map<string, Audiobook>): Audiobook[] =>
  collection.bookIds.flatMap((id) => {
    const book = booksById.get(id)
    return book ? [book] : []
  })

export const formatBookCount = (count: number) => `${count} ${count === 1 ? 'libro' : 'libros'}`
