import { motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion'
import { Download, LibraryBig, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { AmbientBackground } from '../motion/ambient-background'
import { useAuthStore } from '../../features/auth/auth-store'
import { useDownloadStore } from '../../features/downloads/download-store'
import { useLibraryStore } from '../../features/library/library-store'
import { usePlayerStore } from '../../features/player/player-store'

const navItems = [
  { to: '/', label: 'Biblioteca', icon: LibraryBig },
  { to: '/downloads', label: 'Descargas', icon: Download },
  { to: '/settings', label: 'Ajustes', icon: Settings },
]

export const AppShell = () => {
  const reduceMotion = useReducedMotion()
  const bootstrapAuth = useAuthStore((state) => state.bootstrap)
  const bootstrapLibrary = useLibraryStore((state) => state.bootstrap)
  const bootstrapDownloads = useDownloadStore((state) => state.bootstrap)
  const source = useLibraryStore((state) => state.source)
  const driveRootId = useLibraryStore((state) => state.driveRootId)
  const startCloudSync = useLibraryStore((state) => state.startCloudSync)
  const stopCloudSync = useLibraryStore((state) => state.stopCloudSync)
  const libraryLoading = useLibraryStore((state) => state.loading)
  const syncDrive = useLibraryStore((state) => state.syncDrive)
  const initPlayer = usePlayerStore((state) => state.init)
  const authConnected = useAuthStore((state) => state.connected)
  const authUserId = useAuthStore((state) => state.userId)
  const accessToken = useAuthStore((state) => state.accessToken)
  const authExpiresAt = useAuthStore((state) => state.expiresAt)
  const refreshAuth = useAuthStore((state) => state.refresh)
  const autoSyncedKey = useRef<string | undefined>()
  const location = useLocation()

  useEffect(() => {
    void bootstrapAuth()
    void bootstrapLibrary()
    void bootstrapDownloads()
    initPlayer()
  }, [bootstrapAuth, bootstrapDownloads, bootstrapLibrary, initPlayer])

  useEffect(() => {
    if (!authConnected || !accessToken || !driveRootId || source !== 'drive' || libraryLoading) {
      return
    }
    const syncKey = `${driveRootId}:${accessToken}:${authExpiresAt ?? 0}`
    if (autoSyncedKey.current === syncKey) {
      return
    }
    autoSyncedKey.current = syncKey
    void syncDrive(accessToken, driveRootId)
  }, [accessToken, authConnected, authExpiresAt, driveRootId, libraryLoading, source, syncDrive])

  useEffect(() => {
    const maybeRefresh = () => {
      const { connected, expiresAt } = useAuthStore.getState()
      if (!connected || !expiresAt) return
      if (expiresAt - Date.now() <= 5 * 60 * 1000) {
        void refreshAuth()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        maybeRefresh()
      }
    }

    window.addEventListener('online', maybeRefresh)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('online', maybeRefresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshAuth])

  useEffect(() => {
    if (!authConnected || !authUserId) {
      stopCloudSync()
      return
    }
    void startCloudSync(authUserId)
    return () => {
      stopCloudSync()
    }
  }, [authConnected, authUserId, startCloudSync, stopCloudSync])

  useEffect(() => {
    // 'instant' para no heredar el `scroll-behavior: smooth` global al cambiar de ruta
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [location.pathname])

  // Tab bar que se esconde al hacer scroll hacia abajo y reaparece al subir (patrón iOS/Safari)
  const { scrollY } = useScroll()
  const [tabBarHidden, setTabBarHidden] = useState(false)
  useMotionValueEvent(scrollY, 'change', (current) => {
    const previous = scrollY.getPrevious() ?? 0
    const delta = current - previous
    if (current < 80) {
      setTabBarHidden(false)
    } else if (delta > 6) {
      setTabBarHidden(true)
    } else if (delta < -6) {
      setTabBarHidden(false)
    }
  })

  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg-950 text-label-primary">
      <AmbientBackground />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1440px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-5 lg:flex">
          <div className="glass flex h-full flex-col rounded-[1.75rem] p-4">
            <Link to="/" className="group flex items-center gap-3 px-2 pt-1 text-[17px] font-semibold tracking-tight">
              <motion.span
                whileHover={reduceMotion ? undefined : { rotate: -8, scale: 1.08 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                className="grid size-10 place-items-center rounded-2xl border border-white/10 bg-black/40 shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
              >
                <img src="/favicon.svg" alt="EchoShelf" className="size-9 rounded-xl" />
              </motion.span>
              EchoShelf
            </Link>
            <nav className="mt-10 space-y-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `relative z-0 flex items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium transition-colors duration-300 ${isActive ? 'text-white' : 'text-white/55 hover:text-white'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId={reduceMotion ? undefined : 'sidebar-indicator'}
                          className="absolute inset-0 -z-10 rounded-2xl bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                        />
                      )}
                      <Icon className="size-[18px]" strokeWidth={isActive ? 2.4 : 2} /> {label}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <p className="mt-auto px-2 text-[11px] text-white/30">Hecho para escuchar.</p>
          </div>
        </aside>
        <main className="w-full min-w-0 flex-1 px-5 pb-36 pt-[calc(env(safe-area-inset-top)+0.8rem)] sm:px-8 lg:px-12 lg:pb-12">
          {/* Transición de entrada por ruta. Solo opacity/transform: al terminar framer deja
              `transform: none`, así no queda un containing block que rompa `position: fixed`. */}
          <motion.div
            key={location.pathname}
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <motion.nav
        initial={false}
        animate={tabBarHidden && !reduceMotion ? { y: 120, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 px-5 lg:hidden"
      >
        <div className="glass-strong mx-auto grid max-w-sm grid-cols-3 gap-1 rounded-full p-1.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `relative z-0 flex flex-col items-center justify-center rounded-full py-2 text-[10px] font-medium transition-colors duration-300 ${isActive ? 'text-white' : 'text-white/50'}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId={reduceMotion ? undefined : 'nav-indicator'}
                      className="absolute inset-0 -z-10 rounded-full bg-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    />
                  )}
                  <motion.span
                    animate={isActive && !reduceMotion ? { y: -1, scale: 1.08 } : { y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  >
                    <Icon className="mb-0.5 size-5" strokeWidth={isActive ? 2.4 : 2} />
                  </motion.span>
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </motion.nav>
    </div>
  )
}
