import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { router } from './app/router'
import { usePlayerStore } from './features/player/player-store'
import './styles/index.css'

/**
 * Una version nueva recarga la pagina, y eso corta el audio y borra la sesion
 * de la pantalla de bloqueo / CarPlay. Si en esta sesion ya se ha escuchado
 * algo, la recarga espera a que la app este en pausa y a la vista.
 */
const reloadWhenIdle = (): void => {
  const tryReload = (): boolean => {
    const { playing, pending, canPersistProgress } = usePlayerStore.getState()
    const idle = !playing && !pending
    if (!idle || (canPersistProgress && document.visibilityState !== 'visible')) return false
    window.location.reload()
    return true
  }
  if (tryReload()) return
  usePlayerStore.subscribe(() => void tryReload())
  document.addEventListener('visibilitychange', () => void tryReload())
}

registerSW({
  onNeedReload: reloadWhenIdle,
  onRegisteredSW(swUrl, registration) {
    if (swUrl && registration) {
      void registration.update()
    }
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
