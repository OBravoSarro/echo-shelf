import { useSyncExternalStore } from 'react'

const QUERY = '(hover: hover) and (pointer: fine)'

const getMediaQuery = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined

const subscribe = (onChange: () => void) => {
  const mq = getMediaQuery()
  mq?.addEventListener?.('change', onChange)
  return () => mq?.removeEventListener?.('change', onChange)
}

const getSnapshot = () => getMediaQuery()?.matches ?? false

/**
 * Detecta si el dispositivo tiene puntero preciso (ratón/trackpad).
 * Los efectos de tilt 3D solo tienen sentido ahí: en touch no hay "hover"
 * y el seguimiento del dedo compite con el scroll.
 */
export const useFinePointer = () => useSyncExternalStore(subscribe, getSnapshot, () => false)
