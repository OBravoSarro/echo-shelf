import { describe, expect, it } from 'vitest'
import { mergeKnownDurations, scanDriveLibrary } from './drive-scanner'

describe('drive scanner', () => {
  it('sorts tracks naturally and groups by folder', () => {
    const files = [
      { id: 't10', name: '10.mp3', mimeType: 'audio/mpeg', parents: ['folder-a'] },
      { id: 't1', name: '1.mp3', mimeType: 'audio/mpeg', parents: ['folder-a'] },
      { id: 't2', name: '2.mp3', mimeType: 'audio/mpeg', parents: ['folder-a'] },
      { id: 'cover', name: 'cover.jpg', mimeType: 'image/jpeg', parents: ['folder-a'] },
    ]
    const result = scanDriveLibrary(files)
    expect(result.books).toHaveLength(1)
    expect(result.tracks.map((item) => item.title)).toEqual(['1', '2', '10'])
  })
})

describe('mergeKnownDurations', () => {
  it('conserva las duraciones medidas y recalcula el total', () => {
    const files = [
      { id: 't1', name: '1.mp3', mimeType: 'audio/mpeg', parents: ['folder-a'] },
      { id: 't2', name: '2.mp3', mimeType: 'audio/mpeg', parents: ['folder-a'] },
    ]
    const scanned = scanDriveLibrary(files)
    const merged = mergeKnownDurations(scanned, new Map([['track-t1', 600], ['track-t2', 900]]))
    expect(merged.tracks.map((track) => track.durationSeconds)).toEqual([600, 900])
    expect(merged.books[0].totalDurationSeconds).toBe(1500)
  })
})
