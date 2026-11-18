import { usePlayerStore, type LoadStatus } from './player-store'

export const percentOf = (status: LoadStatus): number | undefined => {
  if (!status.total || status.total <= 0 || status.loaded === undefined) return undefined
  return Math.min(100, Math.round((status.loaded / status.total) * 100))
}

/** Texto corto del estado de carga, para sitios estrechos (mini player). */
export const describeLoadStatus = (status: LoadStatus, buffering: boolean): string | undefined => {
  switch (status.phase) {
    case 'local':
      return 'Abriendo desde el dispositivo…'
    case 'downloading': {
      const percent = percentOf(status)
      return percent === undefined ? 'Descargando de Drive…' : `Descargando de Drive · ${percent}%`
    }
    case 'preparing':
      return 'Preparando audio…'
    case 'error':
      return status.message ?? 'No se pudo cargar el capitulo'
    default:
      if (buffering) return 'Cargando audio…'
      return status.message
  }
}

export const usePlaybackStatusLabel = (): string | undefined => {
  const loadStatus = usePlayerStore((state) => state.loadStatus)
  const buffering = usePlayerStore((state) => state.buffering)
  return describeLoadStatus(loadStatus, buffering)
}
