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

  async download(accessToken: string, fileId: string, signal?: AbortSignal): Promise<Blob> {
    const url = new URL(`${DRIVE_BASE}/files/${fileId}`)
    url.searchParams.set('alt', 'media')
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    })
    if (!response.ok) {
      const detail = await parseDriveError(response)
      throw new Error(`Drive download failed: ${detail}`)
    }
    return response.blob()
  },
}
