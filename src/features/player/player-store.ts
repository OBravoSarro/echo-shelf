import { create } from 'zustand'
import type { AudioTrack } from '../../domain/audiobook'
import { audioEngine } from '../../infrastructure/audio/audio-engine'
import { resolvePlayableMime, withPlayableType } from '../../infrastructure/audio/audio-mime'
import { db } from '../../infrastructure/persistence/db'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { useLibraryStore } from '../library/library-store'
import { useAuthStore } from '../auth/auth-store'
import { useDownloadStore } from '../downloads/download-store'
import { fetchRemoteTrack, isAbortError, readLocalTrack } from './track-source'

/**
 * Fase de carga del capitulo actual, para dar feedback en la UI:
 * - idle: nada en curso (puede estar sonando o en pausa)
 * - local: leyendo el archivo descargado en el dispositivo
 * - downloading: bajando el capitulo desde Google Drive (consume datos)
 * - preparing: el audio ya esta disponible, el navegador lo esta abriendo
 * - error: fallo; `message` explica por que
 */
export type LoadPhase = 'idle' | 'local' | 'downloading' | 'preparing' | 'error'

export interface LoadStatus {
  phase: LoadPhase
  trackId?: string
  loaded?: number
  total?: number
  message?: string
}

export type PlaybackSource = 'local' | 'drive'

interface PlayerState {
  activeBookId?: string
  queue: AudioTrack[]
  currentTrackId?: string
  playing: boolean
  buffering: boolean
  position: number
  duration: number
  speed: number
  pending: boolean
  canPersistProgress: boolean
  loadStatus: LoadStatus
  /** De donde sale el audio del capitulo cargado (undefined si aun no hay fuente). */
  source?: PlaybackSource
  error?: string
  init: () => void
  loadBook: (bookId: string, trackId?: string, autoplay?: boolean) => Promise<void>
  playPause: () => Promise<void>
  seek: (seconds: number) => void
  skip: (seconds: number) => void
  setSpeed: (speed: number) => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
  retry: () => Promise<void>
  cancelLoad: () => void
}

/** Segundos antes del final del capitulo en los que se precarga el siguiente. */
const PREFETCH_WINDOW_SECONDS = 5 * 60
const PROGRESS_THROTTLE_MS = 200

let currentObjectUrl: string | undefined
let progressSaveTimer: number | undefined
const artworkCache = new Map<string, string>()
const artworkTypes = new Map<string, string>()
const autoMarkedRead = new Set<string>()
const prefetchRequested = new Set<string>()
let lastMetadataKey: string | undefined
let initialized = false

// Control de cargas: cada carga nueva invalida la anterior (toques rapidos
// en varios capitulos no deben acabar reproduciendo el que llego ultimo).
let loadSeq = 0
let loadAbort: AbortController | undefined
let loadAutoplay = false
/** Pista cuyo audio esta realmente cargado en el elemento <audio>. */
let loadedTrackId: string | undefined
/** Posicion a la que saltar cuando se cargue la pista actual (carga diferida). */
let pendingStartAt = 0
/**
 * Siguiente capitulo ya leido del dispositivo. Con la pantalla bloqueada iOS
 * puede suspender la pagina si el hueco entre capitulos se alarga; tenerlo a
 * mano evita la lectura de OPFS justo en el cambio.
 */
let preparedNext: { trackId: string; blob: Blob } | undefined
const PREPARE_NEXT_SECONDS = 45

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

const saveProgress = async (): Promise<void> => {
  const player = usePlayerStore.getState()
  if (!player.canPersistProgress) return
  const track = player.queue.find((item) => item.id === player.currentTrackId)
  if (!player.activeBookId || !track) return
  // Sin audio cargado la posicion del <audio> es 0: no pisar el progreso guardado.
  if (loadedTrackId !== track.id) return
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
  const key = `${bookId}:${coverFileId}`
  if (artworkCache.has(key)) {
    return artworkCache.get(key)
  }
  try {
    const blob = await driveApi.download(token, coverFileId)
    const url = URL.createObjectURL(blob)
    artworkCache.set(key, url)
    artworkTypes.set(url, blob.type || 'image/jpeg')
    return url
  } catch {
    return coverUrl
  }
}

