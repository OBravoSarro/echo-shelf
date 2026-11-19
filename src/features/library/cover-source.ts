import type { Audiobook } from '../../domain/audiobook'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { useAuthStore } from '../auth/auth-store'

/**
 * Fuente unica de portadas para la UI y para la pantalla de bloqueo / CarPlay /
 * Android Auto. Siempre local primero: una portada que ya se ha visto una vez
 * queda guardada en el dispositivo y no vuelve a depender de la red ni del
 * token de Drive.
 */

/** Cache servida por el service worker (ver `runtimeCaching` en vite.config.ts). */
export const COVER_CACHE_NAME = 'book-covers'
const ARTWORK_MAX_PX = 512

type CoverRef = Pick<Audiobook, 'id' | 'coverFileId' | 'coverUrl'>

export const isDriveHostedCoverUrl = (value?: string): boolean => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return (
      parsed.hostname.includes('drive.google.com') ||
      parsed.hostname.includes('googleusercontent.com') ||
      parsed.searchParams.has('id')
    )
  } catch {
    return false
  }
}

export const extractDriveFileIdFromUrl = (url?: string): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).searchParams.get('id') ?? undefined
  } catch {
    return undefined
  }
}

const blobRequests = new Map<string, Promise<Blob | null>>()
const objectUrls = new Map<string, string>()

const fetchCoverBlob = async (bookId: string | undefined, fileId: string): Promise<Blob | null> => {
  const localId = bookId ? `cover-${bookId}` : undefined
  if (localId) {
    try {
      const local = await fileStorage.read(localId)
      if (local) return local
    } catch {
      // Entrada sin fichero: se vuelve a bajar.
    }
  }
  const token = useAuthStore.getState().accessToken
  if (!token || (typeof navigator !== 'undefined' && !navigator.onLine)) return null
  try {
    const blob = await driveApi.download(token, fileId)
    if (localId) void fileStorage.save(localId, blob, blob.type || 'image/jpeg').catch(() => undefined)
    return blob
  } catch {
    return null
  }
}

/** Portada de Drive como Blob: del dispositivo si existe; si no, se baja y se guarda. */
export const loadCoverBlob = (bookId: string | undefined, fileId: string): Promise<Blob | null> => {
  const key = `${bookId ?? ''}:${fileId}`
  let request = blobRequests.get(key)
  if (!request) {
    request = fetchCoverBlob(bookId, fileId).then((blob) => {
      // Un fallo (sin red, sin token) no se memoriza: se reintenta mas tarde.
      if (!blob) blobRequests.delete(key)
      return blob
    })
    blobRequests.set(key, request)
  }
  return request
}

/** URL de objeto compartida por toda la app (una por portada, no una por componente). */
export const getCoverObjectUrl = async (bookId: string | undefined, fileId: string): Promise<string | undefined> => {
  const key = `${bookId ?? ''}:${fileId}`
  const known = objectUrls.get(key)
  if (known) return known
  const blob = await loadCoverBlob(bookId, fileId)
  if (!blob) return undefined
  const existing = objectUrls.get(key)
  if (existing) return existing
  const url = URL.createObjectURL(blob)
  objectUrls.set(key, url)
  return url
}

interface ScaledImage {
  blob: Blob
  width: number
  height: number
}

/** Reduce la portada a un JPEG pequeno: el sistema la carga antes y con menos memoria. */
const downscale = async (blob: Blob): Promise<ScaledImage | undefined> => {
  try {
    if (typeof createImageBitmap !== 'function') return undefined
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, ARTWORK_MAX_PX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const scaled = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return scaled ? { blob: scaled, width, height } : undefined
  } catch {
    return undefined
  }
}

/**
 * Publica la portada en una URL https del propio origen (servida desde cache
 * por el service worker). iOS pierde con facilidad las caratulas `blob:` al
 * pasar la app a segundo plano; una URL real sobrevive y funciona sin red.
 */
const publishToCache = async (bookId: string, version: string, blob: Blob): Promise<string | undefined> => {
  try {
    if (typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return undefined
    const path = `/covers/${encodeURIComponent(bookId)}?v=${encodeURIComponent(version)}`
    const cache = await caches.open(COVER_CACHE_NAME)
    await cache.put(path, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/jpeg' } }))
    return new URL(path, window.location.origin).href
  } catch {
    return undefined
  }
}

const artworkRequests = new Map<string, Promise<MediaImage[] | undefined>>()

const buildArtwork = async (book: CoverRef): Promise<MediaImage[] | undefined> => {
  const external = book.coverUrl && !isDriveHostedCoverUrl(book.coverUrl) ? book.coverUrl : undefined
  if (external) return [{ src: external, sizes: '512x512' }]
  const fileId = book.coverFileId ?? extractDriveFileIdFromUrl(book.coverUrl)
  if (!fileId) return undefined
  const original = await loadCoverBlob(book.id, fileId)
  if (!original) return undefined
  const scaled = await downscale(original)
  const blob = scaled?.blob ?? original
  const sizes = scaled ? `${scaled.width}x${scaled.height}` : '512x512'
  const src = (await publishToCache(book.id, fileId, blob)) ?? URL.createObjectURL(blob)
  return [{ src, sizes, type: blob.type || 'image/jpeg' }]
}

export const coverKey = (book: CoverRef): string => `${book.id}:${book.coverFileId ?? book.coverUrl ?? ''}`

/** Caratula lista para `MediaMetadata.artwork`, o undefined si aun no se puede obtener. */
export const resolveArtwork = (book: CoverRef): Promise<MediaImage[] | undefined> => {
  const key = coverKey(book)
  let request = artworkRequests.get(key)
  if (!request) {
    request = buildArtwork(book).then((artwork) => {
      if (!artwork) artworkRequests.delete(key)
      return artwork
    })
    artworkRequests.set(key, request)
  }
  return request
}
