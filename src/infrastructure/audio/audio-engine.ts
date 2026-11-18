import type { AudioTrack } from '../../domain/audiobook'

type EngineListener = () => void

const describeMediaError = (error: MediaError | null): string => {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Carga de audio interrumpida.'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Error de red al leer el audio.'
    case MediaError.MEDIA_ERR_DECODE:
      return 'El archivo de audio esta danado o no se puede decodificar.'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Formato de audio no soportado en este navegador.'
    default:
      return 'No se pudo reproducir el audio.'
  }
}

/** WAV de 0,1 s de silencio para "desbloquear" el <audio> en iOS. */
const buildSilentWav = (): string => {
  const sampleRate = 8000
  const samples = 800
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i)
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  writeText(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return `data:audio/wav;base64,${btoa(binary)}`
}

/**
 * Envoltorio fino sobre un unico HTMLAudioElement. No decide de donde sale el
 * audio ni avanza de capitulo por su cuenta: eso lo orquesta el player-store,
 * que es quien sabe resolver la fuente (local o Drive).
 */
export class AudioEngine {
  private audio = new Audio()
  private queue: AudioTrack[] = []
  private currentIndex = 0
  private listeners = new Set<EngineListener>()
  private endedListeners = new Set<EngineListener>()
  private buffering = false
  private cancelPendingLoad?: () => void
  private unlocked = false

  constructor() {
    this.audio.preload = 'auto'
    // iOS: reproducir sin cortes por el boton de silencio y no mezclar con otras apps.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (audioSession) {
      try {
        audioSession.type = 'playback'
      } catch {
        // No soportado
      }
    }
    // Habilita AirPlay en Safari.
    this.audio.setAttribute('x-webkit-airplay', 'allow')
    for (const event of ['timeupdate', 'play', 'pause', 'durationchange', 'loadedmetadata', 'ratechange']) {
      this.audio.addEventListener(event, this.notify)
    }
    this.audio.addEventListener('waiting', () => this.setBuffering(true))
    this.audio.addEventListener('stalled', () => this.setBuffering(!this.audio.paused))
    for (const event of ['playing', 'canplay', 'pause', 'emptied']) {
      this.audio.addEventListener(event, () => this.setBuffering(false))
    }
    this.audio.addEventListener('ended', () => {
      if (this.audio.src.startsWith('data:')) return // silencio de desbloqueo
      this.endedListeners.forEach((cb) => cb())
    })
  }

  private notify = (): void => {
    this.listeners.forEach((cb) => cb())
  }

  private setBuffering(value: boolean): void {
    if (this.buffering === value) return
    this.buffering = value
    this.notify()
  }

  onChange(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onEnded(listener: EngineListener): () => void {
    this.endedListeners.add(listener)
    return () => this.endedListeners.delete(listener)
  }

  getState() {
    return {
      currentTrack: this.queue[this.currentIndex] as AudioTrack | undefined,
      currentIndex: this.currentIndex,
      queue: this.queue,
      playing: !this.audio.paused,
      buffering: this.buffering,
      position: this.audio.currentTime,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      speed: this.audio.playbackRate,
    }
  }

  /**
   * Debe llamarse de forma SINCRONA dentro de un gesto del usuario (tap) y
   * antes de cualquier `await`. iOS solo permite `play()` sin gesto en un
   * elemento que ya ha reproducido algo tras un toque; asi, aunque la carga
   * del capitulo tarde (OPFS, Drive), el play posterior no es bloqueado y el
   * auto-avance con la pantalla bloqueada sigue funcionando.
   */
  unlock(): void {
    if (this.unlocked || !this.audio.paused) {
      this.unlocked = true
      return
    }
    if (this.hasSource()) {
      // Hay audio real cargado: el play() del propio gesto ya desbloquea.
      return
    }
    this.audio.src = buildSilentWav()
    this.unlocked = true
    // WebKit levanta la restriccion en el momento de llamar a play() dentro
    // del gesto, aunque luego se interrumpa al cargar el capitulo (AbortError).
    void this.audio
      .play()
      ?.then(() => {
        // Si en este tiempo se ha cargado un capitulo, no lo toques.
        if (this.audio.src.startsWith('data:audio/wav')) this.audio.pause()
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') this.unlocked = false
      })
  }

  canPlayType(mimeType: string): boolean {
    return this.audio.canPlayType(mimeType) !== ''
  }

  hasSource(): boolean {
    return this.audio.hasAttribute('src')
  }

  /** Cambia la cola y el capitulo actual, descargando la fuente anterior. */
  setQueue(queue: AudioTrack[], startIndex = 0): void {
    this.queue = queue
    this.selectIndex(startIndex)
  }

  selectIndex(index: number): void {
    this.currentIndex = Math.max(0, Math.min(index, this.queue.length - 1))
    this.unload()
    this.notify()
  }

  setSpeed(speed: number): void {
    // load() resetea playbackRate a defaultPlaybackRate: fijamos ambos para
    // no perder la velocidad al cambiar de capitulo.
    this.audio.defaultPlaybackRate = speed
    this.audio.playbackRate = speed
    this.notify()
  }

  seek(seconds: number): void {
    if (!this.hasSource()) return
    const max = Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity
    this.audio.currentTime = Math.min(Math.max(0, seconds), max)
    this.notify()
  }

  skip(offsetSeconds: number): void {
    this.seek(this.audio.currentTime + offsetSeconds)
  }

  async play(): Promise<void> {
    if (!this.hasSource()) return
    await this.audio.play()
    this.notify()
  }

  pause(): void {
    this.audio.pause()
    this.notify()
  }

  /** Carga una URL y resuelve cuando hay metadatos (duracion) y se ha posicionado en `startAt`. */
  load(url: string, startAt = 0): Promise<void> {
    this.cancelPendingLoad?.()
    return new Promise<void>((resolve, reject) => {
      const audio = this.audio
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onReady)
        audio.removeEventListener('error', onError)
        if (this.cancelPendingLoad === cancel) this.cancelPendingLoad = undefined
      }
      const cancel = () => {
        cleanup()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      this.cancelPendingLoad = cancel
      const onReady = () => {
        cleanup()
        if (startAt > 0) {
          const max = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 1) : startAt
          audio.currentTime = Math.min(startAt, max)
        }
        this.notify()
        resolve()
      }
      const onError = () => {
        cleanup()
        reject(new Error(describeMediaError(audio.error)))
      }
      audio.addEventListener('loadedmetadata', onReady)
      audio.addEventListener('error', onError)
      audio.src = url
      audio.load()
    })
  }

  unload(): void {
    this.cancelPendingLoad?.()
    this.audio.pause()
    if (this.hasSource()) {
      this.audio.removeAttribute('src')
      this.audio.load()
    }
  }
}

export const audioEngine = new AudioEngine()
