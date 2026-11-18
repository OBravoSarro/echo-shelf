import { db } from './db'

const ROOT = 'echo-shelf-audio'

/**
 * OPFS con escritura desde el hilo principal. Safari/iOS anteriores a 26
 * exponen `getDirectory` pero NO `createWritable` (solo SyncAccessHandle en
 * workers), asi que en ese caso usamos IndexedDB con el Blob.
 */
const supportsOPFS = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.storage?.getDirectory === 'function' &&
  typeof FileSystemFileHandle !== 'undefined' &&
  typeof (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable === 'function'

let persistRequested = false

/**
 * Pide almacenamiento persistente para que el sistema (p. ej. Safari con su
 * borrado a los 7 dias sin uso) no elimine los capitulos descargados.
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (persistRequested) return false
  persistRequested = true
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

const getOpfsFile = async (path: string, create = false): Promise<FileSystemFileHandle> => {
  const root = await navigator.storage!.getDirectory()
  const appDir = await root.getDirectoryHandle(ROOT, { create: true })
  return appDir.getFileHandle(path, { create })
}

export const fileStorage = {
  async save(id: string, blob: Blob, mimeType: string): Promise<string> {
    const now = new Date().toISOString()
    void requestPersistentStorage()
    if (supportsOPFS()) {
      try {
        const path = `${id}.bin`
        const handle = await getOpfsFile(path, true)
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        await db.files.put({ id, opfsPath: path, mimeType, size: blob.size, updatedAt: now })
        return `opfs:${path}`
      } catch {
        // Cae a IndexedDB
      }
    }
    await db.files.put({ id, blob, mimeType, size: blob.size, updatedAt: now })
    return `idb:${id}`
  },

  async read(id: string): Promise<Blob | null> {
    const entry = await db.files.get(id)
    if (!entry) return null
    if (entry.opfsPath) {
      if (typeof navigator.storage?.getDirectory !== 'function') return null
      const handle = await getOpfsFile(entry.opfsPath)
      const file = await handle.getFile()
      // Los ficheros .bin se leen sin tipo; Safari no reproduce blobs sin MIME.
      return file.type ? file : new Blob([file], { type: entry.mimeType })
    }
    if (!entry.blob) return null
    return entry.blob.type ? entry.blob : new Blob([entry.blob], { type: entry.mimeType })
  },

  async remove(id: string): Promise<void> {
    const entry = await db.files.get(id)
    if (entry?.opfsPath && typeof navigator.storage?.getDirectory === 'function') {
      try {
        const root = await navigator.storage.getDirectory()
        const appDir = await root.getDirectoryHandle(ROOT)
        await appDir.removeEntry(entry.opfsPath)
      } catch {
        // Ya no existia
      }
    }
    await db.files.delete(id)
  },

  isUsingOPFS(): boolean {
    return supportsOPFS()
  },
}
