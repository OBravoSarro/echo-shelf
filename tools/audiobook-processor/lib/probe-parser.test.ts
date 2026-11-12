import { describe, expect, it } from 'vitest'
import { parseChapters, parseProbe, splitByInterval } from './probe-parser.ts'

describe('parseChapters', () => {
  it('maps ffprobe chapters, sorts them and keeps titles', () => {
    const chapters = parseChapters(
      [
        { start_time: '600.5', end_time: '1200', tags: { title: 'Dos' } },
        { start_time: '0', end_time: '600.5', tags: { TITLE: 'Uno' } },
      ],
      1200,
    )
    expect(chapters).toEqual([
      { index: 0, title: 'Uno', start: 0, end: 600.5 },
      { index: 1, title: 'Dos', start: 600.5, end: 1200 },
    ])
  })

  it('clamps the last chapter to the real duration and drops empty ones', () => {
    const chapters = parseChapters(
      [
        { start_time: '0', end_time: '100' },
        { start_time: '100', end_time: '100' },
        { start_time: '100', end_time: '999' },
      ],
      250,
    )
    expect(chapters.map((c) => [c.title, c.start, c.end])).toEqual([
      ['Capítulo 1', 0, 100],
      ['Capítulo 2', 100, 250],
    ])
  })

  it('uses the next start when end_time is missing', () => {
    const chapters = parseChapters([{ start_time: '0' }, { start_time: '50' }], 80)
    expect(chapters.map((c) => c.end)).toEqual([50, 80])
  })
})

describe('splitByInterval', () => {
  it('splits in fixed parts with padded titles', () => {
    const parts = splitByInterval(3600 * 2, 30)
    expect(parts).toHaveLength(4)
    expect(parts[0]).toMatchObject({ title: 'Parte 01', start: 0, end: 1800 })
    expect(parts[3]).toMatchObject({ title: 'Parte 04', start: 5400, end: 7200 })
  })

  it('merges a tiny tail into the previous part', () => {
    const parts = splitByInterval(1800 + 20, 30)
    expect(parts).toHaveLength(1)
    expect(parts[0].end).toBe(1820)
  })
})

describe('parseProbe', () => {
  it('extracts audio info, cover and book metadata', () => {
    const result = parseProbe(
      {
        streams: [
          { index: 0, codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2, bit_rate: '64000' },
          { index: 1, codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 } },
        ],
        chapters: [{ start_time: '0', end_time: '10', tags: { title: 'Intro' } }],
        format: {
          duration: '10.0',
          tags: { album: 'Dune', artist: 'Frank Herbert', composer: 'Simon Vance', date: '2007-01-01' },
        },
      },
      'dune.m4b',
      1234,
    )
    expect(result).toMatchObject({
      codec: 'aac',
      sampleRate: 44100,
      bitrate: 64000,
      cover: { streamIndex: 1, codec: 'png' },
      meta: { title: 'Dune', author: 'Frank Herbert', narrator: 'Simon Vance', year: '2007' },
    })
    expect(result.chapters).toHaveLength(1)
  })

  it('falls back to the file name and fails without audio', () => {
    const result = parseProbe({ streams: [{ index: 0, codec_type: 'audio' }], format: {} }, 'Mi libro.m4b', 1)
    expect(result.meta.title).toBe('Mi libro')
    expect(() => parseProbe({ streams: [] }, 'x.m4b', 1)).toThrow()
  })
})
