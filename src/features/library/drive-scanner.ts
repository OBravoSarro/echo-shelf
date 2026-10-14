import type { Audiobook, AudioTrack } from '../../domain/audiobook'
import { naturalCompare } from '../../lib/format'
import type { DriveFile } from '../../infrastructure/google-drive/types'

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.m4b', '.aac', '.ogg', '.opus']
const FALLBACK_TRACK_DURATION_SECONDS = 22 * 60

const getExt = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

export const isAudioFile = (file: DriveFile): boolean => {
  if (file.mimeType.startsWith('audio/')) return true
  return AUDIO_EXTENSIONS.includes(getExt(file.name))
}

export const toAudioFormat = (name: string): AudioTrack['format'] => {
  const ext = getExt(name)
  switch (ext) {
    case '.mp3':
      return 'mp3'
    case '.m4a':
      return 'm4a'
    case '.m4b':
      return 'm4b'
    case '.aac':
      return 'aac'
    case '.ogg':
      return 'ogg'
    case '.opus':
      return 'opus'
    default:
      return 'unknown'
  }
}

const resolveDriveDurationSeconds = (file: DriveFile): number | undefined => {
  const fromMetadataMs = Number(file.videoMediaMetadata?.durationMillis ?? 0)
  if (Number.isFinite(fromMetadataMs) && fromMetadataMs > 0) {
    return Math.round(fromMetadataMs / 1000)
  }
  return undefined
}

interface ScanResult {
  books: Audiobook[]
  tracks: AudioTrack[]
}

const guessCover = (folderFiles: DriveFile[]): DriveFile | undefined => {
  return (
    folderFiles.find((f) => /cover|folder|front|portada|poster|artwork/i.test(f.name) && f.mimeType.startsWith('image/')) ??
    folderFiles.find((f) => f.mimeType.startsWith('image/'))
  )
}

const extractIsbn = (...values: string[]): string | undefined => {
  const combined = values.join(' ')
  const matches = combined.match(/\b(?:97[89][0-9\-\s]{10,16}|[0-9Xx\-\s]{10,13})\b/g)
  if (!matches) return undefined
  for (const match of matches) {
    const normalized = match.replace(/[^0-9Xx]/g, '').toUpperCase()
    if (/^(97[89][0-9]{10}|[0-9]{9}[0-9X])$/.test(normalized)) {
      return normalized
    }
  }
  return undefined
}

const inferAuthorTitleNarrator = (
  folderName: string,
  fallbackTitle: string,
  firstTrackName: string,
): { title: string; author: string; narrator: string } => {
  const normalized = folderName.replace(/[_]+/g, ' ').trim()
  const byDash = normalized.match(/^([^-]{2,})\s+-\s+(.+)$/)
  let author = 'Autor sin clasificar'
  let title = normalized || fallbackTitle
  if (byDash) {
    author = byDash[1].trim()
    title = byDash[2].trim()
  }

  const firstTrackNormalized = firstTrackName.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+\s*[-_.]?\s*/, '').trim()
  const trackDash = firstTrackNormalized.match(/^([^-]{2,})\s+-\s+([^-]{2,})(?:\s+-\s+.+)?$/)
  if (author === 'Autor sin clasificar' && trackDash) {
    author = trackDash[1].trim()
    if (!byDash) {
      title = trackDash[2].trim()
    }
  }

  const narratorMatch = title.match(/(?:\(|\[)?(?:narrad[oa]\s+por|read\s+by|voice\s+by)\s*[:-]?\s*([^\])]+)(?:\)|\])?/i)
  let narrator = 'Narrador desconocido'
  if (narratorMatch?.[1]) {
    narrator = narratorMatch[1].trim()
    title = title.replace(narratorMatch[0], '').replace(/\s{2,}/g, ' ').trim()
  }

  const narratorTrackMatch = firstTrackNormalized.match(/(?:narrad[oa]\s+por|read\s+by|voice\s+by)\s*[:-]?\s*(.+)$/i)
  if (narrator === 'Narrador desconocido' && narratorTrackMatch?.[1]) {
    narrator = narratorTrackMatch[1].trim()
  }

  return {
    title: title || fallbackTitle,
    author,
    narrator,
  }
}

export const scanDriveLibrary = (files: DriveFile[]): ScanResult => {
  const filesByFolder = new Map<string, DriveFile[]>()
  const folderNames = new Map<string, string>()
  for (const file of files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      folderNames.set(file.id, file.name)
    }
    const parent = file.parents?.[0]
    if (!parent) continue
    const existing = filesByFolder.get(parent) ?? []
    existing.push(file)
    filesByFolder.set(parent, existing)
  }

  const books: Audiobook[] = []
  const tracks: AudioTrack[] = []

  for (const [folderId, folderFiles] of filesByFolder.entries()) {
    const audioFiles = folderFiles.filter(isAudioFile)
    if (audioFiles.length === 0) continue
    const sorted = [...audioFiles].sort((a, b) => naturalCompare(a.name, b.name))
    const firstTrackName = sorted[0]?.name ?? 'Untitled'
    const rawTitle = firstTrackName.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+\s*[-_.]?\s*/, '').trim()
    const folderName = folderNames.get(folderId) ?? rawTitle
    const inferred = inferAuthorTitleNarrator(folderName, rawTitle, firstTrackName)
    const isbn = extractIsbn(folderName, firstTrackName)
    const cover = guessCover(folderFiles)
    const bookId = `drive-${folderId}`
    const now = new Date().toISOString()

    const bookTracks = sorted.map((file, index) => {
      const trackId = `track-${file.id}`
      const track: AudioTrack = {
        id: trackId,
        bookId,
        title: file.name.replace(/\.[a-z0-9]+$/i, ''),
        index,
        durationSeconds: resolveDriveDurationSeconds(file),
        format: toAudioFormat(file.name),
        mimeType: file.mimeType,
        driveFileId: file.id,
        fileSize: file.size ? Number(file.size) : undefined,
      }
      return track
    })

    const knownDurations = bookTracks
      .map((track) => (Number.isFinite(track.durationSeconds) ? Number(track.durationSeconds) : 0))
      .filter((value) => value > 0)
    const knownAverageDuration = knownDurations.length > 0
      ? knownDurations.reduce((sum, value) => sum + value, 0) / knownDurations.length
      : FALLBACK_TRACK_DURATION_SECONDS
    const totalDurationSeconds = Math.round(
      bookTracks.reduce((acc, track) => {
        const value = Number(track.durationSeconds ?? 0)
        if (Number.isFinite(value) && value > 0) return acc + value
        return acc + knownAverageDuration
      }, 0),
    )

    books.push({
      id: bookId,
      source: 'drive',
      title: inferred.title,
      author: inferred.author,
      narrator: inferred.narrator,
      isbn,
      coverUrl: cover?.thumbnailLink ?? (cover ? `https://drive.google.com/thumbnail?id=${cover.id}&sz=w1024` : undefined),
      coverFileId: cover?.id,
      totalDurationSeconds,
      trackCount: bookTracks.length,
      folderId,
      updatedAt: now,
    })
    tracks.push(...bookTracks)
  }

  return {
    books: books.sort((a, b) => naturalCompare(a.title, b.title)),
    tracks,
  }
}
