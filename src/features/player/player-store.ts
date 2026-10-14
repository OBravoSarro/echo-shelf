import { create } from 'zustand'
import type { AudioTrack } from '../../domain/audiobook'
import { audioEngine } from '../../infrastructure/audio/audio-engine'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { db } from '../../infrastructure/persistence/db'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { useLibraryStore } from '../library/library-store'
import { useAuthStore } from '../auth/auth-store'

interface PlayerState {
  activeBookId?: string
  queue: AudioTrack[]
  currentTrackId?: string
  playing: boolean
  position: number
  duration: number
  speed: number
  pending: boolean
  canPersistProgress: boolean
  error?: string
  init: () => void
  loadBook: (bookId: string, trackId?: string, autoplay?: boolean) => Promise<void>
  playPause: () => Promise<void>
  seek: (seconds: number) => void
  skip: (seconds: number) => void
  setSpeed: (speed: number) => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
}

let currentObjectUrl: string | undefined
let progressSaveTimer: number | undefined
const artworkCache = new Map<string, string>()
let lastPlaybackSnapshot:
  | {
      bookId?: string
      trackId?: string
      position: number
      duration: number
    }
  | undefined
const autoMarkedRead = new Set<string>()

const isTrackCompleted = (position: number, duration: number): boolean => {
  if (!Number.isFinite(duration) || duration <= 0) return false
  if (position >= duration - 8) return true
  return position / duration >= 0.98
}

const markTrackAsRead = async (bookId: string, trackId: string): Promise<void> => {
  const key = `${bookId}:${trackId}`
  if (autoMarkedRead.has(key)) return
  autoMarkedRead.add(key)
  await useLibraryStore.getState().markTrackRead(bookId, trackId, true)
}

const resolveTrackSource = async (track: AudioTrack): Promise<string> => {
  const local = await fileStorage.read(track.id)
  if (local) {
    return URL.createObjectURL(local)
  }
  if (!track.driveFileId) {
    throw new Error('Track needs local audio. Demo data does not ship audio files.')
  }
  const token = useAuthStore.getState().accessToken
  if (!token) {
    throw new Error('Google token missing for streaming')
  }
  const blob = await driveApi.download(token, track.driveFileId)
  return URL.createObjectURL(blob)
}

const saveProgress = async (): Promise<void> => {
  const player = usePlayerStore.getState()
  if (!player.canPersistProgress) return
  const track = player.queue.find((item) => item.id === player.currentTrackId)
  if (!player.activeBookId || !track) return
  const completed = isTrackCompleted(player.position, player.duration)

  if (completed) {
    await markTrackAsRead(player.activeBookId, track.id)
  }

  await useLibraryStore.getState().upsertProgress({
    bookId: player.activeBookId,
    trackId: track.id,
    positionSeconds: player.position,
    updatedAt: new Date().toISOString(),
    completed,
    speed: player.speed,
  })
}

