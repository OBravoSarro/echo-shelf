import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { buildProbeArgs, parseProgressSeconds } from './ffmpeg-args.ts'
import { parseProbe, type RawProbe } from './probe-parser.ts'
import type { ProbeResult } from './types.ts'

export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'
export const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe'

export interface BinaryStatus {
  available: boolean
  version?: string
  error?: string
}

const firstLine = (text: string): string => text.split('\n')[0]?.trim() ?? ''

const checkBinary = (bin: string): Promise<BinaryStatus> =>
  new Promise((resolve) => {
    const child = spawn(bin, ['-version'])
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', (err) => resolve({ available: false, error: err.message }))
    child.on('close', (code) =>
      resolve(code === 0 ? { available: true, version: firstLine(out) } : { available: false, error: `exit ${code}` }),
    )
  })

export const checkTools = async (): Promise<{ ffmpeg: BinaryStatus; ffprobe: BinaryStatus }> => {
  const [ffmpeg, ffprobe] = await Promise.all([checkBinary(FFMPEG), checkBinary(FFPROBE)])
  return { ffmpeg, ffprobe }
}

export interface RunOptions {
  onProgress?: (seconds: number) => void
  signal?: AbortSignal
}

export const runFfmpeg = (args: string[], options: RunOptions = {}): Promise<void> =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Cancelado'))
    const child = spawn(FFMPEG, args)
    let stderr = ''
    const onAbort = () => child.kill('SIGKILL')
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d: Buffer) => {
      const seconds = parseProgressSeconds(d.toString())
      if (seconds !== undefined) options.onProgress?.(seconds)
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000)
    })
    child.on('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) return reject(new Error('Cancelado'))
      if (code === 0) return resolve()
      const lastLines = stderr.trim().split('\n').slice(-5).join('\n')
      reject(new Error(`ffmpeg terminó con código ${code}\n${lastLines}`))
    })
  })

export const probeFile = (path: string): Promise<ProbeResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(FFPROBE, buildProbeArgs(path))
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffprobe terminó con código ${code}`))
      try {
        const raw = JSON.parse(out) as RawProbe
        const { size } = await stat(path)
        resolve(parseProbe(raw, basename(path), size))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
