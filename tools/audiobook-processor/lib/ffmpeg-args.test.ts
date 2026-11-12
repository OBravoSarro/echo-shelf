import { describe, expect, it } from 'vitest'
import { VOICE_PRESETS, buildChapterArgs, buildFilterChain, buildPreviewArgs, parseProgressSeconds } from './ffmpeg-args.ts'

const meta = { title: 'Dune', author: 'Frank Herbert', narrator: 'Simon Vance' }
const base = {
  input: '/in/dune.m4b',
  output: '/out/01 - Uno.m4a',
  start: 10,
  end: 70.25,
  preset: 'soft' as const,
  bitrateKbps: 96,
  sampleRate: 22050,
  meta,
  title: 'Uno',
  track: 1,
  totalTracks: 3,
}

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('buildFilterChain', () => {
  it('resamples after loudnorm (which upsamples to 192 kHz)', () => {
    const chain = buildFilterChain('soft', 22050)
    expect(chain.indexOf('loudnorm')).toBeLessThan(chain.indexOf('aresample=22050'))
    expect(chain.endsWith('aresample=22050')).toBe(true)
  })

  it('every preset ends with a loudness target', () => {
    for (const preset of Object.values(VOICE_PRESETS)) {
      expect(preset.filters.at(-1)).toMatch(/^loudnorm=/)
    }
  })
})

describe('buildChapterArgs', () => {
  it('seeks on input and cuts the exact duration', () => {
    const args = buildChapterArgs({ ...base, enhance: true })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(valueAfter(args, '-ss')).toBe('10.000')
    expect(valueAfter(args, '-t')).toBe('60.250')
  })

  it('re-encodes with filters when enhancing', () => {
    const args = buildChapterArgs({ ...base, enhance: true })
    expect(valueAfter(args, '-c:a')).toBe('aac')
    expect(valueAfter(args, '-b:a')).toBe('96k')
    expect(valueAfter(args, '-af')).toContain('afftdn')
  })

  it('stream-copies without filters when not enhancing', () => {
    const args = buildChapterArgs({ ...base, enhance: false })
    expect(valueAfter(args, '-c:a')).toBe('copy')
    expect(args).not.toContain('-af')
  })

  it('writes per-chapter tags and drops the source chapter table', () => {
    const args = buildChapterArgs({ ...base, enhance: false })
    expect(args).toContain('title=Uno')
    expect(args).toContain('track=1/3')
    expect(args).toContain('album=Dune')
    expect(args).toContain('composer=Simon Vance')
    expect(valueAfter(args, '-map_chapters')).toBe('-1')
    expect(args.at(-1)).toBe(base.output)
  })
})

describe('buildPreviewArgs', () => {
  it('only filters when the mode is not original', () => {
    const original = buildPreviewArgs({ input: 'a', output: 'b.wav', at: 5, duration: 30, mode: 'original' })
    const strong = buildPreviewArgs({ input: 'a', output: 'b.wav', at: 5, duration: 30, mode: 'strong' })
    expect(original).not.toContain('-af')
    expect(valueAfter(strong, '-af')).toContain('deesser')
  })
})

describe('parseProgressSeconds', () => {
  it('reads the latest out_time from a progress chunk', () => {
    expect(parseProgressSeconds('out_time_us=1500000\nprogress=continue\nout_time_us=3000000\n')).toBe(3)
    expect(parseProgressSeconds('out_time_ms=2000000\n')).toBe(2)
    expect(parseProgressSeconds('progress=end\n')).toBeUndefined()
  })
})
