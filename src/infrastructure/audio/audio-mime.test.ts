import { describe, expect, it } from 'vitest'
import { resolvePlayableMime, withPlayableType } from './audio-mime'

describe('resolvePlayableMime', () => {
  it('maps audiobook containers to audio/mp4 regardless of what Drive declares', () => {
    expect(resolvePlayableMime('m4b', 'audio/x-m4b')).toBe('audio/mp4')
    expect(resolvePlayableMime('m4a', 'application/octet-stream')).toBe('audio/mp4')
    expect(resolvePlayableMime('mp3', 'audio/mp3')).toBe('audio/mpeg')
  })

  it('falls back to a usable declared type for unknown extensions', () => {
    expect(resolvePlayableMime('unknown', 'audio/x-m4b')).toBe('audio/mp4')
    expect(resolvePlayableMime('unknown', 'application/octet-stream')).toBeUndefined()
  })
})

describe('withPlayableType', () => {
  it('relabels untyped blobs (e.g. read from OPFS)', () => {
    const blob = withPlayableType(new Blob(['x']), 'audio/mp4')
    expect(blob.type).toBe('audio/mp4')
    expect(blob.size).toBe(1)
  })
})
