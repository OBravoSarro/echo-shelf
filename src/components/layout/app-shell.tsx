import { motion, useReducedMotion } from 'framer-motion'
import { Download, LibraryBig, Settings } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-bg-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(123,99,255,0.22),transparent_34%),radial-gradient(circle_at_88%_12%,rgba(240,61,175,0.2),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1440px]">
        <aside className="hidden w-64 border-r border-white/10 bg-white/5 p-6 backdrop-blur-xl lg:block">
          <Link to="/" className="flex items-center gap-3 text-lg font-semibold tracking-wide">
            <span className="grid size-10 place-items-center rounded-2xl border border-white/15 bg-black/25 shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
              <img src="/favicon.svg" alt="EchoShelf" className="size-9 rounded-xl" />
            </span>
            EchoShelf
          </Link>
          <nav className="mt-12 space-y-3">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-4 py-3 transition ${isActive ? 'bg-white/14 text-white' : 'text-slate-300 hover:bg-white/8'}`
                }
              >
                <Icon className="size-5" /> {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="w-full flex-1 px-4 pb-28 pt-[calc(env(safe-area-inset-top)+0.8rem)] sm:px-6 lg:px-10 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-bg-900/85 px-4 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center rounded-xl py-2 text-xs ${isActive ? 'text-white' : 'text-slate-400'}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && !reduceMotion && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute inset-0 rounded-xl bg-white/12"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  {isActive && reduceMotion && (
                    <div className="absolute inset-0 rounded-xl bg-white/12" />
                  )}
                  <Icon className="relative mb-1 size-5" />
                  <span className="relative">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
