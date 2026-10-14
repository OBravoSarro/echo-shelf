const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const naturalCompare = (a: string, b: string): number => collator.compare(a, b)

export const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export const formatDurationCompact = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  if (hours <= 0) return `${mins} min`
  return `${hours} h ${mins} min`
}

export const formatDurationMini = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m'
  const hours = Math.floor(seconds / 3600)
  if (hours > 0) return `${hours}h`
  const mins = Math.max(1, Math.floor((seconds % 3600) / 60))
  return `${mins}m`
}

export const formatHoursRatio = (currentSeconds: number, totalSeconds: number): string => {
  const currentHours = Math.max(0, currentSeconds) / 3600
  const totalHours = Math.max(0, totalSeconds) / 3600
  const current = Number(currentHours.toFixed(1)).toString()
  const total = Number(totalHours.toFixed(1)).toString()
  return `${current}h/${total}h`
}
