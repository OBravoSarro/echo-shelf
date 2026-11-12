import type { BookMeta } from './types.ts'

const MAX_SEGMENT_LENGTH = 120

// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g

export const sanitizeSegment = (value: string, fallback = 'Sin título'): string => {
  const clean = value
    .replace(FORBIDDEN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, MAX_SEGMENT_LENGTH)
    .trim()
  return clean || fallback
}

/**
 * The EchoShelf Drive scanner infers the author with /^([^-]{2,})\s+-\s+(.+)$/,
 * so an ASCII hyphen inside the author ("Jean-Paul Sartre") breaks the split.
 * U+2010 (HYPHEN) looks identical and keeps the folder parseable.
 */
const protectAuthorHyphens = (author: string): string => author.replace(/-/g, '\u2010')

/** Folder layout understood by src/features/library/drive-scanner.ts. */
export const buildFolderName = (meta: BookMeta): string => {
  const title = sanitizeSegment(meta.title)
  const author = meta.author.trim() ? protectAuthorHyphens(sanitizeSegment(meta.author)) : ''
  const narrator = meta.narrator.trim() ? sanitizeSegment(meta.narrator) : ''
  let name = author ? `${author} - ${title}` : title
  if (narrator) name += ` (narrado por ${narrator})`
  return sanitizeSegment(name)
}

export const outputExtension = (codec: string, enhance: boolean): string => {
  if (enhance) return 'm4a'
  switch (codec) {
    case 'mp3':
      return 'mp3'
    case 'opus':
      return 'opus'
    case 'vorbis':
      return 'ogg'
    default:
      return 'm4a'
  }
}

export const chapterFileName = (position: number, total: number, title: string, ext: string): string => {
  const width = Math.max(2, String(total).length)
  const prefix = String(position).padStart(width, '0')
  return `${prefix} - ${sanitizeSegment(title, `Capítulo ${position}`)}.${ext}`
}

export const coverExtension = (codec: string): string => (codec === 'png' ? 'png' : 'jpg')
