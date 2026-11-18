import { useCallback } from 'react'
import type { ListeningProgress } from '../../domain/audiobook'
import { calculateBookProgressPercent, calculateListenedSeconds } from '../../lib/book-progress'
import { usePlayerStore } from '../player/player-store'
import { useLibraryStore } from './library-store'

export interface BookProgressSnapshot {
  percent: number
  listenedSeconds: number
  totalSeconds: number
  progress?: ListeningProgress
}

/**
 * Devuelve una funcion que calcula el progreso de cualquier libro, usando la
 * posicion en vivo del reproductor si es el libro activo.
 */
export const useBookProgressGetter = () => {
  const books = useLibraryStore((state) => state.books)
  const tracksByBook = useLibraryStore((state) => state.tracksByBook)
  const progressByBook = useLibraryStore((state) => state.progressByBook)
  const readTrackIdsByBook = useLibraryStore((state) => state.readTrackIdsByBook)
  const activeBookId = usePlayerStore((state) => state.activeBookId)
  const currentTrackId = usePlayerStore((state) => state.currentTrackId)
  const position = usePlayerStore((state) => state.position)
  const speed = usePlayerStore((state) => state.speed)

  return useCallback(
    (bookId: string): BookProgressSnapshot => {
      const book = books.find((item) => item.id === bookId)
      const tracks = tracksByBook[bookId] ?? []
      const saved = progressByBook[bookId]
      const progress: ListeningProgress | undefined =
        activeBookId === bookId && currentTrackId && (saved || position > 0)
          ? {
              ...saved,
              bookId,
              trackId: currentTrackId,
              positionSeconds: position,
              updatedAt: saved?.updatedAt ?? new Date().toISOString(),
              completed: false,
              speed,
            }
          : saved
      const readTrackIds = readTrackIdsByBook[bookId] ?? []
      const totalSeconds = book?.totalDurationSeconds ?? 0
      return {
        percent: book ? calculateBookProgressPercent({ tracks, totalDurationSeconds: totalSeconds, progress, readTrackIds }) : 0,
        listenedSeconds: calculateListenedSeconds({ tracks, progress, readTrackIds, totalDurationSeconds: totalSeconds }),
        totalSeconds,
        progress,
      }
    },
    [activeBookId, books, currentTrackId, position, progressByBook, readTrackIdsByBook, speed, tracksByBook],
  )
}
