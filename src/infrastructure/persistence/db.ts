import Dexie, { type EntityTable } from 'dexie'
import type { Audiobook, AudioTrack, DownloadState, ListeningProgress } from '../../domain/audiobook'

export interface AuthState {
  id: 'google'
  userId?: string
  accessToken?: string
  expiresAt?: number
  connectedEmail?: string
  displayName?: string
  photoUrl?: string
  updatedAt: string
}

export interface FileEntry {
  id: string
  blob?: Blob
  opfsPath?: string
  mimeType: string
  size: number
  updatedAt: string
}

export interface SettingValue {
  key: string
  value: string
  updatedAt: string
}

class EchoShelfDb extends Dexie {
  books!: EntityTable<Audiobook, 'id'>
  tracks!: EntityTable<AudioTrack, 'id'>
  progress!: EntityTable<ListeningProgress, 'bookId'>
  downloads!: EntityTable<DownloadState, 'id'>
  auth!: EntityTable<AuthState, 'id'>
  files!: EntityTable<FileEntry, 'id'>
  settings!: EntityTable<SettingValue, 'key'>

  constructor() {
    super('echo-shelf-db')
    this.version(1).stores({
      books: '&id, source, updatedAt, title',
      tracks: '&id, bookId, index, format',
      progress: '&bookId, trackId, updatedAt',
      downloads: '&id, bookId, trackId, status, updatedAt',
      auth: '&id, updatedAt',
      files: '&id, updatedAt',
      settings: '&key, updatedAt',
    })
  }
}

export const db = new EchoShelfDb()
