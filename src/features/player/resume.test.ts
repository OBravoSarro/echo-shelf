import { describe, expect, it } from 'vitest'
import type { AudioTrack, ListeningProgress } from '../../domain/audiobook'
import { resolveResumeIndex } from './resume'

const tracks = ['a', 'b', 'c'].map(
  (id, index): AudioTrack => ({ id, bookId: 'book', title: id, index, format: 'mp3' }),
)

const progress = (trackId: string, completed: boolean): ListeningProgress => ({
  bookId: 'book',
  trackId,
  positionSeconds: 100,
  updatedAt: '2026-11-27T00:00:00.000Z',
  completed,
  speed: 1,
})

describe('resolveResumeIndex', () => {
  it('sigue en el capitulo guardado si no esta terminado', () => {
    expect(resolveResumeIndex(tracks, progress('b', false))).toBe(1)
  })

  it('pasa al siguiente si el guardado esta terminado', () => {
    expect(resolveResumeIndex(tracks, progress('b', true))).toBe(2)
  })

  it('en el ultimo capitulo terminado se queda en el', () => {
    expect(resolveResumeIndex(tracks, progress('c', true))).toBe(2)
  })

  it('un capitulo elegido a mano manda sobre el guardado', () => {
    expect(resolveResumeIndex(tracks, progress('b', true), 'b')).toBe(1)
  })

  it('sin progreso empieza por el primero', () => {
    expect(resolveResumeIndex(tracks)).toBe(0)
  })
})
