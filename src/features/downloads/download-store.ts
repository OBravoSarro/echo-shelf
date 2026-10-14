import { create } from 'zustand'
import type { DownloadState } from '../../domain/audiobook'
import { db } from '../../infrastructure/persistence/db'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { useAuthStore } from '../auth/auth-store'
import { useLibraryStore } from '../library/library-store'

const CONCURRENCY = 2

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
}

const queueWorkers = new Set<string>()

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
    const jobs = await db.downloads.orderBy('updatedAt').reverse().toArray()
    const downloadedTrackIds = jobs.filter((job) => job.status === 'done').map((job) => job.trackId)
    set({ jobs, downloadedTrackIds })
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
    await Promise.all(
      batch.map(async (job) => {
        queueWorkers.add(job.id)
        try {
          await db.downloads.update(job.id, {
            status: 'running',
            progress: 0.08,
            error: undefined,
            updatedAt: new Date().toISOString(),
          })
          const track = Object.values(useLibraryStore.getState().tracksByBook)
            .flat()
            .find((item) => item.id === job.trackId)
          if (!track?.driveFileId) {
            throw new Error('Track has no Drive file id')
          }
          await db.downloads.update(job.id, { progress: 0.45, updatedAt: new Date().toISOString() })
          const blob = await driveApi.download(token, track.driveFileId)
          if (queueWorkers.has(job.id)) {
            await fileStorage.save(track.id, blob, track.mimeType ?? 'audio/mpeg')
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
          await db.downloads.update(job.id, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Download failed',
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
    if ((await db.downloads.where('status').equals('queued').count()) > 0) {
      await get().process()
    }
  },
}))
