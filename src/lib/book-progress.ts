import type { AudioTrack, ListeningProgress } from '../domain/audiobook'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const normalizeDuration = (value?: number): number => {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 0
  return Math.max(0, value ?? 0)
}

const calculateFallbackTrackDuration = (totalDurationSeconds: number, trackCount: number): number => {
  if (trackCount <= 0) return 0
  return normalizeDuration(totalDurationSeconds) / trackCount
}

export const resolveTrackDurationSeconds = ({
  track,
  totalDurationSeconds,
  trackCount,
}: {
  track: AudioTrack
  totalDurationSeconds?: number
  trackCount?: number
}): number => {
  const exact = normalizeDuration(track.durationSeconds)
  if (exact > 0) return exact

  const fallbackCount = trackCount ?? 0
  const fallbackTotal = totalDurationSeconds ?? 0
  return calculateFallbackTrackDuration(fallbackTotal, fallbackCount)
}

export const calculateListenedSeconds = ({
  tracks,
  progress,
  readTrackIds = [],
  totalDurationSeconds,
}: {
  tracks: AudioTrack[]
  progress?: ListeningProgress
  readTrackIds?: string[]
  totalDurationSeconds?: number
}): number => {
  if (!progress && readTrackIds.length === 0) {
    return 0
  }

  const orderedTracks = [...tracks].sort((a, b) => a.index - b.index)
  if (orderedTracks.length === 0) return 0

  const fallbackDuration = calculateFallbackTrackDuration(totalDurationSeconds ?? 0, orderedTracks.length)
  const readSet = new Set(readTrackIds)
  const listenedByTrack = new Map<string, number>()

  for (const track of orderedTracks) {
    const duration = resolveTrackDurationSeconds({
      track,
      totalDurationSeconds,
      trackCount: orderedTracks.length,
    })
    listenedByTrack.set(track.id, readSet.has(track.id) ? duration : 0)
  }

  if (progress) {
    const currentTrackIndex = orderedTracks.findIndex((track) => track.id === progress.trackId)
    if (currentTrackIndex >= 0) {
      for (let index = 0; index < currentTrackIndex; index += 1) {
        const track = orderedTracks[index]
        const duration = resolveTrackDurationSeconds({
          track,
          totalDurationSeconds,
          trackCount: orderedTracks.length,
        })
        listenedByTrack.set(track.id, Math.max(listenedByTrack.get(track.id) ?? 0, duration))
      }

      const currentTrack = orderedTracks[currentTrackIndex]
      const currentDuration = resolveTrackDurationSeconds({
        track: currentTrack,
        totalDurationSeconds,
        trackCount: orderedTracks.length,
      })
      const currentProgress = clamp(Math.max(0, progress.positionSeconds), 0, currentDuration || fallbackDuration || Number.MAX_SAFE_INTEGER)
      listenedByTrack.set(currentTrack.id, Math.max(listenedByTrack.get(currentTrack.id) ?? 0, currentProgress))
    }
  }

  const total = Array.from(listenedByTrack.values()).reduce((seconds, value) => seconds + Math.max(0, value), 0)
  return Math.max(0, total)
}

export const calculateBookProgressPercent = ({
  tracks,
  totalDurationSeconds,
  progress,
  readTrackIds = [],
}: {
  tracks: AudioTrack[]
  totalDurationSeconds: number
  progress?: ListeningProgress
  readTrackIds?: string[]
}): number => {
  if (totalDurationSeconds <= 0 || (readTrackIds.length === 0 && !progress)) {
    return 0
  }

  const listenedSeconds = calculateListenedSeconds({
    tracks,
    progress,
    readTrackIds,
    totalDurationSeconds,
  })

  return clamp((listenedSeconds / totalDurationSeconds) * 100, 0, 100)
}

export const calculateTrackProgressPercent = ({
  track,
  tracks,
  progress,
  readTrackIds = [],
  totalDurationSeconds,
}: {
  track: AudioTrack
  tracks: AudioTrack[]
  progress?: ListeningProgress
  readTrackIds?: string[]
  totalDurationSeconds?: number
}): number => {
  if (readTrackIds.includes(track.id)) return 100

  if (!progress || progress.trackId !== track.id) return 0

  const trackDuration = resolveTrackDurationSeconds({
    track,
    totalDurationSeconds,
    trackCount: tracks.length,
  })
  if (trackDuration <= 0) return 0
  return clamp((Math.max(0, progress.positionSeconds) / trackDuration) * 100, 0, 100)
}
