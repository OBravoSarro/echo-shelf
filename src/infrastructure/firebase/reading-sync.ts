import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore'
import type { Audiobook, ListeningProgress } from '../../domain/audiobook'
import { firestoreDb } from './client'

export interface CloudBookState {
  bookId: string
  progress?: ListeningProgress
  progressUpdatedAtMs?: number
  readTrackIds?: string[]
  readTrackIdsUpdatedAtMs?: number
}

export interface CloudBookMetadata {
  bookId: string
  patch?: Partial<Pick<Audiobook, 'title' | 'author' | 'narrator' | 'description' | 'coverUrl' | 'coverFileId' | 'publisher' | 'publishedYear' | 'genres' | 'isbn'>>
  updatedAtMs?: number
}

const userBookStateCollection = (userId: string) => collection(firestoreDb!, 'users', userId, 'bookStates')
const userBookStateDoc = (userId: string, bookId: string) => doc(firestoreDb!, 'users', userId, 'bookStates', bookId)
const userPreferencesDoc = (userId: string) => doc(firestoreDb!, 'users', userId, 'preferences', 'bookOrder')
const userBookMetadataCollection = (userId: string) => collection(firestoreDb!, 'users', userId, 'bookMetadata')
const userBookMetadataDoc = (userId: string, bookId: string) => doc(firestoreDb!, 'users', userId, 'bookMetadata', bookId)

export const canUseReadingSync = (): boolean => Boolean(firestoreDb)

export const subscribeCloudBookStates = (
  userId: string,
  onData: (states: CloudBookState[]) => void,
  onError: (error: FirestoreError) => void,
): Unsubscribe => {
  if (!firestoreDb) {
    return () => {}
  }
  return onSnapshot(
    userBookStateCollection(userId),
    (snapshot) => {
      const states = snapshot.docs.map((entry) => {
        const data = entry.data() as Partial<CloudBookState>
        return {
          bookId: entry.id,
          progress: data.progress,
          progressUpdatedAtMs: data.progressUpdatedAtMs,
          readTrackIds: Array.isArray(data.readTrackIds) ? data.readTrackIds.filter((item): item is string => typeof item === 'string') : [],
          readTrackIdsUpdatedAtMs: data.readTrackIdsUpdatedAtMs,
        } satisfies CloudBookState
      })
      onData(states)
    },
    onError,
  )
}

export const subscribeCloudBookMetadata = (
  userId: string,
  onData: (states: CloudBookMetadata[]) => void,
  onError: (error: FirestoreError) => void,
): Unsubscribe => {
  if (!firestoreDb) {
    return () => {}
  }
  return onSnapshot(
    userBookMetadataCollection(userId),
    (snapshot) => {
      const states = snapshot.docs.map((entry) => {
        const data = entry.data() as Partial<CloudBookMetadata>
        return {
          bookId: entry.id,
          patch: data.patch,
          updatedAtMs: data.updatedAtMs,
        } satisfies CloudBookMetadata
      })
      onData(states)
    },
    onError,
  )
}

export const pushCloudProgress = async (userId: string, progress: ListeningProgress): Promise<void> => {
  if (!firestoreDb) return
  const updatedAtMs = Date.parse(progress.updatedAt)
  await setDoc(
    userBookStateDoc(userId, progress.bookId),
    {
      progress,
      progressUpdatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )
}

export const pushCloudReadTracks = async (
  userId: string,
  bookId: string,
  trackIds: string[],
  readTrackIdsUpdatedAtMs: number,
): Promise<void> => {
  if (!firestoreDb) return
  await setDoc(
    userBookStateDoc(userId, bookId),
    {
      readTrackIds: Array.from(new Set(trackIds)),
      readTrackIdsUpdatedAtMs,
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )
}

export const pushCloudBookMetadata = async (
  userId: string,
  bookId: string,
  patch: Partial<Pick<Audiobook, 'title' | 'author' | 'narrator' | 'description' | 'coverUrl' | 'coverFileId' | 'publisher' | 'publishedYear' | 'genres' | 'isbn'>>,
  updatedAtMs: number,
): Promise<void> => {
  if (!firestoreDb) return
  await setDoc(
    userBookMetadataDoc(userId, bookId),
    {
      patch,
      updatedAtMs,
    },
    { merge: true },
  )
}

// ─── Book order ───────────────────────────────────────────────────────────────

export const pushBookOrder = async (userId: string, orderedIds: string[]): Promise<void> => {
  if (!firestoreDb) return
  await setDoc(
    userPreferencesDoc(userId),
    { order: orderedIds, updatedAtMs: Date.now() },
    { merge: true },
  )
}

export const fetchBookOrder = async (userId: string): Promise<string[] | null> => {
  if (!firestoreDb) return null
  const snap = await getDoc(userPreferencesDoc(userId))
  if (!snap.exists()) return null
  const data = snap.data() as { order?: unknown }
  if (!Array.isArray(data.order)) return null
  return data.order.filter((id): id is string => typeof id === 'string')
}
