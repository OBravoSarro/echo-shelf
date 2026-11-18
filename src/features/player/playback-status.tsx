import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, CloudDownload, HardDrive, LoaderCircle, RefreshCw, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMegabytes } from '../../lib/format'
import { useDownloadStore } from '../downloads/download-store'
import { usePlayerStore } from './player-store'
import { describeLoadStatus, percentOf } from './playback-status-label'

/**
 * Banda de estado bajo los controles del reproductor: explica que esta
 * haciendo la app (leer del dispositivo, bajar de Drive, etc.) y de donde
 * sale el audio, para que nunca parezca que "no hace nada".
 */
export const PlaybackStatus = ({ fileSize }: { fileSize?: number }) => {
  const reduceMotion = useReducedMotion()
  const loadStatus = usePlayerStore((state) => state.loadStatus)
  const buffering = usePlayerStore((state) => state.buffering)
  const source = usePlayerStore((state) => state.source)
  const currentTrackId = usePlayerStore((state) => state.currentTrackId)
  const retry = usePlayerStore((state) => state.retry)
  const cancelLoad = usePlayerStore((state) => state.cancelLoad)
  const downloaded = useDownloadStore((state) => (currentTrackId ? state.downloadedTrackIds.includes(currentTrackId) : false))

  const percent = percentOf(loadStatus)
  let content: { key: string; tone: 'info' | 'busy' | 'error'; icon: ReactNode; text: string; action?: ReactNode } | undefined

  if (loadStatus.phase === 'downloading') {
    const detail =
      loadStatus.total && loadStatus.loaded !== undefined
        ? ` · ${formatMegabytes(loadStatus.loaded)} de ${formatMegabytes(loadStatus.total)}`
        : loadStatus.loaded
          ? ` · ${formatMegabytes(loadStatus.loaded)}`
          : ''
    content = {
      key: 'downloading',
      tone: 'busy',
      icon: <CloudDownload className="size-4 shrink-0" />,
      text: `Descargando capitulo de Google Drive${percent !== undefined ? ` · ${percent}%` : ''}${detail}`,
      action: (
        <button type="button" onClick={cancelLoad} className="rounded-full p-1 text-white/50 hover:text-white" aria-label="Cancelar descarga">
          <X className="size-4" />
        </button>
      ),
    }
  } else if (loadStatus.phase === 'local' || loadStatus.phase === 'preparing' || (buffering && loadStatus.phase === 'idle')) {
    content = {
      key: 'busy',
      tone: 'busy',
      icon: <LoaderCircle className="size-4 shrink-0 animate-spin" />,
      text: describeLoadStatus(loadStatus, buffering) ?? 'Cargando…',
    }
  } else if (loadStatus.phase === 'error') {
    content = {
      key: 'error',
      tone: 'error',
      icon: <AlertCircle className="size-4 shrink-0" />,
      text: loadStatus.message ?? 'No se pudo cargar el capitulo',
      action: (
        <button type="button" onClick={() => void retry()} className="btn-pill glass text-[12px] text-white/90">
          <RefreshCw className="size-3.5" /> Reintentar
        </button>
      ),
    }
  } else if (loadStatus.message) {
    content = { key: 'message', tone: 'info', icon: <AlertCircle className="size-4 shrink-0" />, text: loadStatus.message }
  } else if (source === 'local' || (!source && downloaded)) {
    content = { key: 'local', tone: 'info', icon: <HardDrive className="size-4 shrink-0" />, text: 'Capitulo descargado · sin consumo de datos' }
  } else if (source === 'drive') {
    content = { key: 'drive', tone: 'info', icon: <CloudDownload className="size-4 shrink-0" />, text: 'Descargado de Drive y guardado para escuchar offline' }
  } else if (currentTrackId) {
    content = {
      key: 'remote',
      tone: 'info',
      icon: <CloudDownload className="size-4 shrink-0" />,
      text: `No descargado · se bajara de Drive al reproducir${fileSize ? ` (${formatMegabytes(fileSize)})` : ''}`,
    }
  }

  const toneClass =
    content?.tone === 'error' ? 'text-rose-200' : content?.tone === 'busy' ? 'text-accent-cyan' : 'text-white/45'

  return (
    <div className="mt-4 min-h-[2.25rem]" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {content && (
          <motion.div
            key={content.key}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className={`flex items-center justify-center gap-2 text-[13px] lg:justify-start ${toneClass}`}
          >
            {content.icon}
            <span className="min-w-0 tabular-nums">{content.text}</span>
            {content.action}
          </motion.div>
        )}
      </AnimatePresence>
      {loadStatus.phase === 'downloading' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full bg-accent-cyan transition-[width] duration-200 ${percent === undefined ? 'w-1/3 animate-pulse' : ''}`}
            style={percent === undefined ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
