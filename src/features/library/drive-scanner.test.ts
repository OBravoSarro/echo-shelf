import { describe, expect, it } from 'vitest'
import { scanDriveLibrary } from './drive-scanner'

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
