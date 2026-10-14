import { db } from './db'

const ROOT = 'echo-shelf-audio'

const supportsOPFS = (): boolean => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'

const getOpfsFile = async (path: string, create = false): Promise<FileSystemFileHandle> => {
  const root = await navigator.storage!.getDirectory()
  const appDir = await root.getDirectoryHandle(ROOT, { create: true })
  return appDir.getFileHandle(path, { create })
}

export const fileStorage = {
  async save(id: string, blob: Blob, mimeType: string): Promise<string> {
    const now = new Date().toISOString()
    if (supportsOPFS()) {
      const path = `${id}.bin`
      const handle = await getOpfsFile(path, true)
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      await db.files.put({ id, opfsPath: path, mimeType, size: blob.size, updatedAt: now })
      return `opfs:${path}`
    }
    await db.files.put({ id, blob, mimeType, size: blob.size, updatedAt: now })
    return `idb:${id}`
  },

  async read(id: string): Promise<Blob | null> {
    const entry = await db.files.get(id)
    if (!entry) return null
    if (entry.opfsPath && supportsOPFS()) {
      const handle = await getOpfsFile(entry.opfsPath)
      const file = await handle.getFile()
      return file
    }
    return entry.blob ?? null
  },

  async remove(id: string): Promise<void> {
    const entry = await db.files.get(id)
    if (entry?.opfsPath && supportsOPFS()) {
      const root = await navigator.storage!.getDirectory()
      const appDir = await root.getDirectoryHandle(ROOT)
      await appDir.removeEntry(entry.opfsPath)
    }
    await db.files.delete(id)
  },

  isUsingOPFS(): boolean {
    return supportsOPFS()
  },
}
