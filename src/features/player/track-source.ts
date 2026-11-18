import type { AudioTrack } from '../../domain/audiobook'
import { DriveHttpError, driveApi, type DownloadProgress } from '../../infrastructure/google-drive/drive-api'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { useAuthStore } from '../auth/auth-store'

export type { DownloadProgress }

interface InflightFetch {
  promise: Promise<Blob>
  controller: AbortController
  subscribers: number
  listeners: Set<(progress: DownloadProgress) => void>
  last?: DownloadProgress
}

/**
 * Descargas de Drive en curso, indexadas por trackId. Reproductor y cola de
 * descargas comparten la misma peticion: nunca se baja dos veces el mismo
 * capitulo a la vez (importante con datos moviles).
 */
const inflight = new Map<string, InflightFetch>()

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError')

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === 'AbortError' : error instanceof Error && error.name === 'AbortError'

/** Devuelve el audio guardado en el dispositivo, o null si no esta descargado. */
export const readLocalTrack = async (trackId: string): Promise<Blob | null> => {
  try {
    return await fileStorage.read(trackId)
  } catch {
    // Entrada en Dexie sin fichero OPFS (borrado por el sistema, etc.)
    return null
  }
}

const getDriveToken = async (forceRefresh = false): Promise<string> => {
  const auth = useAuthStore.getState()
  const fresh = auth.accessToken && (!auth.expiresAt || auth.expiresAt > Date.now() + 30_000)
  if (!forceRefresh && fresh && auth.accessToken) return auth.accessToken
  await auth.refresh()
  const token = useAuthStore.getState().accessToken
  if (!token) {
    throw new Error('Sesion de Google Drive caducada. Vuelve a conectar Drive para escuchar capitulos no descargados.')
  }
  return token
}

const downloadWithAuth = async (track: AudioTrack, entry: InflightFetch): Promise<Blob> => {
  if (!track.driveFileId) {
    throw new Error('Este capitulo no tiene audio asociado.')
  }
  const options = {
    signal: entry.controller.signal,
    expectedSize: track.fileSize,
    mimeType: track.mimeType,
    onProgress: (progress: DownloadProgress) => {
      entry.last = progress
      entry.listeners.forEach((listener) => listener(progress))
    },
  }
  const token = await getDriveToken()
  try {
    return await driveApi.download(token, track.driveFileId, options)
  } catch (error) {
    if (error instanceof DriveHttpError && error.status === 401) {
      return driveApi.download(await getDriveToken(true), track.driveFileId, options)
    }
    throw error
  }
}

export const isTrackFetching = (trackId: string): boolean => inflight.has(trackId)

/**
 * Descarga un capitulo de Drive reutilizando una descarga en curso si existe.
 * Abortar `signal` solo cancela la peticion real cuando ningun otro
 * consumidor la sigue esperando.
 */
export const fetchRemoteTrack = (
  track: AudioTrack,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void } = {},
): Promise<Blob> => {
  if (signal?.aborted) return Promise.reject(abortError())

  let entry = inflight.get(track.id)
  if (!entry) {
    const created: InflightFetch = {
      controller: new AbortController(),
      subscribers: 0,
      listeners: new Set(),
      promise: Promise.resolve(new Blob()),
    }
    created.promise = downloadWithAuth(track, created).finally(() => {
      if (inflight.get(track.id) === created) inflight.delete(track.id)
    })
    // Evita "unhandled rejection" si todos los consumidores abortan.
    created.promise.catch(() => undefined)
    inflight.set(track.id, created)
    entry = created
  }

  const current = entry
  current.subscribers += 1
  if (onProgress) {
    current.listeners.add(onProgress)
    if (current.last) onProgress(current.last)
  }

  return new Promise<Blob>((resolve, reject) => {
    let settled = false
    const detach = () => {
      if (onProgress) current.listeners.delete(onProgress)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      detach()
      current.subscribers -= 1
      if (current.subscribers <= 0) current.controller.abort()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    current.promise.then(
      (blob) => {
        if (settled) return
        settled = true
        detach()
        resolve(blob)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        detach()
        reject(error)
      },
    )
  })
}
