import { create } from 'zustand'
import type { Audiobook, AudioTrack, LibrarySource, ListeningProgress } from '../../domain/audiobook'
import { db } from '../../infrastructure/persistence/db'
import {
  canUseReadingSync,
  fetchBookOrder,
  pushBookOrder,
  pushCloudBookMetadata,
  pushCloudProgress,
  pushCloudReadTracks,
  subscribeCloudBookMetadata,
  subscribeCloudBookStates,
} from '../../infrastructure/firebase/reading-sync'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { scanDriveLibrary } from './drive-scanner'

type MutationSource = 'local' | 'remote'

interface LibraryState {
  source: LibrarySource
  driveRootId?: string
  books: Audiobook[]
  tracksByBook: Record<string, AudioTrack[]>
  progressByBook: Record<string, ListeningProgress>
  readTrackIdsByBook: Record<string, string[]>
  readTrackUpdatedAtByBook: Record<string, number>
  cloudSyncStatus: 'idle' | 'syncing' | 'online' | 'offline' | 'error'
  cloudSyncMessage?: string
  cloudLastSyncedAt?: string
  loading: boolean
  error?: string
  setSource: (source: LibrarySource) => void
  setDriveRootId: (rootId: string) => Promise<void>
  bootstrap: () => Promise<void>
  syncDrive: (accessToken: string, rootId: string) => Promise<void>
  upsertProgress: (progress: ListeningProgress, source?: MutationSource) => Promise<void>
  upsertTrackDuration: (bookId: string, trackId: string, durationSeconds: number) => Promise<void>
  markTrackRead: (bookId: string, trackId: string, read: boolean, source?: MutationSource) => Promise<void>
  startCloudSync: (userId: string) => Promise<void>
  stopCloudSync: () => void
  forceCloudSync: (userId?: string) => Promise<void>
  updateBookMetadata: (
    bookId: string,
    patch: Partial<Pick<Audiobook, 'title' | 'author' | 'narrator' | 'description' | 'coverUrl' | 'coverFileId' | 'publisher' | 'publishedYear' | 'genres' | 'isbn'>>,
  ) => Promise<void>
  reorderBooks: (orderedIds: string[]) => Promise<void>
}

const groupTracksByBook = (tracks: AudioTrack[]): Record<string, AudioTrack[]> => {
  const grouped = tracks.reduce<Record<string, AudioTrack[]>>((acc, track) => {
    if (!acc[track.bookId]) acc[track.bookId] = []
    acc[track.bookId].push(track)
    return acc
  }, {})

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index
      return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
    })
  }

  return grouped
}

const BOOK_ORDER_KEY = 'book-order'

// Aplica un array de IDs ordenado sobre la lista de libros.
// Los libros que no aparezcan en el orden van al final.
const applyOrder = (books: Audiobook[], orderedIds: string[]): Audiobook[] => {
  if (orderedIds.length === 0) return books
  const idIndex = new Map(orderedIds.map((id, i) => [id, i]))
  return [...books].sort((a, b) => {
    const ia = idIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const ib = idIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return ia - ib
  })
}

