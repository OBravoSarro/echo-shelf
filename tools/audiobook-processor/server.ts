import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { VOICE_PRESETS, buildCoverArgs, buildPreviewArgs } from './lib/ffmpeg-args.ts'
import { checkTools, probeFile, runFfmpeg } from './lib/ffmpeg.ts'
import { JobManager } from './lib/jobs.ts'
import { buildFolderName, coverExtension } from './lib/naming.ts'
import { splitByInterval } from './lib/probe-parser.ts'
import type { JobState } from './lib/types.ts'

const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(TOOL_DIR, 'public')
const WORKSPACE_DIR = process.env.AUDIOBOOK_WORKSPACE ?? join(TOOL_DIR, 'workspace')
const INPUT_DIR = join(WORKSPACE_DIR, 'input')
const OUTPUT_DIR = join(WORKSPACE_DIR, 'output')
// Loopback only: this tool reads/writes local files and must never be reachable from the network.
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4517)

const INPUT_EXTENSIONS = new Set(['.m4b', '.m4a', '.mp4', '.mp3', '.aac', '.ogg', '.opus', '.flac', '.wav'])
const MAX_PREVIEW_SECONDS = 60

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wav': 'audio/wav',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

await mkdir(INPUT_DIR, { recursive: true })
await mkdir(OUTPUT_DIR, { recursive: true })
const CACHE_DIR = await mkdtemp(join(tmpdir(), 'echo-shelf-audiobook-'))
const jobs = new JobManager(INPUT_DIR, OUTPUT_DIR)

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const sendFile = async (res: ServerResponse, path: string, cache = 'no-store') => {
  const info = await stat(path)
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': cache,
  })
  await pipeline(createReadStream(path), res)
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

/** Only plain file names that live directly in input/ are accepted (no path traversal). */
const resolveInputFile = async (name: string | null): Promise<string> => {
  if (!name || basename(name) !== name || name.startsWith('.')) throw new HttpError(400, 'Nombre de fichero inválido')
  const path = join(INPUT_DIR, name)
  try {
    if ((await stat(path)).isFile()) return path
  } catch {
    // fallthrough
  }
  throw new HttpError(404, `No existe ${name} en la carpeta input`)
}

const cacheKey = (...parts: (string | number)[]): string =>
  createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)

const listInputFiles = async () => {
  const entries = await readdir(INPUT_DIR, { withFileTypes: true })
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile() && !e.name.startsWith('.') && INPUT_EXTENSIONS.has(extname(e.name).toLowerCase()))
      .map(async (e) => {
        const info = await stat(join(INPUT_DIR, e.name))
        return { name: e.name, sizeBytes: info.size, modifiedAt: info.mtimeMs }
      }),
  )
  return files.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

const listOutputFolders = async () => {
  const entries = await readdir(OUTPUT_DIR, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort()
}

const metaSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio'),
  author: z.string().trim(),
  narrator: z.string().trim(),
  year: z.string().optional(),
  genre: z.string().optional(),
})

const processSchema = z.object({
  file: z.string().min(1),
  folderName: z.string().trim().min(1),
  meta: metaSchema,
  chapters: z
    .array(
      z
        .object({ title: z.string().trim(), start: z.number().min(0), end: z.number().positive() })
        .refine((c) => c.end > c.start, 'Un capítulo termina antes de empezar'),
    )
    .min(1, 'Selecciona al menos un capítulo'),
  enhance: z.boolean(),
  preset: z.enum(['soft', 'strong']),
  bitrateKbps: z.number().int().min(32).max(320),
})

const streamJob = (req: IncomingMessage, res: ServerResponse, id: string) => {
  const job = jobs.get(id)
  if (!job) throw new HttpError(404, 'Trabajo no encontrado')
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  const send = (state: JobState) => res.write(`data: ${JSON.stringify(state)}\n\n`)
  send(job.state)
  if (job.state.status !== 'running') return res.end()
  const onEnd = (state: JobState) => {
    send(state)
    res.end()
  }
  job.events.on('update', send)
  job.events.once('end', onEnd)
  req.on('close', () => {
    job.events.off('update', send)
    job.events.off('end', onEnd)
  })
}

const openInFinder = (path: string) => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  spawn(command, [path], { detached: true, stdio: 'ignore' }).unref()
}

