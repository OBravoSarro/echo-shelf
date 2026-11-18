import type { AudioFormat } from '../../domain/audiobook'

/**
 * MIME "reproducible" por formato. Drive suele devolver `audio/x-m4b` o
 * `application/octet-stream`, y los archivos guardados en OPFS se leen sin
 * tipo. Safari (iOS) es estricto con los blob: URLs sin MIME valido y falla
 * con MEDIA_ERR_SRC_NOT_SUPPORTED, asi que siempre normalizamos.
 */
const MIME_BY_FORMAT: Record<AudioFormat, string | undefined> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  unknown: undefined,
}

const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

export const resolvePlayableMime = (format: AudioFormat, declared?: string): string | undefined => {
  const byFormat = MIME_BY_FORMAT[format]
  if (byFormat) return byFormat
  if (!declared || GENERIC_MIMES.has(declared)) return undefined
  if (declared === 'audio/x-m4b' || declared === 'audio/x-m4a' || declared === 'audio/m4a') return 'audio/mp4'
  if (declared === 'audio/mp3') return 'audio/mpeg'
  return declared
}

/** Re-etiqueta el blob con un MIME reproducible (no copia los datos). */
export const withPlayableType = (blob: Blob, mime: string | undefined): Blob => {
  if (!mime || blob.type === mime) return blob
  return new Blob([blob], { type: mime })
}
