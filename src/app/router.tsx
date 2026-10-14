import { createBrowserRouter } from 'react-router-dom'
import { lazy, Suspense, type ReactNode } from 'react'
import { AppShell } from '../components/layout/app-shell'

const LibraryPage = lazy(async () => import('../features/library/library-page').then((m) => ({ default: m.LibraryPage })))
const PlayerPage = lazy(async () => import('../features/player/player-page').then((m) => ({ default: m.PlayerPage })))
const DownloadsPage = lazy(async () => import('../features/downloads/downloads-page').then((m) => ({ default: m.DownloadsPage })))
const SettingsPage = lazy(async () => import('../features/settings/settings-page').then((m) => ({ default: m.SettingsPage })))
const OfflinePage = lazy(async () => import('../features/settings/offline-page').then((m) => ({ default: m.OfflinePage })))

const withSuspense = (element: ReactNode) => <Suspense fallback={<div className="p-4 text-sm text-slate-300">Cargando...</div>}>{element}</Suspense>

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: withSuspense(<LibraryPage />) },
      { path: 'player/:bookId', element: withSuspense(<PlayerPage />) },
      { path: 'downloads', element: withSuspense(<DownloadsPage />) },
      { path: 'settings', element: withSuspense(<SettingsPage />) },
      { path: 'offline', element: withSuspense(<OfflinePage />) },
    ],
  },
])
