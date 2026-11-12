import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { cpus } from 'node:os'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildChapterArgs, buildCoverArgs } from './ffmpeg-args.ts'
import { probeFile, runFfmpeg } from './ffmpeg.ts'
import { chapterFileName, coverExtension, outputExtension, sanitizeSegment } from './naming.ts'
import type { JobState, ProcessRequest } from './types.ts'

const MAX_LOG_LINES = 200
const EMIT_THROTTLE_MS = 250

const defaultConcurrency = (): number => Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

interface JobEntry {
  state: JobState
  events: EventEmitter
  controller: AbortController
}

export class JobManager {
  private readonly jobs = new Map<string, JobEntry>()
  private readonly inputDir: string
  private readonly outputDir: string

  constructor(inputDir: string, outputDir: string) {
    this.inputDir = inputDir
    this.outputDir = outputDir
  }

  get(id: string): JobEntry | undefined {
    return this.jobs.get(id)
  }

  hasRunningJob(): boolean {
    return [...this.jobs.values()].some((j) => j.state.status === 'running')
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job || job.state.status !== 'running') return false
    job.controller.abort()
    return true
  }

  start(request: ProcessRequest): JobState {
    const folderName = sanitizeSegment(request.folderName)
    const id = randomUUID()
    const state: JobState = {
      id,
      file: request.file,
      folderName,
      outputDir: join(this.outputDir, folderName),
      enhance: request.enhance,
      preset: request.preset,
      status: 'running',
      startedAt: Date.now(),
      chapters: [],
      log: [],
    }
    const entry: JobEntry = { state, events: new EventEmitter(), controller: new AbortController() }
    entry.events.setMaxListeners(20)
    this.jobs.set(id, entry)
    void this.run(entry, request)
    return state
  }

  private async run(entry: JobEntry, request: ProcessRequest): Promise<void> {
    const { state, controller } = entry
    let lastEmit = 0
    const emit = (force = false) => {
      const now = Date.now()
      if (!force && now - lastEmit < EMIT_THROTTLE_MS) return
      lastEmit = now
      entry.events.emit('update', state)
    }
    const log = (line: string) => {
      state.log.push(`[${new Date().toLocaleTimeString('es-ES')}] ${line}`)
      if (state.log.length > MAX_LOG_LINES) state.log.shift()
      emit(true)
    }

    const input = join(this.inputDir, request.file)
    // Write into a temp folder and swap at the end: a failed or cancelled run never leaves
    // a half-populated folder that could be uploaded to Drive by mistake.
    const tempDir = join(this.outputDir, `.tmp-${state.id}`)

    try {
      const probe = await probeFile(input)
      const ext = outputExtension(probe.codec, request.enhance)
      const total = request.chapters.length
      if (total === 0) throw new Error('No hay capítulos seleccionados')

      state.chapters = request.chapters.map((c, i) => ({
        position: i + 1,
        title: c.title,
        fileName: chapterFileName(i + 1, total, c.title, ext),
        duration: Math.max(0, c.end - c.start),
        progress: 0,
        status: 'pending',
      }))
      await mkdir(tempDir, { recursive: true })
      log(
        request.enhance
          ? `Procesando ${total} capítulos con mejora de voz (${request.preset}, AAC ${request.bitrateKbps} kbps)`
          : `Cortando ${total} capítulos sin recodificar (copia directa)`,
      )

      if (probe.cover) {
        const coverPath = join(tempDir, `cover.${coverExtension(probe.cover.codec)}`)
        try {
          await runFfmpeg(buildCoverArgs(input, probe.cover.streamIndex, coverPath), { signal: controller.signal })
          log('Portada extraída')
        } catch (e) {
          if (controller.signal.aborted) throw e
          log(`No se pudo extraer la portada: ${(e as Error).message.split('\n')[0]}`)
        }
      }

      let cursor = 0
      const worker = async () => {
        while (cursor < state.chapters.length) {
          if (controller.signal.aborted) return
          const chapterState = state.chapters[cursor]
          const selection = request.chapters[cursor]
          cursor += 1
          chapterState.status = 'running'
          emit(true)
          await runFfmpeg(
            buildChapterArgs({
              input,
              output: join(tempDir, chapterState.fileName),
              start: selection.start,
              end: selection.end,
              enhance: request.enhance,
              preset: request.preset,
              bitrateKbps: request.bitrateKbps,
              sampleRate: probe.sampleRate,
              meta: request.meta,
              title: selection.title,
              track: chapterState.position,
              totalTracks: total,
            }),
            {
              signal: controller.signal,
              onProgress: (seconds) => {
                chapterState.progress = chapterState.duration > 0 ? Math.min(1, seconds / chapterState.duration) : 0
                emit()
              },
            },
          ).catch((e: Error) => {
            chapterState.status = 'error'
            chapterState.error = e.message
            throw e
          })
          chapterState.progress = 1
          chapterState.status = 'done'
          log(`✓ ${chapterState.fileName}`)
        }
      }

      await Promise.all(Array.from({ length: defaultConcurrency() }, worker))
      if (controller.signal.aborted) throw new Error('Cancelado')

      if (await exists(state.outputDir)) {
        await rm(state.outputDir, { recursive: true, force: true })
        log('Carpeta de salida anterior reemplazada')
      }
      await rename(tempDir, state.outputDir)
      state.status = 'done'
      state.finishedAt = Date.now()
      log(`Terminado en ${Math.round((state.finishedAt - state.startedAt) / 1000)} s → ${state.outputDir}`)
    } catch (e) {
      controller.abort()
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      state.finishedAt = Date.now()
      const message = (e as Error).message
      if (message === 'Cancelado') {
        state.status = 'cancelled'
        log('Proceso cancelado. No se ha generado nada.')
      } else {
        state.status = 'error'
        state.error = message
        log(`Error: ${message}`)
      }
    } finally {
      emit(true)
      entry.events.emit('end', state)
    }
  }
}