const resolveArtworkUrl = async (bookId: string, coverFileId?: string, coverUrl?: string): Promise<string | undefined> => {
  if (!coverFileId) {
    return coverUrl
  }
  const token = useAuthStore.getState().accessToken
  if (!token) {
    return coverUrl
  }
  const key = `${bookId}:${coverFileId}:${token.slice(0, 12)}`
  if (artworkCache.has(key)) {
    return artworkCache.get(key)
  }
  try {
    const blob = await driveApi.download(token, coverFileId)
    const url = URL.createObjectURL(blob)
    artworkCache.set(key, url)
    return url
  } catch {
    return coverUrl
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  playing: false,
  position: 0,
  duration: 0,
  speed: 1,
  pending: false,
  canPersistProgress: false,
  init() {
    audioEngine.onChange(() => {
      const state = audioEngine.getState()
      const currentTrackId = state.currentTrack?.id
      const currentBookId = get().activeBookId
      if (lastPlaybackSnapshot?.trackId && lastPlaybackSnapshot.trackId !== currentTrackId) {
        if (lastPlaybackSnapshot.bookId && isTrackCompleted(lastPlaybackSnapshot.position, lastPlaybackSnapshot.duration)) {
          void markTrackAsRead(lastPlaybackSnapshot.bookId, lastPlaybackSnapshot.trackId)
        }
      }
      set({
        queue: state.queue,
        currentTrackId,
        playing: state.playing,
        position: state.position,
        duration: state.duration,
        speed: state.speed,
      })
      if (currentBookId && currentTrackId && isTrackCompleted(state.position, state.duration)) {
        void markTrackAsRead(currentBookId, currentTrackId)
      }
      if (currentBookId && currentTrackId && Number.isFinite(state.duration) && state.duration > 0) {
        void useLibraryStore.getState().upsertTrackDuration(currentBookId, currentTrackId, state.duration)
      }
      lastPlaybackSnapshot = {
        bookId: currentBookId,
        trackId: currentTrackId,
        position: state.position,
        duration: state.duration,
      }
      if (progressSaveTimer) window.clearTimeout(progressSaveTimer)
      if (get().canPersistProgress) {
        progressSaveTimer = window.setTimeout(() => {
          void saveProgress()
        }, 2500)
      }
      if ('mediaSession' in navigator && currentTrackId) {
        const book = useLibraryStore.getState().books.find((item) => item.id === get().activeBookId)
        if (book) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: book.title,
            artist: `${book.author} · ${book.narrator}`,
          })
          void resolveArtworkUrl(book.id, book.coverFileId, book.coverUrl).then((artworkSrc) => {
            if (!artworkSrc) return
            navigator.mediaSession.metadata = new MediaMetadata({
              title: book.title,
              artist: `${book.author} · ${book.narrator}`,
              artwork: [
                {
                  src: artworkSrc,
                  sizes: '512x512',
                  type: 'image/png',
                },
              ],
            })
          })
        }
      }
    })
    navigator.mediaSession?.setActionHandler('play', () => {
      void get().playPause()
    })
    navigator.mediaSession?.setActionHandler('pause', () => {
      void get().playPause()
    })
    navigator.mediaSession?.setActionHandler('previoustrack', () => {
      void get().prev()
    })
    navigator.mediaSession?.setActionHandler('nexttrack', () => {
      void get().next()
    })
  },
  async loadBook(bookId, trackId, autoplay = false) {
    const tracks = useLibraryStore.getState().tracksByBook[bookId] ?? []
    if (tracks.length === 0) {
      set({ error: 'No tracks found for this book' })
      return
    }
    const startIndex = trackId ? tracks.findIndex((item) => item.id === trackId) : 0
    audioEngine.setQueue(tracks, startIndex >= 0 ? startIndex : 0)
    if (progressSaveTimer) window.clearTimeout(progressSaveTimer)
    set({ activeBookId: bookId, pending: true, error: undefined, canPersistProgress: autoplay })
    try {
      const currentTrack = audioEngine.getState().currentTrack
      if (!currentTrack) return
      if (currentTrack.mimeType && !audioEngine.canPlayType(currentTrack.mimeType)) {
        throw new Error(`Format ${currentTrack.format} no soportado en este navegador.`)
      }
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
      currentObjectUrl = await resolveTrackSource(currentTrack)
      audioEngine.setTrackSource(currentObjectUrl)
      const progress = await db.progress.get(bookId)
      if (progress && progress.trackId === currentTrack.id) {
        audioEngine.seek(progress.positionSeconds)
      }
      audioEngine.setSpeed(progress?.speed ?? 1)
      if (autoplay) {
        await audioEngine.play()
      }
      set({ pending: false })
    } catch (error) {
      set({
        pending: false,
        error: error instanceof Error ? error.message : 'Unable to load track',
      })
    }
  },
  async playPause() {
    if (get().playing) {
      audioEngine.pause()
      await saveProgress()
      return
    }
    set({ canPersistProgress: true })
    await audioEngine.play()
  },
  seek(seconds) {
    set({ canPersistProgress: true })
    audioEngine.seek(seconds)
  },
  skip(seconds) {
    set({ canPersistProgress: true })
    audioEngine.skip(seconds)
  },
  async setSpeed(speed) {
    audioEngine.setSpeed(speed)
    await saveProgress()
  },
  async next() {
    set({ canPersistProgress: true })
    await audioEngine.next()
    const track = audioEngine.getState().currentTrack
    if (!track) return
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = await resolveTrackSource(track)
    audioEngine.setTrackSource(currentObjectUrl)
  },
  async prev() {
    set({ canPersistProgress: true })
    await audioEngine.prev()
    const track = audioEngine.getState().currentTrack
    if (!track) return
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = await resolveTrackSource(track)
    audioEngine.setTrackSource(currentObjectUrl)
  },
}))
