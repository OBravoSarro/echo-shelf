export type LibrarySource = 'drive'

export type AudioFormat = 'mp3' | 'm4a' | 'm4b' | 'aac' | 'ogg' | 'opus' | 'unknown'

export interface AudioTrack {
  id: string
  bookId: string
  title: string
  index: number
  durationSeconds?: number
  mimeType?: string
  format: AudioFormat
  driveFileId?: string
  localPath?: string
  fileSize?: number
}

export interface Audiobook {
  id: string
  source: LibrarySource
  title: string
  author: string
  narrator: string
  description?: string
  coverUrl?: string
  coverFileId?: string
  publisher?: string
  publishedYear?: number
  genres?: string[]
  isbn?: string
  coverGradient?: string
  totalDurationSeconds: number
  trackCount: number
  folderId?: string
  folderPath?: string
  updatedAt: string
}

export interface ListeningProgress {
  bookId: string
  trackId: string
  positionSeconds: number
  updatedAt: string
  completed: boolean
  speed: number
}

export interface DownloadState {
  id: string
  bookId: string
  trackId: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  bytesDownloaded: number
  totalBytes?: number
  error?: string
  updatedAt: string
}
