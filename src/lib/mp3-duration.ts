/**
 * Duracion de un MP3 a partir de sus primeros bytes, sin bajar el archivo:
 * - con cabecera Xing/Info o VBRI: numero de frames exacto;
 * - sin ella (CBR antiguo): tamano del audio / bitrate.
 */

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const SAMPLE_RATES_V1 = [44100, 48000, 32000]

/** Bytes que ocupa la etiqueta ID3v2 inicial (0 si no hay). */
export const id3v2Size = (bytes: Uint8Array): number => {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  const hasFooter = (bytes[5] & 0x10) !== 0
  return 10 + size + (hasFooter ? 10 : 0)
}

interface FrameHeader {
  bitrateKbps: number
  sampleRate: number
  samplesPerFrame: number
  sideInfoSize: number
}

const parseFrameHeader = (bytes: Uint8Array, offset: number): FrameHeader | undefined => {
  if (offset + 4 > bytes.length) return undefined
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const b3 = bytes[offset + 3]
  if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return undefined
  const version = (b1 >> 3) & 0x03 // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b1 >> 1) & 0x03 // 1 = Layer III
  if (version === 1 || layer !== 1) return undefined
  const bitrateIndex = b2 >> 4
  const sampleRateIndex = (b2 >> 2) & 0x03
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return undefined
  const mpeg1 = version === 3
  const divisor = mpeg1 ? 1 : version === 2 ? 2 : 4
  const mono = b3 >> 6 === 3
  return {
    bitrateKbps: (mpeg1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex],
    sampleRate: SAMPLE_RATES_V1[sampleRateIndex] / divisor,
    samplesPerFrame: mpeg1 ? 1152 : 576,
    sideInfoSize: mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17,
  }
}

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]

const matches = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/**
 * `bytes` empieza en el primer byte del audio (ya sin ID3v2). `audioBytes` es
 * el tamano del archivo menos la etiqueta, para el calculo CBR.
 */
export const mp3DurationFromFrames = (bytes: Uint8Array, audioBytes: number): number | undefined => {
  // El primer frame puede no estar justo al principio (relleno, basura).
  const searchLimit = Math.min(bytes.length - 4, 4096)
  for (let offset = 0; offset <= searchLimit; offset += 1) {
    const header = parseFrameHeader(bytes, offset)
    if (!header) continue
    const frameSeconds = header.samplesPerFrame / header.sampleRate
    const xingOffset = offset + 4 + header.sideInfoSize
    if (matches(bytes, xingOffset, 'Xing') || matches(bytes, xingOffset, 'Info')) {
      const flags = readUint32(bytes, xingOffset + 4)
      if (flags & 0x1) {
        const frames = readUint32(bytes, xingOffset + 8)
        if (frames > 0) return frames * frameSeconds
      }
    }
    const vbriOffset = offset + 4 + 32
    if (matches(bytes, vbriOffset, 'VBRI')) {
      const frames = readUint32(bytes, vbriOffset + 14)
      if (frames > 0) return frames * frameSeconds
    }
    if (audioBytes > offset) return ((audioBytes - offset) * 8) / (header.bitrateKbps * 1000)
    return undefined
  }
  return undefined
}

export type RangeReader = (start: number, endInclusive: number) => Promise<Uint8Array>

const HEAD_BYTES = 64 * 1024

/** Duracion en segundos leyendo solo la cabecera (1-2 peticiones con Range). */
export const probeMp3Duration = async (read: RangeReader, fileSize: number): Promise<number | undefined> => {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return undefined
  const head = await read(0, Math.min(fileSize, HEAD_BYTES) - 1)
  const tagSize = id3v2Size(head)
  let frames: Uint8Array
  if (tagSize + 4096 <= head.length) {
    frames = head.subarray(tagSize)
  } else {
    // Etiqueta grande (p. ej. con caratula incrustada): se pide justo detras.
    if (tagSize >= fileSize) return undefined
    frames = await read(tagSize, Math.min(fileSize, tagSize + 8192) - 1)
  }
  const seconds = mp3DurationFromFrames(frames, fileSize - tagSize)
  return seconds && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}
