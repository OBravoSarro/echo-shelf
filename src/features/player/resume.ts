import type { AudioTrack, ListeningProgress } from '../../domain/audiobook'

/**
 * Capitulo por el que seguir. Si el guardado dice que el capitulo se termino,
 * se continua en el siguiente (antes se volvia a empezar el mismo desde 0).
 */
export const resolveResumeIndex = (tracks: AudioTrack[], progress?: ListeningProgress, trackId?: string): number => {
  const targetId = trackId ?? progress?.trackId
  const found = targetId ? tracks.findIndex((item) => item.id === targetId) : 0
  if (found < 0) return 0
  if (!trackId && progress?.completed && found < tracks.length - 1) return found + 1
  return found
}
