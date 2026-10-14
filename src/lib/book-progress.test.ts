import { describe, expect, it } from 'vitest'
import type { AudioTrack, ListeningProgress } from '../domain/audiobook'
import {
  calculateBookProgressPercent,
  calculateListenedSeconds,
  calculateTrackProgressPercent,
  resolveTrackDurationSeconds,
} from './book-progress'

const makeTrack = (id: string, index: number, durationSeconds?: number): AudioTrack => ({
  id,
  bookId: 'book-1',
  title: id,
  index,
  durationSeconds,
  format: 'mp3',
})

describe('book progress', () => {
  it('counts read chapters as fully listened in global percent', () => {
    const tracks = [makeTrack('t1', 0, 120), makeTrack('t2', 1, 180), makeTrack('t3', 2, 300)]

    const percent = calculateBookProgressPercent({
      tracks,
      totalDurationSeconds: 600,
      readTrackIds: ['t1', 't2'],
    })

    expect(percent).toBe(50)
  })

  it('uses fallback duration when chapter metadata is missing', () => {
    const track = makeTrack('t1', 0)
    expect(resolveTrackDurationSeconds({ track, totalDurationSeconds: 900, trackCount: 3 })).toBe(300)
  })

  it('combines read chapters with active playback progress', () => {
    const tracks = [makeTrack('t1', 0, 100), makeTrack('t2', 1, 200), makeTrack('t3', 2, 300)]
    const progress: ListeningProgress = {
      bookId: 'book-1',
      trackId: 't3',
      positionSeconds: 60,
      updatedAt: new Date().toISOString(),
      completed: false,
      speed: 1,
    }

    const listenedSeconds = calculateListenedSeconds({
      tracks,
      progress,
      readTrackIds: ['t2'],
      totalDurationSeconds: 600,
    })

    expect(listenedSeconds).toBe(360)
  })

  it('sets chapter progress to 100 when it is manually marked as read', () => {
    const tracks = [makeTrack('t1', 0, 120)]
    const percent = calculateTrackProgressPercent({
      track: tracks[0],
      tracks,
      readTrackIds: ['t1'],
    })

    expect(percent).toBe(100)
  })
})
