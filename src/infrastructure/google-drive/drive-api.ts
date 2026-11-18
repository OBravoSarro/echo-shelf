import { z } from 'zod'
import type { DriveFile, DriveListResponse } from './types'

const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  parents: z.array(z.string()).optional(),
  size: z.string().optional(),
  modifiedTime: z.string().optional(),
  webViewLink: z.string().optional(),
  thumbnailLink: z.string().optional(),
  imageMediaMetadata: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
  videoMediaMetadata: z
    .object({
      durationMillis: z.string().optional(),
    })
    .optional(),
})

const driveListSchema = z.object({
  files: z.array(driveFileSchema),
  nextPageToken: z.string().optional(),
})

const COMPACT_EVERY_BYTES = 4 * 1024 * 1024

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'

const parseDriveError = async (response: Response): Promise<string> => {
  try {
    const json = (await response.json()) as {
      error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> }
    }
    const message = json.error?.message
    const reason = json.error?.errors?.[0]?.reason
    if (message && reason) return `${response.status} ${reason}: ${message}`
    if (message) return `${response.status}: ${message}`
  } catch {
    return `${response.status}`
  }
  return `${response.status}`
}

export class DriveHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DriveHttpError'
    this.status = status
  }
}

export interface DownloadProgress {
  loaded: number
  total?: number
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
  /** Tamano esperado cuando el servidor no envia Content-Length. */
  expectedSize?: number
  /** MIME del blob resultante (Drive suele responder application/octet-stream). */
  mimeType?: string
}

const withAuth = async (url: URL, accessToken: string): Promise<Response> => {
  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

export const driveApi = {
  async ping(accessToken: string, rootId: string): Promise<void> {
    const url = new URL(`${DRIVE_BASE}/files`)
    url.searchParams.set('q', `'${rootId}' in parents and trashed = false`)
    url.searchParams.set('fields', 'files(id)')
    url.searchParams.set('pageSize', '1')
    url.searchParams.set('includeItemsFromAllDrives', 'true')
    url.searchParams.set('supportsAllDrives', 'true')
    const response = await withAuth(url, accessToken)
    if (!response.ok) {
      const detail = await parseDriveError(response)
      throw new Error(`Drive auth check failed: ${detail}`)
    }
  },

  async listFolders(accessToken: string, parentId: string): Promise<DriveFile[]> {
    const children = await this.listChildren(accessToken, parentId)
    return children
      .filter((item) => item.mimeType === 'application/vnd.google-apps.folder')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  },

  async listChildren(accessToken: string, parentId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const url = new URL(`${DRIVE_BASE}/files`)
      url.searchParams.set('q', `'${parentId}' in parents and trashed = false`)
      url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,parents,size,modifiedTime,webViewLink,thumbnailLink,imageMediaMetadata,videoMediaMetadata)')
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('orderBy', 'folder,name_natural')
      url.searchParams.set('includeItemsFromAllDrives', 'true')
      url.searchParams.set('supportsAllDrives', 'true')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const response = await withAuth(url, accessToken)
      if (!response.ok) {
        const detail = await parseDriveError(response)
        throw new Error(`Drive list failed: ${detail}`)
      }
      const json = await response.json()
      const parsed: DriveListResponse = driveListSchema.parse(json)
      files.push(...parsed.files)
      pageToken = parsed.nextPageToken
    } while (pageToken)
    return files
  },

  async listFolderTree(accessToken: string, rootId: string): Promise<DriveFile[]> {
    const all: DriveFile[] = []
    const queue: string[] = [rootId]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break
      const children = await this.listChildren(accessToken, current)
      all.push(...children)
      for (const child of children) {
        if (child.mimeType === 'application/vnd.google-apps.folder') {
          queue.push(child.id)
        }
      }
    }
    return all
  },

  async download(accessToken: string, fileId: string, options: AbortSignal | DownloadOptions = {}): Promise<Blob> {
    const opts: DownloadOptions = options instanceof AbortSignal ? { signal: options } : options
    const url = new URL(`${DRIVE_BASE}/files/${fileId}`)
    url.searchParams.set('alt', 'media')
    url.searchParams.set('supportsAllDrives', 'true')
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: opts.signal,
    })
    if (!response.ok) {
      const detail = await parseDriveError(response)
      throw new DriveHttpError(`Drive download failed: ${detail}`, response.status)
    }
    const type = opts.mimeType ?? response.headers.get('content-type') ?? undefined
    if (!opts.onProgress || !response.body) {
      const blob = await response.blob()
      return opts.mimeType && blob.type !== opts.mimeType ? new Blob([blob], { type }) : blob
    }
    const headerLength = Number(response.headers.get('content-length'))
    const total = Number.isFinite(headerLength) && headerLength > 0 ? headerLength : opts.expectedSize
    const reader = response.body.getReader()
    // Compactamos los trozos en Blobs cada pocos MB: el motor puede sacar esos
    // datos del heap de JS, lo que reduce los picos de memoria en iPhone con
    // capitulos de 50-100 MB (Safari mata la pestana si se pasa).
    const parts: Blob[] = []
    let chunks: Uint8Array[] = []
    let chunkBytes = 0
    let loaded = 0
    opts.onProgress({ loaded, total })
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        chunkBytes += value.byteLength
        loaded += value.byteLength
        if (chunkBytes >= COMPACT_EVERY_BYTES) {
          parts.push(new Blob(chunks as BlobPart[]))
          chunks = []
          chunkBytes = 0
        }
        opts.onProgress({ loaded, total })
      }
    }
    if (chunks.length > 0) parts.push(new Blob(chunks as BlobPart[]))
    return new Blob(parts, { type })
  },
}
