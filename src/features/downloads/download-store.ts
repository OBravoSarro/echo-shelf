import { create } from 'zustand'
import type { AudioTrack, DownloadState } from '../../domain/audiobook'
import { db } from '../../infrastructure/persistence/db'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { fetchRemoteTrack, isAbortError } from '../player/track-source'
import { useAuthStore } from '../auth/auth-store'
import { useLibraryStore } from '../library/library-store'

const isAppleMobile = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

// En iPhone/iPad cada capitulo se monta en memoria antes de guardarse:
// de uno en uno para no superar el limite de memoria de Safari.
const CONCURRENCY = isAppleMobile() ? 1 : 2

interface DownloadStore {
  jobs: DownloadState[]
  downloadedTrackIds: string[]
  running: number
  bootstrap: () => Promise<void>
  enqueueBook: (bookId: string) => Promise<void>
  enqueueTrack: (bookId: string, trackId: string) => Promise<void>
  removeTrackDownload: (trackId: string) => Promise<void>
  removeBookDownloads: (bookId: string) => Promise<void>
  cancelJob: (id: string) => Promise<void>
  process: () => Promise<void>
  /** Guarda para offline un capitulo que ya se ha bajado entero (p. ej. al escucharlo en streaming). */
  registerDownloadedTrack: (bookId: string, track: AudioTrack, blob: Blob) => Promise<void>
}

let listenersAttached = false
const queueWorkers = new Map<string, AbortController>()
const persisting = new Set<string>()
const PROGRESS_STEP = 0.02

const snapshot = async () => {
  const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
  return { jobs, downloadedTrackIds: jobs.filter((job) => job.status === 'done').map((job) => job.trackId) }
}

