import { describe, expect, it } from 'vitest'
import { id3v2Size, probeMp3Duration } from './mp3-duration'

// MPEG1 Layer III, 128 kbps, 44.1 kHz, joint stereo (side info de 32 bytes).
const FRAME_HEADER = [0xff, 0xfb, 0x90, 0x64]

const frameWithInfo = (tag: 'Info' | 'Xing', frames: number): Uint8Array => {
  const bytes = new Uint8Array(417)
  bytes.set(FRAME_HEADER, 0)
  const offset = 4 + 32
  bytes.set([...tag].map((char) => char.charCodeAt(0)), offset)
  new DataView(bytes.buffer).setUint32(offset + 4, 0x0f)
  new DataView(bytes.buffer).setUint32(offset + 8, frames)
  return bytes
}

const id3Tag = (payloadSize: number): Uint8Array => {
  const bytes = new Uint8Array(10 + payloadSize)
  bytes.set([0x49, 0x44, 0x33, 4, 0, 0], 0)
  bytes.set([(payloadSize >> 21) & 0x7f, (payloadSize >> 14) & 0x7f, (payloadSize >> 7) & 0x7f, payloadSize & 0x7f], 6)
  return bytes
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const reader = (file: Uint8Array) => async (start: number, end: number) => file.subarray(start, end + 1)

describe('mp3 duration', () => {
  it('lee el numero de frames de la cabecera Info', async () => {
    const file = concat(id3Tag(400), frameWithInfo('Info', 1000), new Uint8Array(8000))
    const seconds = await probeMp3Duration(reader(file), file.length)
    expect(seconds).toBeCloseTo((1000 * 1152) / 44100, 3)
  })

  it('pide un segundo trozo si la etiqueta ID3 es mas grande que la cabecera leida', async () => {
    const file = concat(id3Tag(100_000), frameWithInfo('Xing', 5000), new Uint8Array(8000))
    const ranges: Array<[number, number]> = []
    const seconds = await probeMp3Duration(async (start, end) => {
      ranges.push([start, end])
      return file.subarray(start, end + 1)
    }, file.length)
    expect(seconds).toBeCloseTo((5000 * 1152) / 44100, 3)
    expect(ranges).toHaveLength(2)
    expect(ranges[1][0]).toBe(id3v2Size(file))
  })

  it('sin cabecera Xing usa tamano / bitrate (CBR)', async () => {
    const audio = new Uint8Array(160_000)
    audio.set(FRAME_HEADER, 0)
    const seconds = await probeMp3Duration(reader(audio), audio.length)
    expect(seconds).toBeCloseTo((160_000 * 8) / 128_000, 3)
  })

  it('devuelve undefined si no es un MP3', async () => {
    const file = new Uint8Array(10_000)
    expect(await probeMp3Duration(reader(file), file.length)).toBeUndefined()
  })
})
