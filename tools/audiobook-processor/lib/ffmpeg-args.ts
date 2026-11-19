import type { BookMeta, PreviewMode, VoicePreset } from './types.ts'

export interface VoicePresetDefinition {
  label: string
  description: string
  filters: string[]
}

/**
 * Speech-focused chains. Order matters:
 * 1. cut rumble -> 2. denoise -> 3. tonal EQ -> 4. dynamics -> 5. loudness target.
 * loudnorm internally upsamples to 192 kHz, so the caller must resample afterwards.
 */
export const VOICE_PRESETS: Record<VoicePreset, VoicePresetDefinition> = {
  soft: {
    label: 'Suave (recomendado)',
    description:
      'Quita graves molestos y algo de ruido de fondo, aclara la voz y deja todos los capítulos al mismo volumen. Respeta el sonido original.',
    filters: [
      'highpass=f=80',
      'afftdn=nr=10:nf=-50:tn=1',
      'equalizer=f=250:t=q:w=1:g=-1.5',
      'equalizer=f=3000:t=q:w=1.2:g=2.5',
      'acompressor=threshold=-20dB:ratio=2:attack=15:release=200:makeup=1',
      'loudnorm=I=-18:TP=-1.5:LRA=11',
    ],
  },
  strong: {
    label: 'Fuerte',
    description:
      'Para grabaciones antiguas, con ruido o voz apagada. Reduce más ruido, sibilancias y diferencias de volumen. Puede sonar algo más procesado.',
    filters: [
      'highpass=f=100',
      'lowpass=f=11000',
      'afftdn=nr=18:nf=-40:tn=1',
      'equalizer=f=250:t=q:w=1:g=-3',
      'equalizer=f=3200:t=q:w=1:g=4',
      'deesser=i=0.4',
      'acompressor=threshold=-24dB:ratio=3:attack=10:release=150:makeup=2',
      'loudnorm=I=-16:TP=-1.5:LRA=7',
    ],
  },
}

const DEFAULT_SAMPLE_RATE = 44100

export const buildFilterChain = (preset: VoicePreset, sampleRate = DEFAULT_SAMPLE_RATE): string =>
  [...VOICE_PRESETS[preset].filters, `aresample=${sampleRate}`].join(',')

const seconds = (value: number): string => Math.max(0, value).toFixed(3)

export const buildProbeArgs = (input: string): string[] => [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
  '-show_chapters',
  input,
]

export interface ChapterArgsOptions {
  input: string
  output: string
  start: number
  end: number
  sourceCodec?: string
  enhance: boolean
  preset: VoicePreset
  bitrateKbps: number
  sampleRate?: number
  meta: BookMeta
  title: string
  track: number
  totalTracks: number
}

export const buildChapterArgs = (o: ChapterArgsOptions): string[] => {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    // Input seeking: fast, and accurate when transcoding (accurate_seek is on by default).
    '-ss',
    seconds(o.start),
    '-t',
    seconds(o.end - o.start),
    '-i',
    o.input,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata',
    '0',
    '-map_chapters',
    '-1',
  ]

  if (o.enhance) {
    args.push(
      '-af',
      buildFilterChain(o.preset, o.sampleRate),
      '-c:a',
      'libmp3lame',
      '-b:a',
      `${o.bitrateKbps}k`,
    )
  } else if (o.output.endsWith('.mp3') && o.sourceCodec?.toLowerCase() === 'mp3') {
    args.push('-c:a', 'copy')
  } else {
    args.push('-c:a', 'libmp3lame', '-b:a', `${o.bitrateKbps}k`)
  }

  const tags: Record<string, string> = {
    title: o.title,
    track: `${o.track}/${o.totalTracks}`,
    album: o.meta.title,
    artist: o.meta.author,
    album_artist: o.meta.author,
    composer: o.meta.narrator,
  }
  for (const [key, value] of Object.entries(tags)) {
    if (value) args.push('-metadata', `${key}=${value}`)
  }

  args.push('-progress', 'pipe:1', '-nostats', o.output)
  return args
}

export interface PreviewArgsOptions {
  input: string
  output: string
  at: number
  duration: number
  mode: PreviewMode
  sampleRate?: number
}

/** Short WAV snippet so the browser can A/B original vs enhanced without codec surprises. */
export const buildPreviewArgs = (o: PreviewArgsOptions): string[] => {
  const args = ['-hide_banner', '-nostdin', '-y', '-ss', seconds(o.at), '-t', seconds(o.duration), '-i', o.input]
  args.push('-map', '0:a:0', '-vn', '-map_metadata', '-1')
  if (o.mode !== 'original') args.push('-af', buildFilterChain(o.mode, o.sampleRate))
  args.push('-c:a', 'pcm_s16le', o.output)
  return args
}

export const buildCoverArgs = (input: string, streamIndex: number, output: string): string[] => [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-i',
  input,
  '-map',
  `0:${streamIndex}`,
  '-c',
  'copy',
  '-frames:v',
  '1',
  output,
]

/**
 * Parses `-progress pipe:1` key=value output and returns the latest processed time in seconds.
 * ffmpeg reports out_time_us (and a misnamed out_time_ms that is also microseconds).
 */
export const parseProgressSeconds = (chunk: string): number | undefined => {
  let latest: number | undefined
  for (const line of chunk.split('\n')) {
    const match = line.match(/^out_time_(?:us|ms)=(\d+)/)
    if (match) latest = Number(match[1]) / 1_000_000
  }
  return latest
}