const probeAudioDurationSeconds = async (blob: Blob): Promise<number | undefined> => {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const duration = await new Promise<number | undefined>((resolve) => {
      const audio = new Audio()
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoadedMetadata)
        audio.removeEventListener('error', onError)
        audio.src = ''
      }
      const onLoadedMetadata = () => {
        const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined
        cleanup()
        resolve(nextDuration)
      }
      const onError = () => {
        cleanup()
        resolve(undefined)
      }
      audio.preload = 'metadata'
      audio.addEventListener('loadedmetadata', onLoadedMetadata)
      audio.addEventListener('error', onError)
      audio.src = objectUrl
      audio.load()
    })

    if (!Number.isFinite(duration) || (duration ?? 0) <= 0) return undefined
    return duration
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  jobs: [],
  downloadedTrackIds: [],
  running: 0,
  async bootstrap() {
    // Si la app se cerro (iOS la mata en segundo plano) con descargas a medias,
    // quedan en "running" para siempre: las devolvemos a la cola.
    const stale = await db.downloads.where('status').equals('running').toArray()
    if (stale.length > 0) {
      await Promise.all(stale.map((job) => db.downloads.update(job.id, { status: 'queued', progress: 0 })))
    }
    set(await snapshot())
    const resume = () => {
      if (navigator.onLine && get().running === 0) void get().process()
    }
    if (!listenersAttached && typeof window !== 'undefined') {
      listenersAttached = true
      window.addEventListener('online', resume)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resume()
      })
      // Al arrancar, el token de Drive llega despues: reanuda cuando este listo.
      useAuthStore.subscribe((state, prev) => {
        if (state.accessToken && !prev.accessToken) resume()
      })
    }
    if (stale.length > 0 && useAuthStore.getState().accessToken) resume()
  },
  async enqueueBook(bookId) {
    const tracks = useLibraryStore.getState().tracksByBook[bookId] ?? []
    const now = new Date().toISOString()
    const existing = await db.downloads.toArray()
    const jobs: DownloadState[] = tracks
      .filter((track) => {
        const current = existing.find((job) => job.trackId === track.id)
        return current?.status !== 'done' && current?.status !== 'running' && current?.status !== 'queued'
      })
      .map((track) => ({
        id: `download-${track.id}`,
        bookId,
        trackId: track.id,
        status: 'queued',
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: track.fileSize,
        updatedAt: now,
      }))
    if (jobs.length > 0) {
      await db.downloads.bulkPut(jobs)
    }
    const merged = await db.downloads.orderBy('updatedAt').reverse().toArray()
    set({ jobs: merged, downloadedTrackIds: merged.filter((job) => job.status === 'done').map((job) => job.trackId) })
    await get().process()
  },
  async enqueueTrack(bookId, trackId) {
    const tracks = useLibraryStore.getState().tracksByBook[bookId] ?? []
    const track = tracks.find((item) => item.id === trackId)
    if (!track) return
    const existing = await db.downloads.get(`download-${trackId}`)
    if (existing?.status === 'done' || existing?.status === 'running' || existing?.status === 'queued') return
    await db.downloads.put({
      id: `download-${trackId}`,
      bookId,
      trackId,
      status: 'queued',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: track.fileSize,
      updatedAt: new Date().toISOString(),
    })
    const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
    set({ jobs, downloadedTrackIds: jobs.filter((job) => job.status === 'done').map((job) => job.trackId) })
    await get().process()
  },
  async removeTrackDownload(trackId) {
    await fileStorage.remove(trackId)
    await db.downloads.delete(`download-${trackId}`)
    const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
    set({ jobs, downloadedTrackIds: jobs.filter((job) => job.status === 'done').map((job) => job.trackId) })
  },
  async removeBookDownloads(bookId) {
    const jobs = await db.downloads.where('bookId').equals(bookId).toArray()
    for (const job of jobs) {
      await fileStorage.remove(job.trackId)
      await db.downloads.delete(job.id)
    }
    const next = await db.downloads.orderBy('updatedAt').reverse().toArray()
    set({ jobs: next, downloadedTrackIds: next.filter((job) => job.status === 'done').map((job) => job.trackId) })
  },
  async cancelJob(id) {
    await db.downloads.update(id, { status: 'cancelled', updatedAt: new Date().toISOString() })
    queueWorkers.get(id)?.abort()
    queueWorkers.delete(id)
    const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
    set({ jobs, downloadedTrackIds: jobs.filter((job) => job.status === 'done').map((job) => job.trackId) })
  },
  async process() {
    let token = useAuthStore.getState().accessToken
    if (!token) {
      await useAuthStore.getState().refresh()
      token = useAuthStore.getState().accessToken
    }
    if (!token) {
      const queued = await db.downloads.where('status').anyOf(['queued', 'running']).toArray()
      await Promise.all(
        queued.map((job) =>
          db.downloads.update(job.id, {
            status: 'error',
            error: 'Sesion expirada. Vuelve a conectar Google Drive para descargar.',
            updatedAt: new Date().toISOString(),
          }),
        ),
      )
      const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
      set({ jobs, downloadedTrackIds: jobs.filter((job) => job.status === 'done').map((job) => job.trackId) })
      return
    }
    const pending = (await db.downloads.toArray()).filter((job) => job.status === 'queued' || job.status === 'error')
    const available = Math.max(0, CONCURRENCY - get().running)
    const batch = pending.slice(0, available)
    if (batch.length === 0) return
    set((state) => ({ running: state.running + batch.length }))
    let networkInterrupted = false
    await Promise.all(
      batch.map(async (job) => {
        const controller = new AbortController()
        queueWorkers.set(job.id, controller)
        try {
          await db.downloads.update(job.id, {
            status: 'running',
            progress: 0,
            error: undefined,
            updatedAt: new Date().toISOString(),
          })
          set(await snapshot())
          const track = Object.values(useLibraryStore.getState().tracksByBook)
            .flat()
            .find((item) => item.id === job.trackId)
          if (!track?.driveFileId) {
            throw new Error('Track has no Drive file id')
          }
          let lastReported = 0
          const blob = await fetchRemoteTrack(track, {
            signal: controller.signal,
            onProgress: ({ loaded, total }) => {
              if (!total) return
              const progress = Math.min(0.99, loaded / total)
              if (progress - lastReported < PROGRESS_STEP) return
              lastReported = progress
              // Solo en memoria: escribir en IndexedDB por cada chunk es caro.
              set((state) => ({
                jobs: state.jobs.map((item) =>
                  item.id === job.id ? { ...item, status: 'running', progress, bytesDownloaded: loaded, totalBytes: total } : item,
                ),
              }))
            },
          })
          if (queueWorkers.has(job.id) && !persisting.has(track.id)) {
            persisting.add(track.id)
            try {
              await fileStorage.save(track.id, blob, track.mimeType ?? 'audio/mpeg')
            } finally {
              persisting.delete(track.id)
            }
            const durationSeconds = await probeAudioDurationSeconds(blob)
            if (durationSeconds) {
              void useLibraryStore.getState().upsertTrackDuration(job.bookId, track.id, durationSeconds)
            }
            await db.downloads.update(job.id, {
              status: 'done',
              progress: 1,
              bytesDownloaded: blob.size,
              totalBytes: blob.size,
              updatedAt: new Date().toISOString(),
            })
          }
        } catch (error) {
          if (isAbortError(error)) return
          const raw = error instanceof Error ? error.message : 'Download failed'
          // Safari: "Load failed" / Chrome: "Failed to fetch" al perder red o pasar a segundo plano.
          const networkLost = /load failed|failed to fetch|network/i.test(raw) || !navigator.onLine
          if (networkLost) networkInterrupted = true
          await db.downloads.update(job.id, {
            status: networkLost ? 'queued' : 'error',
            error: networkLost ? 'Conexion interrumpida. Se reanudara al volver a la app con conexion.' : raw,
            updatedAt: new Date().toISOString(),
          })
        } finally {
          queueWorkers.delete(job.id)
        }
      }),
    )
    set({
      jobs: await db.downloads.orderBy('updatedAt').reverse().toArray(),
      running: Math.max(0, get().running - batch.length),
    })
    const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
    set({ downloadedTrackIds: jobs.filter((job) => job.status === 'done').map((job) => job.trackId) })
    // Tras un corte de red no reintentamos en bucle: se reanuda con 'online'/'visible'.
    if (!networkInterrupted && (await db.downloads.where('status').equals('queued').count()) > 0) {
      await get().process()
    }
  },
  async registerDownloadedTrack(bookId, track, blob) {
    const id = `download-${track.id}`
    const existing = await db.downloads.get(id)
    // Si la cola ya lo esta bajando/guardando, ella se encarga de persistirlo.
    if (existing?.status === 'done' || existing?.status === 'running' || persisting.has(track.id)) return
    persisting.add(track.id)
    try {
      await fileStorage.save(track.id, blob, track.mimeType ?? blob.type ?? 'audio/mpeg')
      await db.downloads.put({
        id,
        bookId,
        trackId: track.id,
        status: 'done',
        progress: 1,
        bytesDownloaded: blob.size,
        totalBytes: blob.size,
        updatedAt: new Date().toISOString(),
      })
      set(await snapshot())
    } catch {
      // Sin espacio u OPFS no disponible: se seguira reproduciendo en streaming.
    } finally {
      persisting.delete(track.id)
    }
  },
}))
