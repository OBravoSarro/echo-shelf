import type { BookMeta, Chapter, CoverStream, ProbeResult } from './types.ts'

interface RawStream {
  index: number
  codec_type?: string
  codec_name?: string
  sample_rate?: string
  channels?: number
  bit_rate?: string
  disposition?: { attached_pic?: number }
}

interface RawChapter {
  start_time?: string
  end_time?: string
  tags?: Record<string, string>
}

interface RawFormat {
  duration?: string
  bit_rate?: string
  tags?: Record<string, string>
}

export interface RawProbe {
  streams?: RawStream[]
  chapters?: RawChapter[]
  format?: RawFormat
}

const MIN_TAIL_SECONDS = 60

const toNumber = (value: string | number | undefined): number | undefined => {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** ffprobe exposes tags with inconsistent casing (TITLE vs title) depending on container. */
const normalizeTags = (tags: Record<string, string> | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags ?? {})) {
    const trimmed = String(value).trim()
    if (trimmed) out[key.toLowerCase()] = trimmed
  }
  return out
}

export const fileStem = (fileName: string): string => fileName.replace(/\.[a-z0-9]+$/i, '')

export const parseChapters = (raw: RawChapter[] | undefined, duration: number): Chapter[] => {
  const sorted = (raw ?? [])
    .map((c) => ({
      start: toNumber(c.start_time) ?? 0,
      end: toNumber(c.end_time),
      title: normalizeTags(c.tags).title,
    }))
    .sort((a, b) => a.start - b.start)

  const chapters: Chapter[] = []
  sorted.forEach((c, i) => {
    const nextStart = sorted[i + 1]?.start
    const rawEnd = c.end ?? nextStart ?? duration
    const end = duration > 0 ? Math.min(rawEnd, duration) : rawEnd
    const start = Math.max(0, c.start)
    if (end <= start) return
    chapters.push({
      index: chapters.length,
      title: c.title ?? `Capítulo ${chapters.length + 1}`,
      start,
      end,
    })
  })
  return chapters
}

/** Fallback for files without an embedded chapter table: fixed-length parts. */
export const splitByInterval = (duration: number, minutes: number): Chapter[] => {
  const step = Math.max(1, minutes) * 60
  if (!(duration > 0)) return []
  const parts: Chapter[] = []
  for (let start = 0; start < duration; start += step) {
    parts.push({ index: parts.length, title: '', start, end: Math.min(start + step, duration) })
  }
  // Avoid a ridiculous last part of a few seconds: merge it into the previous one.
  const last = parts.at(-1)
  if (parts.length > 1 && last && last.end - last.start < MIN_TAIL_SECONDS) {
    parts.pop()
    const prev = parts.at(-1)
    if (prev) prev.end = duration
  }
  const width = Math.max(2, String(parts.length).length)
  return parts.map((p) => ({ ...p, title: `Parte ${String(p.index + 1).padStart(width, '0')}` }))
}

const parseMeta = (tags: Record<string, string>, fileName: string): BookMeta => ({
  title: tags.album ?? tags.title ?? fileStem(fileName),
  author: tags.album_artist ?? tags.artist ?? tags.author ?? '',
  // There is no standard narrator atom in MP4; most tools (Audible, Libation, OpenAudible) use composer.
  narrator: tags.narrator ?? tags.composer ?? '',
  year: tags.date?.slice(0, 4) ?? tags.year,
  genre: tags.genre,
})

export const parseProbe = (raw: RawProbe, fileName: string, sizeBytes: number): ProbeResult => {
  const streams = raw.streams ?? []
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!audio) throw new Error('El fichero no contiene ninguna pista de audio')

  const coverRaw = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic === 1)
  const cover: CoverStream | undefined = coverRaw
    ? { streamIndex: coverRaw.index, codec: coverRaw.codec_name ?? 'mjpeg' }
    : undefined

  const duration = toNumber(raw.format?.duration) ?? 0
  return {
    file: fileName,
    sizeBytes,
    duration,
    codec: audio.codec_name ?? 'unknown',
    bitrate: toNumber(audio.bit_rate) ?? toNumber(raw.format?.bit_rate),
    sampleRate: toNumber(audio.sample_rate),
    channels: audio.channels,
    chapters: parseChapters(raw.chapters, duration),
    meta: parseMeta(normalizeTags(raw.format?.tags), fileName),
    cover,
  }
}
