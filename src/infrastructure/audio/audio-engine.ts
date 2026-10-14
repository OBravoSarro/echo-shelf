import type { AudioTrack } from '../../domain/audiobook'

type EngineListener = () => void

export class AudioEngine {
  private audio = new Audio()
  private queue: AudioTrack[] = []
  private currentIndex = 0
  private listeners = new Set<EngineListener>()

  constructor() {
    this.audio.preload = 'metadata'
    this.audio.addEventListener('timeupdate', this.notify)
    this.audio.addEventListener('play', this.notify)
    this.audio.addEventListener('pause', this.notify)
    this.audio.addEventListener('ended', () => {
      void this.next()
    })
  }

  private notify = (): void => {
    this.listeners.forEach((cb) => cb())
  }

  onChange(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState() {
    return {
      currentTrack: this.queue[this.currentIndex],
      currentIndex: this.currentIndex,
      queue: this.queue,
      playing: !this.audio.paused,
      position: this.audio.currentTime,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
      speed: this.audio.playbackRate,
    }
  }

  canPlayType(mimeType: string): boolean {
    return this.audio.canPlayType(mimeType) !== ''
  }

  setQueue(queue: AudioTrack[], startIndex = 0): void {
    this.queue = queue
    this.currentIndex = startIndex
    this.loadCurrentTrack()
    this.notify()
  }

  setSpeed(speed: number): void {
    this.audio.playbackRate = speed
    this.notify()
  }

  seek(seconds: number): void {
    this.audio.currentTime = Math.max(0, seconds)
    this.notify()
  }

  skip(offsetSeconds: number): void {
    this.seek(this.audio.currentTime + offsetSeconds)
  }

  async play(): Promise<void> {
    await this.audio.play()
    this.notify()
  }

  pause(): void {
    this.audio.pause()
    this.notify()
  }

  async next(): Promise<void> {
    if (this.currentIndex >= this.queue.length - 1) {
      this.pause()
      return
    }
    this.currentIndex += 1
    this.loadCurrentTrack()
    await this.play()
  }

  async prev(): Promise<void> {
    if (this.currentIndex <= 0) {
      this.seek(0)
      return
    }
    this.currentIndex -= 1
    this.loadCurrentTrack()
    await this.play()
  }

  setTrackSource(url: string): void {
    this.audio.src = url
    this.audio.load()
    this.notify()
  }

  private loadCurrentTrack(): void {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }
}

export const audioEngine = new AudioEngine()