const updateMediaSession = (bookId: string | undefined, track: AudioTrack | undefined): void => {
  if (!('mediaSession' in navigator) || !bookId || !track) return
  const key = `${bookId}:${track.id}`
  if (lastMetadataKey === key) return
  lastMetadataKey = key
  const book = useLibraryStore.getState().books.find((item) => item.id === bookId)
  if (!book) return
  const base = { title: track.title, artist: `${book.author} · ${book.narrator}`, album: book.title }
  navigator.mediaSession.metadata = new MediaMetadata(base)
  void resolveArtworkUrl(book.id, book.coverFileId, book.coverUrl).then((artworkSrc) => {
    if (!artworkSrc || lastMetadataKey !== key) return
    navigator.mediaSession.metadata = new MediaMetadata({
      ...base,
      artwork: [{ src: artworkSrc, sizes: '512x512', type: artworkTypes.get(artworkSrc) ?? 'image/jpeg' }],
    })
  })
}

const prefersSavingData = (): boolean => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(connection?.saveData)
}

/**
 * Cerca del final del capitulo, descarga el siguiente en segundo plano para
 * que el salto sea instantaneo (y funcione con la pantalla bloqueada). Va por
 * la cola de descargas, asi que queda guardado y no se vuelve a bajar.
 */
const maybePrefetchNext = (): void => {
  const { activeBookId, queue, currentTrackId, playing, position, duration, source } = usePlayerStore.getState()
  if (!activeBookId || !playing || duration <= 0) return
  if (duration - position > PREFETCH_WINDOW_SECONDS) return
  const index = queue.findIndex((track) => track.id === currentTrackId)
  const nextTrack = index >= 0 ? queue[index + 1] : undefined
  if (nextTrack && duration - position <= PREPARE_NEXT_SECONDS && preparedNext?.trackId !== nextTrack.id) {
    preparedNext = { trackId: nextTrack.id, blob: new Blob() }
    void readLocalTrack(nextTrack.id).then((blob) => {
      if (preparedNext?.trackId !== nextTrack.id) return
      preparedNext = blob ? { trackId: nextTrack.id, blob } : undefined
    })
  }
  if (!nextTrack?.driveFileId || prefetchRequested.has(nextTrack.id)) return
  // Escuchando offline y sin red: no intentes nada.
  if (!navigator.onLine) return
  // Respeta "ahorro de datos" salvo que ya estemos tirando de Drive igualmente.
  if (prefersSavingData() && source !== 'drive') return
  prefetchRequested.add(nextTrack.id)
  if (useDownloadStore.getState().downloadedTrackIds.includes(nextTrack.id)) return
  void useDownloadStore.getState().enqueueTrack(activeBookId, nextTrack.id)
}

type SetState = (partial: Partial<PlayerState>) => void
type GetState = () => PlayerState

/**
 * Activa la pista `index` de la cola. Siempre intenta primero el archivo local;
 * solo si no existe (y hay que reproducir) lo baja de Drive, mostrando progreso.
 */
const activateTrack = async (
  set: SetState,
  get: GetState,
  index: number,
  { autoplay, startAt = 0 }: { autoplay: boolean; startAt?: number },
): Promise<void> => {
  const seq = ++loadSeq
  loadAbort?.abort()
  const controller = new AbortController()
  loadAbort = controller
  loadAutoplay = autoplay
  loadedTrackId = undefined
  pendingStartAt = startAt
  if (progressSaveTimer) window.clearTimeout(progressSaveTimer)

  audioEngine.selectIndex(index)
  const track = audioEngine.getState().currentTrack
  if (!track) return
  const isStale = () => seq !== loadSeq

  set({
    pending: true,
    error: undefined,
    source: undefined,
    currentTrackId: track.id,
    position: startAt,
    duration: track.durationSeconds ?? 0,
    loadStatus: { phase: 'local', trackId: track.id },
  })

  try {
    const mime = resolvePlayableMime(track.format, track.mimeType)
    if (mime && !audioEngine.canPlayType(mime)) {
      throw new Error(`Formato ${track.format} no soportado en este navegador.`)
    }

    const prepared = preparedNext?.trackId === track.id && preparedNext.blob.size > 0 ? preparedNext.blob : undefined
    preparedNext = undefined
    let blob = prepared ?? (await readLocalTrack(track.id))
    if (isStale()) return
    let source: PlaybackSource = 'local'

    if (!blob) {
      // Abrir un libro no debe gastar datos: solo se baja al darle a reproducir.
      if (!autoplay) {
        set({ pending: false, loadStatus: { phase: 'idle', trackId: track.id } })
        return
      }
      if (!track.driveFileId) {
        throw new Error('Este capitulo no tiene audio local ni en Drive.')
      }
      if (!navigator.onLine) {
        throw new Error('Sin conexion y este capitulo no esta descargado.')
      }
      source = 'drive'
      let lastEmit = 0
      set({ loadStatus: { phase: 'downloading', trackId: track.id, loaded: 0, total: track.fileSize } })
      blob = await fetchRemoteTrack(track, {
        signal: controller.signal,
        onProgress: ({ loaded, total }) => {
          const now = Date.now()
          if (isStale() || now - lastEmit < PROGRESS_THROTTLE_MS) return
          lastEmit = now
          set({ loadStatus: { phase: 'downloading', trackId: track.id, loaded, total } })
        },
      })
      if (isStale()) return
      // Ya lo hemos bajado entero: guardarlo evita volver a gastar datos.
      const bookId = get().activeBookId
      if (bookId) void useDownloadStore.getState().registerDownloadedTrack(bookId, track, blob)
    }

    set({ loadStatus: { phase: 'preparing', trackId: track.id } })
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = URL.createObjectURL(withPlayableType(blob, mime))
    await audioEngine.load(currentObjectUrl, startAt)
    if (isStale()) return
    loadedTrackId = track.id
    audioEngine.setSpeed(get().speed)
    set({ source })

    if (loadAutoplay) {
      try {
        await audioEngine.play()
      } catch (error) {
        if (isStale()) return
        // iOS/Safari bloquea play() si la descarga tardo y se perdio el gesto del usuario.
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          set({ pending: false, loadStatus: { phase: 'idle', trackId: track.id, message: 'Listo. Pulsa play para empezar.' } })
          return
        }
        throw error
      }
    }
    if (isStale()) return
    set({ pending: false, loadStatus: { phase: 'idle', trackId: track.id } })
  } catch (error) {
    if (isStale() || isAbortError(error)) return
    const message = error instanceof Error ? error.message : 'No se pudo cargar el capitulo.'
    set({ pending: false, error: message, loadStatus: { phase: 'error', trackId: track.id, message } })
  }
}