const loadStoredOrder = async (): Promise<string[]> => {
  const setting = await db.settings.get(BOOK_ORDER_KEY)
  if (!setting) return []
  try {
    const parsed = JSON.parse(setting.value) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const saveStoredOrder = async (orderedIds: string[]): Promise<void> => {
  await db.settings.put({ key: BOOK_ORDER_KEY, value: JSON.stringify(orderedIds), updatedAt: new Date().toISOString() })
}

const METADATA_OVERRIDE_PREFIX = 'book-metadata:'
const TRACK_READ_PREFIX = 'track-read:'
let cloudSyncUnsubscribe: (() => void) | undefined
let cloudMetadataUnsubscribe: (() => void) | undefined
let cloudSyncUserId: string | undefined

const normalizeBook = (book: Audiobook): Audiobook => ({
  ...book,
  author: book.author?.trim() || 'Autor sin clasificar',
  narrator: book.narrator?.trim() || 'Narrador desconocido',
})

const applyMetadataOverride = (book: Audiobook, patch: Partial<Audiobook>): Audiobook => {
  return normalizeBook({
    ...book,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

const applyStoredOverrides = async (books: Audiobook[]): Promise<Audiobook[]> => {
  const overrideSettings = await db.settings.where('key').startsWith(METADATA_OVERRIDE_PREFIX).toArray()
  if (overrideSettings.length === 0) return books.map(normalizeBook)
  const overrides = new Map<string, Partial<Audiobook>>()
  for (const setting of overrideSettings) {
    const bookId = setting.key.slice(METADATA_OVERRIDE_PREFIX.length)
    try {
      const parsed = JSON.parse(setting.value) as Partial<Audiobook>
      overrides.set(bookId, parsed)
    } catch {
      continue
    }
  }
  return books.map((book) => {
    const patch = overrides.get(book.id)
    return patch ? applyMetadataOverride(book, patch) : normalizeBook(book)
  })
}

const loadReadTrackMap = async (): Promise<{ idsByBook: Record<string, string[]>; updatedAtByBook: Record<string, number> }> => {
  const readSettings = await db.settings.where('key').startsWith(TRACK_READ_PREFIX).toArray()
  if (readSettings.length === 0) return { idsByBook: {}, updatedAtByBook: {} }
  const idsByBook: Record<string, string[]> = {}
  const updatedAtByBook: Record<string, number> = {}
  for (const setting of readSettings) {
    const bookId = setting.key.slice(TRACK_READ_PREFIX.length)
    if (!bookId) continue
    try {
      const parsed = JSON.parse(setting.value) as unknown
      if (!Array.isArray(parsed)) continue
      const ids = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      idsByBook[bookId] = Array.from(new Set(ids))
      const updatedAtMs = Date.parse(setting.updatedAt)
      updatedAtByBook[bookId] = Number.isFinite(updatedAtMs) ? updatedAtMs : 0
    } catch {
      continue
    }
  }
  return { idsByBook, updatedAtByBook }
}

const loadMetadataOverrideUpdatedAt = async (): Promise<Record<string, number>> => {
  const overrideSettings = await db.settings.where('key').startsWith(METADATA_OVERRIDE_PREFIX).toArray()
  if (overrideSettings.length === 0) return {}
  return overrideSettings.reduce<Record<string, number>>((acc, setting) => {
    const bookId = setting.key.slice(METADATA_OVERRIDE_PREFIX.length)
    if (!bookId) return acc
    const updatedAtMs = Date.parse(setting.updatedAt)
    acc[bookId] = Number.isFinite(updatedAtMs) ? updatedAtMs : 0
    return acc
  }, {})
}

const prefetchDriveCovers = async (books: Audiobook[], accessToken: string): Promise<void> => {
  const candidates = books.filter((book) => book.source === 'drive' && book.coverFileId)
  for (const book of candidates) {
    const localId = `cover-${book.id}`
    try {
      const existing = await fileStorage.read(localId)
      if (existing) continue
      const blob = await driveApi.download(accessToken, book.coverFileId!)
      await fileStorage.save(localId, blob, blob.type || 'image/jpeg')
    } catch {
      continue
    }
  }
}

const formatDriveSyncError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Drive sync failed'
  if (message.includes('401') || message.includes('403')) {
    return 'La sesion de Google expiro o no tiene permisos. Reconecta tu cuenta.'
  }
  if (message.includes('429')) {
    return 'Google Drive limito temporalmente las peticiones. Intenta de nuevo en unos minutos.'
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Sin conexion. La biblioteca se sincronizara cuando vuelvas a estar online.'
  }
  return message
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  source: 'drive',
  driveRootId: undefined,
  books: [],
  tracksByBook: {},
  progressByBook: {},
  readTrackIdsByBook: {},
  readTrackUpdatedAtByBook: {},
  cloudSyncStatus: 'idle',
  cloudSyncMessage: undefined,
  cloudLastSyncedAt: undefined,
  loading: false,
  setSource(source) {
    set({ source })
  },
  async setDriveRootId(rootId) {
    const value = rootId.trim()
    await db.settings.put({ key: 'drive-root-id', value, updatedAt: new Date().toISOString() })
    set({ driveRootId: value || undefined })
  },
  async bootstrap() {
    const driveRootSetting = await db.settings.get('drive-root-id')
    const source: LibrarySource = 'drive'
    const driveRootId = driveRootSetting?.value?.trim() ? driveRootSetting.value : undefined
    const books = await db.books.toArray()
    const tracks = await db.tracks.toArray()
    const progress = await db.progress.toArray()
    const readTrackMap = await loadReadTrackMap()
    const storedOrder = await loadStoredOrder()
    const progressByBook = progress.reduce<Record<string, ListeningProgress>>((acc, item) => {
      acc[item.bookId] = item
      return acc
    }, {})
    if (books.length === 0) {
      set({
        source,
        driveRootId,
        books: [],
        tracksByBook: {},
        progressByBook,
        readTrackIdsByBook: readTrackMap.idsByBook,
        readTrackUpdatedAtByBook: readTrackMap.updatedAtByBook,
      })
      return
    }
    const normalizedBooks = await applyStoredOverrides(books)
    await db.books.bulkPut(normalizedBooks)
    set({
      source,
      driveRootId,
      books: applyOrder(normalizedBooks, storedOrder),
      tracksByBook: groupTracksByBook(tracks),
      progressByBook,
      readTrackIdsByBook: readTrackMap.idsByBook,
      readTrackUpdatedAtByBook: readTrackMap.updatedAtByBook,
    })
  },
  async syncDrive(accessToken, rootId) {
    const normalizedRootId = rootId.trim()
    if (!normalizedRootId) {
      set({ error: 'Selecciona una carpeta raiz de Drive antes de sincronizar.' })
      return
    }
    set({ loading: true, error: undefined })
    try {
      await driveApi.ping(accessToken, normalizedRootId)
      const files = await driveApi.listFolderTree(accessToken, normalizedRootId)
      const scanned = scanDriveLibrary(files)
      const books = await applyStoredOverrides(scanned.books)
      const tracks = scanned.tracks
      await db.transaction('rw', [db.books, db.tracks, db.settings], async () => {
        await db.books.clear()
        await db.tracks.clear()
        await db.books.bulkPut(books)
        await db.tracks.bulkPut(tracks)
        await db.settings.put({ key: 'library-source', value: 'drive', updatedAt: new Date().toISOString() })
        await db.settings.put({ key: 'drive-root-id', value: normalizedRootId, updatedAt: new Date().toISOString() })
      })
      const storedOrder = await loadStoredOrder()
      set({
        source: 'drive',
        driveRootId: normalizedRootId,
        books: applyOrder(books, storedOrder),
        tracksByBook: groupTracksByBook(tracks),
        readTrackIdsByBook: get().readTrackIdsByBook,
        readTrackUpdatedAtByBook: get().readTrackUpdatedAtByBook,
        loading: false,
      })
      void prefetchDriveCovers(books, accessToken)
    } catch (error) {
      set({
        loading: false,
        error: formatDriveSyncError(error),
      })
    }
  },
  async upsertProgress(progress, source = 'local') {
    await db.progress.put(progress)
    set((state) => ({
      progressByBook: {
        ...state.progressByBook,
        [progress.bookId]: progress,
      },
    }))
    if (source === 'local' && cloudSyncUserId && canUseReadingSync()) {
      void pushCloudProgress(cloudSyncUserId, progress)
    }
  },
  async upsertTrackDuration(bookId, trackId, durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
    const normalizedDuration = Math.round(durationSeconds)
    const state = get()
    const tracks = state.tracksByBook[bookId]
    if (!tracks || tracks.length === 0) return
    const track = tracks.find((item) => item.id === trackId)
    if (!track) return

    const currentDuration = Number(track.durationSeconds ?? 0)
    if (Number.isFinite(currentDuration) && currentDuration > 0 && Math.abs(currentDuration - normalizedDuration) < 1) {
      return
    }

    const book = state.books.find((item) => item.id === bookId)
    const fallbackDuration = book && tracks.length > 0 ? Math.max(0, book.totalDurationSeconds) / tracks.length : 0
    const updatedTracks = tracks.map((item) => (item.id === trackId ? { ...item, durationSeconds: normalizedDuration } : item))
    const recalculatedTotal = Math.round(
      updatedTracks.reduce((total, item) => {
        const value = Number(item.durationSeconds ?? 0)
        if (Number.isFinite(value) && value > 0) return total + value
        return total + fallbackDuration
      }, 0),
    )

    await db.tracks.update(trackId, { durationSeconds: normalizedDuration })
    if (book && recalculatedTotal > 0) {
      await db.books.update(bookId, {
        totalDurationSeconds: recalculatedTotal,
        updatedAt: new Date().toISOString(),
      })
    }

    set((prev) => ({
      tracksByBook: {
        ...prev.tracksByBook,
        [bookId]: updatedTracks,
      },
      books: prev.books.map((item) => (item.id === bookId && recalculatedTotal > 0 ? { ...item, totalDurationSeconds: recalculatedTotal } : item)),
    }))
  },
  async markTrackRead(bookId, trackId, read, source = 'local') {
    const current = get().readTrackIdsByBook[bookId] ?? []
    const nextIds = read ? Array.from(new Set([...current, trackId])) : current.filter((id) => id !== trackId)
    const updatedAt = new Date().toISOString()
    const updatedAtMs = Date.parse(updatedAt)
    await db.settings.put({
      key: `${TRACK_READ_PREFIX}${bookId}`,
      value: JSON.stringify(nextIds),
      updatedAt,
    })
    set((state) => ({
      readTrackIdsByBook: {
        ...state.readTrackIdsByBook,
        [bookId]: nextIds,
      },
      readTrackUpdatedAtByBook: {
        ...state.readTrackUpdatedAtByBook,
        [bookId]: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
      },
    }))
    if (source === 'local' && cloudSyncUserId && canUseReadingSync()) {
      void pushCloudReadTracks(cloudSyncUserId, bookId, nextIds, Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now())
    }
  },
  async startCloudSync(userId) {
    if (!canUseReadingSync()) return
    if (cloudSyncUserId === userId && cloudSyncUnsubscribe) return
    cloudSyncUnsubscribe?.()
    cloudMetadataUnsubscribe?.()
    cloudSyncUserId = userId
    set({ cloudSyncStatus: navigator.onLine ? 'syncing' : 'offline', cloudSyncMessage: undefined })
    // Cargar orden desde Firestore y aplicar si existe
    void fetchBookOrder(userId).then((remoteOrder) => {
      if (remoteOrder && remoteOrder.length > 0) {
        void saveStoredOrder(remoteOrder)
        set((state) => ({ books: applyOrder(state.books, remoteOrder) }))
      }
    })
    let initialSnapshotHandled = false
    let initialMetadataSnapshotHandled = false
    cloudSyncUnsubscribe = subscribeCloudBookStates(
      userId,
      (states) => {
        const remoteProgressByBook = new Map<string, number>()
        const remoteReadByBook = new Map<string, number>()
        for (const item of states) {
          remoteProgressByBook.set(item.bookId, item.progressUpdatedAtMs ?? 0)
          remoteReadByBook.set(item.bookId, item.readTrackIdsUpdatedAtMs ?? 0)
          const localProgress = get().progressByBook[item.bookId]
          const localProgressMs = localProgress ? Date.parse(localProgress.updatedAt) : 0
          const remoteProgressMs = item.progressUpdatedAtMs ?? 0
          if (item.progress && remoteProgressMs > (Number.isFinite(localProgressMs) ? localProgressMs : 0)) {
            void get().upsertProgress(item.progress, 'remote')
          }

          const localReadMs = get().readTrackUpdatedAtByBook[item.bookId] ?? 0
          const remoteReadMs = item.readTrackIdsUpdatedAtMs ?? 0
          if (remoteReadMs > localReadMs) {
            const nextIds = Array.from(new Set(item.readTrackIds ?? []))
            const updatedAtIso = new Date(remoteReadMs || Date.now()).toISOString()
            void db.settings.put({
              key: `${TRACK_READ_PREFIX}${item.bookId}`,
              value: JSON.stringify(nextIds),
              updatedAt: updatedAtIso,
            })
            set((state) => ({
              readTrackIdsByBook: {
                ...state.readTrackIdsByBook,
                [item.bookId]: nextIds,
              },
              readTrackUpdatedAtByBook: {
                ...state.readTrackUpdatedAtByBook,
                [item.bookId]: remoteReadMs,
              },
            }))
          }
        }

        if (!initialSnapshotHandled) {
          const state = get()
          for (const progress of Object.values(state.progressByBook)) {
            const localMs = Date.parse(progress.updatedAt)
            const remoteMs = remoteProgressByBook.get(progress.bookId) ?? 0
            if ((Number.isFinite(localMs) ? localMs : 0) > remoteMs) {
              void pushCloudProgress(userId, progress)
            }
          }
          for (const [bookId, trackIds] of Object.entries(state.readTrackIdsByBook)) {
            const localMs = state.readTrackUpdatedAtByBook[bookId] ?? 0
            const remoteMs = remoteReadByBook.get(bookId) ?? 0
            if (localMs > remoteMs) {
              void pushCloudReadTracks(userId, bookId, trackIds, localMs)
            }
          }
          initialSnapshotHandled = true
          set({ cloudSyncStatus: 'online', cloudLastSyncedAt: new Date().toISOString(), cloudSyncMessage: undefined })
        } else {
          set({ cloudSyncStatus: 'online', cloudLastSyncedAt: new Date().toISOString(), cloudSyncMessage: undefined })
        }
      },
      (error) => {
        set({ error: `Cloud sync error: ${error.message}`, cloudSyncStatus: 'error', cloudSyncMessage: error.message })
      },
    )

    cloudMetadataUnsubscribe = subscribeCloudBookMetadata(
      userId,
      (states) => {
        const remoteMetadataByBook = new Map<string, number>()
        for (const item of states) {
          remoteMetadataByBook.set(item.bookId, item.updatedAtMs ?? 0)
        }

        void loadMetadataOverrideUpdatedAt().then((localUpdatedAtByBook) => {
          for (const item of states) {
            const remoteMs = item.updatedAtMs ?? 0
            const localMs = localUpdatedAtByBook[item.bookId] ?? 0
            if (item.patch && remoteMs > localMs) {
              const updatedAtIso = new Date(remoteMs || Date.now()).toISOString()
              const current = get().books.find((book) => book.id === item.bookId)
              const next = current ? applyMetadataOverride(current, item.patch) : undefined
              void db.settings.put({
                key: `${METADATA_OVERRIDE_PREFIX}${item.bookId}`,
                value: JSON.stringify(item.patch),
                updatedAt: updatedAtIso,
              })
              if (next) {
                void db.books.put(next)
                set((state) => ({
                  books: state.books.map((book) => (book.id === item.bookId ? next : book)),
                }))
              }
            }
          }

          if (!initialMetadataSnapshotHandled) {
            for (const [bookId, localMs] of Object.entries(localUpdatedAtByBook)) {
              const remoteMs = remoteMetadataByBook.get(bookId) ?? 0
              if (localMs > remoteMs) {
                void db.settings.get(`${METADATA_OVERRIDE_PREFIX}${bookId}`).then((setting) => {
                  if (!setting) return
                  try {
                    const patch = JSON.parse(setting.value) as Partial<Audiobook>
                    void pushCloudBookMetadata(userId, bookId, patch, localMs)
                  } catch {
                    return
                  }
                })
              }
            }
            initialMetadataSnapshotHandled = true
          }
        })
      },
      (error) => {
        set({ error: `Cloud metadata error: ${error.message}`, cloudSyncStatus: 'error', cloudSyncMessage: error.message })
      },
    )
  },
  stopCloudSync() {
    cloudSyncUnsubscribe?.()
    cloudSyncUnsubscribe = undefined
    cloudMetadataUnsubscribe?.()
    cloudMetadataUnsubscribe = undefined
    cloudSyncUserId = undefined
    set({ cloudSyncStatus: 'idle', cloudSyncMessage: undefined })
  },
  async forceCloudSync(userId) {
    const syncUserId = userId ?? cloudSyncUserId
    if (!syncUserId || !canUseReadingSync()) {
      set({ cloudSyncStatus: 'idle', cloudSyncMessage: 'No hay usuario conectado para sincronizar.' })
      return
    }
    if (!navigator.onLine) {
      set({ cloudSyncStatus: 'offline', cloudSyncMessage: 'Sin conexion. Se sincronizara al volver online.' })
      return
    }
    set({ cloudSyncStatus: 'syncing', cloudSyncMessage: undefined })
    try {
      const state = get()
      await Promise.all(
        Object.values(state.progressByBook).map((progress) => pushCloudProgress(syncUserId, progress)),
      )
      await Promise.all(
        Object.entries(state.readTrackIdsByBook).map(([bookId, trackIds]) => {
          const updatedAtMs = state.readTrackUpdatedAtByBook[bookId] ?? Date.now()
          return pushCloudReadTracks(syncUserId, bookId, trackIds, updatedAtMs)
        }),
      )
      set({ cloudSyncStatus: 'online', cloudSyncMessage: undefined, cloudLastSyncedAt: new Date().toISOString() })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible sincronizar ahora'
      set({ cloudSyncStatus: 'error', cloudSyncMessage: message })
    }
  },
  async updateBookMetadata(bookId, patch) {
    const current = await db.books.get(bookId)
    if (!current) return
    const safePatch: Partial<Audiobook> = {
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() || current.title : undefined,
      author: patch.author !== undefined ? patch.author.trim() || 'Autor sin clasificar' : undefined,
      narrator: patch.narrator !== undefined ? patch.narrator.trim() || 'Narrador desconocido' : undefined,
      isbn: patch.isbn !== undefined ? patch.isbn.trim() || undefined : undefined,
    }
    const next = applyMetadataOverride(current, safePatch)
    await db.books.put(next)
    await db.settings.put({
      key: `${METADATA_OVERRIDE_PREFIX}${bookId}`,
      value: JSON.stringify(safePatch),
      updatedAt: new Date().toISOString(),
    })
    if (cloudSyncUserId && canUseReadingSync()) {
      const updatedAtMs = Date.parse(next.updatedAt)
      void pushCloudBookMetadata(
        cloudSyncUserId,
        bookId,
        safePatch,
        Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
      )
    }
    set((state) => ({
      books: state.books.map((book) => (book.id === bookId ? next : book)),
    }))
  },
  async reorderBooks(orderedIds) {
    // Reordenar en memoria inmediatamente
    set((state) => ({ books: applyOrder(state.books, orderedIds) }))
    // Persistir localmente
    await saveStoredOrder(orderedIds)
    // Sincronizar a Firestore si hay sesión
    if (cloudSyncUserId && canUseReadingSync()) {
      void pushBookOrder(cloudSyncUserId, orderedIds)
    }
  },
}))