const handleApi = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
  const { pathname } = url
  const method = req.method ?? 'GET'

  if (method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, {
      tools: await checkTools(),
      inputDir: INPUT_DIR,
      outputDir: OUTPUT_DIR,
      presets: Object.fromEntries(
        Object.entries(VOICE_PRESETS).map(([key, p]) => [key, { label: p.label, description: p.description }]),
      ),
    })
  }

  if (method === 'GET' && pathname === '/api/files') {
    return sendJson(res, 200, { files: await listInputFiles(), outputs: await listOutputFolders() })
  }

  if (method === 'POST' && pathname === '/api/upload') {
    const name = basename(url.searchParams.get('name') ?? '')
    if (!name || name.startsWith('.') || !INPUT_EXTENSIONS.has(extname(name).toLowerCase())) {
      throw new HttpError(400, 'Formato no soportado')
    }
    const partial = join(INPUT_DIR, `.${name}.part`)
    try {
      await pipeline(req, createWriteStream(partial))
      await rename(partial, join(INPUT_DIR, name))
    } catch (e) {
      await rm(partial, { force: true })
      throw e
    }
    return sendJson(res, 201, { name })
  }

  if (method === 'GET' && pathname === '/api/probe') {
    const path = await resolveInputFile(url.searchParams.get('file'))
    const probe = await probeFile(path)
    const outputs = await listOutputFolders()
    const folderName = buildFolderName(probe.meta)
    return sendJson(res, 200, { ...probe, folderName, folderExists: outputs.includes(folderName) })
  }

  if (method === 'GET' && pathname === '/api/folder-name') {
    const meta = {
      title: url.searchParams.get('title') ?? '',
      author: url.searchParams.get('author') ?? '',
      narrator: url.searchParams.get('narrator') ?? '',
    }
    const folderName = buildFolderName(meta)
    return sendJson(res, 200, { folderName, folderExists: (await listOutputFolders()).includes(folderName) })
  }

  if (method === 'GET' && pathname === '/api/split') {
    const duration = Number(url.searchParams.get('duration'))
    const minutes = Number(url.searchParams.get('minutes'))
    if (!(duration > 0) || !(minutes > 0)) throw new HttpError(400, 'Duración o minutos inválidos')
    return sendJson(res, 200, { chapters: splitByInterval(duration, minutes) })
  }

  if (method === 'GET' && pathname === '/api/cover') {
    const path = await resolveInputFile(url.searchParams.get('file'))
    const probe = await probeFile(path)
    if (!probe.cover) throw new HttpError(404, 'Sin portada')
    const info = await stat(path)
    const out = join(CACHE_DIR, `cover-${cacheKey(path, info.mtimeMs)}.${coverExtension(probe.cover.codec)}`)
    try {
      await stat(out)
    } catch {
      await runFfmpeg(buildCoverArgs(path, probe.cover.streamIndex, out))
    }
    return sendFile(res, out, 'max-age=3600')
  }

  if (method === 'GET' && pathname === '/api/preview') {
    const path = await resolveInputFile(url.searchParams.get('file'))
    const mode = z.enum(['original', 'soft', 'strong']).parse(url.searchParams.get('mode') ?? 'original')
    const at = Math.max(0, Number(url.searchParams.get('at') ?? 0) || 0)
    const duration = Math.min(MAX_PREVIEW_SECONDS, Math.max(5, Number(url.searchParams.get('duration') ?? 30) || 30))
    const info = await stat(path)
    const out = join(CACHE_DIR, `preview-${cacheKey(path, info.mtimeMs, at, duration, mode)}.wav`)
    try {
      await stat(out)
    } catch {
      const probe = await probeFile(path)
      await runFfmpeg(buildPreviewArgs({ input: path, output: out, at, duration, mode, sampleRate: probe.sampleRate }))
    }
    return sendFile(res, out)
  }

  if (method === 'POST' && pathname === '/api/jobs') {
    if (jobs.hasRunningJob()) throw new HttpError(409, 'Ya hay un proceso en marcha')
    const parsed = processSchema.safeParse(await readJson(req))
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    await resolveInputFile(parsed.data.file)
    return sendJson(res, 202, jobs.start(parsed.data))
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)(\/events|\/cancel)?$/)
  if (jobMatch) {
    const [, id, action] = jobMatch
    if (method === 'GET' && action === '/events') return streamJob(req, res, id)
    if (method === 'POST' && action === '/cancel') return sendJson(res, 200, { cancelled: jobs.cancel(id) })
    if (method === 'GET' && !action) {
      const job = jobs.get(id)
      if (!job) throw new HttpError(404, 'Trabajo no encontrado')
      return sendJson(res, 200, job.state)
    }
  }

  if (method === 'POST' && pathname === '/api/open') {
    const body = z
      .object({ target: z.enum(['input', 'output']), folder: z.string().optional() })
      .parse(await readJson(req))
    let target = body.target === 'input' ? INPUT_DIR : OUTPUT_DIR
    if (body.target === 'output' && body.folder) {
      if (basename(body.folder) !== body.folder) throw new HttpError(400, 'Carpeta inválida')
      target = join(OUTPUT_DIR, body.folder)
    }
    openInFinder(target)
    return sendJson(res, 200, { opened: target })
  }

  throw new HttpError(404, 'Ruta no encontrada')
}

const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/styles.css': 'styles.css',
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    const file = STATIC_FILES[url.pathname]
    if (req.method === 'GET' && file) return await sendFile(res, join(PUBLIC_DIR, file))
    sendJson(res, 404, { error: 'No encontrado' })
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500
    const message = e instanceof z.ZodError ? e.issues.map((i) => i.message).join('; ') : (e as Error).message
    if (status === 500) console.error(e)
    if (!res.headersSent) sendJson(res, status, { error: message })
    else res.end()
  }
})

const shutdown = async () => {
  server.close()
  await rm(CACHE_DIR, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(PORT, HOST, async () => {
  const { ffmpeg, ffprobe } = await checkTools()
  console.log(`\n  EchoShelf · Procesador de audiolibros`)
  console.log(`  → http://${HOST}:${PORT}\n`)
  console.log(`  input:  ${INPUT_DIR}`)
  console.log(`  output: ${OUTPUT_DIR}`)
  if (!ffmpeg.available || !ffprobe.available) {
    console.warn('\n  ⚠ ffmpeg/ffprobe no encontrados. Instálalos con: brew install ffmpeg\n')
  } else {
    console.log(`  ${ffmpeg.version}\n`)
  }
})