const currentIndex = (): number => audioEngine.getState().currentIndex

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  speed: 1,
  pending: false,
  canPersistProgress: false,
  loadStatus: { phase: 'idle' },
  init() {
    // StrictMode monta dos veces: listeners duplicados harian saltar dos capitulos al terminar uno.
    if (initialized) return
    initialized = true
    audioEngine.onChange(() => {
      const state = audioEngine.getState()
      const currentTrackId = state.currentTrack?.id
      const currentBookId = get().activeBookId
      const hasAudio = loadedTrackId !== undefined && loadedTrackId === currentTrackId
      set({
        queue: state.queue,
        currentTrackId,
        // El silencio de desbloqueo de iOS no cuenta como "reproduciendo".
        playing: hasAudio && state.playing,
        buffering: hasAudio && state.buffering && state.playing,
        // Mientras no hay audio cargado se mantiene la posicion/duracion "prevista".
        ...(hasAudio ? { position: state.position, duration: state.duration } : {}),
        speed: state.speed,
      })
      if (!hasAudio || !currentBookId || !currentTrackId) return
      if (isTrackCompleted(state.position, state.duration)) {
        void markTrackAsRead(currentBookId, currentTrackId)
      }
      if (Number.isFinite(state.duration) && state.duration > 0) {
        void useLibraryStore.getState().upsertTrackDuration(currentBookId, currentTrackId, state.duration)
      }
      if (progressSaveTimer) window.clearTimeout(progressSaveTimer)
      if (get().canPersistProgress) {
        progressSaveTimer = window.setTimeout(() => {
          void saveProgress()
        }, 2500)
      }
      updateMediaSession(currentBookId, state.currentTrack)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused'
        if (state.duration > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
          try {
            navigator.mediaSession.setPositionState({
              duration: state.duration,
              position: Math.min(state.position, state.duration),
              playbackRate: state.speed || 1,
            })
          } catch {
            // Valores transitorios invalidos durante la carga
          }
        }
      }
      maybePrefetchNext()
    })

    audioEngine.onEnded(() => {
      const { activeBookId, currentTrackId, queue } = get()
      if (!currentTrackId || loadedTrackId !== currentTrackId) return
      if (activeBookId && currentTrackId) void markTrackAsRead(activeBookId, currentTrackId)
      void saveProgress()
      const index = currentIndex()
      if (index < queue.length - 1) {
        void activateTrack(set, get, index + 1, { autoplay: true })
      }
    })

    const media = navigator.mediaSession
    media?.setActionHandler('play', () => {
      if (!get().playing) void get().playPause()
    })
    media?.setActionHandler('pause', () => {
      if (get().playing) void get().playPause()
    })
    media?.setActionHandler('previoustrack', () => {
      void get().prev()
    })
    media?.setActionHandler('nexttrack', () => {
      void get().next()
    })
    try {
      media?.setActionHandler('seekbackward', (details) => get().skip(-(details.seekOffset ?? 15)))
      media?.setActionHandler('seekforward', (details) => get().skip(details.seekOffset ?? 15))
      media?.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') get().seek(details.seekTime)
      })
    } catch {
      // Algunos navegadores no soportan estas acciones.
    }

    // iOS mata las PWAs en segundo plano sin avisar: guardamos el progreso
    // en cuanto la app deja de estar visible, sin esperar al debounce.
    const flush = () => {
      if (progressSaveTimer) window.clearTimeout(progressSaveTimer)
      void saveProgress()
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    window.addEventListener('pagehide', flush)
  },
  async loadBook(bookId, trackId, autoplay = false) {
    if (autoplay) audioEngine.unlock()
    const tracks = useLibraryStore.getState().tracksByBook[bookId] ?? []
    if (tracks.length === 0) {
      set({ error: 'No hay capitulos para este libro.' })
      return
    }
    // Mismo capitulo ya cargado: no recargar (y no volver a descargar).
    const sameBook = get().activeBookId === bookId
    if (sameBook && trackId && trackId === get().currentTrackId) {
      if (autoplay && !get().playing) await get().playPause()
      return
    }

    const progress = await db.progress.get(bookId)
    const targetId = trackId ?? progress?.trackId
    const foundIndex = targetId ? tracks.findIndex((item) => item.id === targetId) : 0
    const index = foundIndex >= 0 ? foundIndex : 0
    const resumeHere = progress && progress.trackId === tracks[index].id && !progress.completed
    const startAt = resumeHere ? progress.positionSeconds : 0

    if (!sameBook) {
      prefetchRequested.clear()
      lastMetadataKey = undefined
    }
    if (sameBook && get().playing) void saveProgress()
    audioEngine.setQueue(tracks, index)
    const speed = progress?.speed ?? get().speed ?? 1
    audioEngine.setSpeed(speed)
    set({ activeBookId: bookId, queue: tracks, speed, canPersistProgress: autoplay })
    await activateTrack(set, get, index, { autoplay, startAt })
  },
  async playPause() {
    if (get().playing) {
      audioEngine.pause()
      await saveProgress()
      return
    }
    audioEngine.unlock()
    set({ canPersistProgress: true })
    const track = audioEngine.getState().currentTrack
    if (!track) return
    if (get().pending) {
      // Ya cargando: que arranque en cuanto este listo.
      loadAutoplay = true
      return
    }
    if (loadedTrackId !== track.id) {
      await activateTrack(set, get, currentIndex(), { autoplay: true, startAt: pendingStartAt })
      return
    }
    try {
      set({ error: undefined, loadStatus: { phase: 'idle', trackId: track.id } })
      await audioEngine.play()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo reproducir.'
      set({ error: message, loadStatus: { phase: 'error', trackId: track.id, message } })
    }
  },
  seek(seconds) {
    set({ canPersistProgress: true })
    if (loadedTrackId !== get().currentTrackId) {
      pendingStartAt = Math.max(0, seconds)
      set({ position: pendingStartAt })
      return
    }
    audioEngine.seek(seconds)
  },
  skip(seconds) {
    if (loadedTrackId !== get().currentTrackId) {
      get().seek(get().position + seconds)
      return
    }
    set({ canPersistProgress: true })
    audioEngine.skip(seconds)
  },
  async setSpeed(speed) {
    audioEngine.setSpeed(speed)
    set({ speed })
    await saveProgress()
  },
  async next() {
    const index = currentIndex()
    if (index >= get().queue.length - 1) return
    const keepPlaying = get().playing || (get().pending && loadAutoplay)
    if (keepPlaying) audioEngine.unlock()
    await saveProgress()
    set({ canPersistProgress: true })
    await activateTrack(set, get, index + 1, { autoplay: keepPlaying })
  },
  async prev() {
    const index = currentIndex()
    if (index <= 0) {
      get().seek(0)
      return
    }
    const keepPlaying = get().playing || (get().pending && loadAutoplay)
    if (keepPlaying) audioEngine.unlock()
    await saveProgress()
    set({ canPersistProgress: true })
    await activateTrack(set, get, index - 1, { autoplay: keepPlaying })
  },
  async retry() {
    audioEngine.unlock()
    await activateTrack(set, get, currentIndex(), { autoplay: true, startAt: pendingStartAt })
  },
  cancelLoad() {
    if (!get().pending) return
    loadSeq += 1
    loadAbort?.abort()
    loadAutoplay = false
    set({ pending: false, loadStatus: { phase: 'idle', trackId: get().currentTrackId } })
  },
}))
