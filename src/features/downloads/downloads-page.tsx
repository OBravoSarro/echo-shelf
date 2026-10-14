import { Download, HardDriveDownload, LoaderCircle, Trash2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useMemo } from 'react'
import { useDownloadStore } from './download-store'
import { useLibraryStore } from '../library/library-store'

const pageVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
}

const rowVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
}

export const DownloadsPage = () => {
  const reduceMotion = useReducedMotion()
  const { jobs, cancelJob, removeTrackDownload, removeBookDownloads } = useDownloadStore()
  const books = useLibraryStore((state) => state.books)
  const tracksByBook = useLibraryStore((state) => state.tracksByBook)
  const grouped = useMemo(() => {
    return jobs.reduce<Record<string, typeof jobs>>((acc, job) => {
      if (!acc[job.bookId]) acc[job.bookId] = []
      acc[job.bookId].push(job)
      return acc
    }, {})
  }, [jobs])

  return (
    <motion.section
      className="space-y-5"
      variants={reduceMotion ? undefined : pageVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.header variants={reduceMotion ? undefined : rowVariants}>
        <h1 className="text-2xl font-semibold">Descargas</h1>
        <p className="text-sm text-slate-400">Cola persistente con recuperacion tras reinicio de la app.</p>
      </motion.header>

      {Object.keys(grouped).length === 0 && (
        <motion.div
          variants={reduceMotion ? undefined : rowVariants}
          className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-8 text-center text-sm text-slate-300"
        >
          Aun no hay descargas activas.
        </motion.div>
      )}

      {Object.entries(grouped).map(([bookId, bookJobs]) => {
        const book = books.find((item) => item.id === bookId)
        const tracks = tracksByBook[bookId] ?? []
        const done = bookJobs.filter((job) => job.status === 'done').length
        const ratio = done / Math.max(1, bookJobs.length)
        return (
          <motion.article key={bookId} variants={reduceMotion ? undefined : rowVariants} className="rounded-2xl border border-white/10 bg-white/6 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">{book?.title ?? bookId}</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-300">{done}/{bookJobs.length}</span>
                {done > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      void removeBookDownloads(bookId)
                    }}
                    className="rounded-lg border border-white/20 px-2 py-1 text-[11px]"
                  >
                    Borrar descargas
                  </button>
                )}
              </div>
            </div>
            <div className="mb-4 h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-accent-cyan to-accent-magenta" style={{ width: `${ratio * 100}%` }} />
            </div>
            <ul className="space-y-2">
              {bookJobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm">
                  <span className="truncate">{tracks.find((track) => track.id === job.trackId)?.title ?? job.trackId}</span>
                  <div className="ml-3 flex items-center gap-2">
                    {(job.status === 'queued' || job.status === 'running') && (
                      <>
                        <ProgressIcon progress={job.status === 'queued' ? 0 : Math.max(0.05, job.progress)} active />
                        <button
                          type="button"
                          onClick={() => cancelJob(job.id)}
                          className="rounded-lg border border-white/20 p-1"
                          aria-label="Cancelar descarga"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                    {job.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-300">
                        <Download className="size-4" /> Error
                      </span>
                    )}
                    {job.status === 'done' && (
                      <>
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <HardDriveDownload className="size-4" />
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void removeTrackDownload(job.trackId)
                          }}
                          className="rounded-lg border border-white/20 p-1"
                          aria-label="Eliminar descarga local"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </motion.article>
        )
      })}

      <motion.div
        variants={reduceMotion ? undefined : rowVariants}
        className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100"
      >
        <p className="mb-1 inline-flex items-center gap-2 font-medium"><HardDriveDownload className="size-4" /> Estado offline</p>
        <p>Los audiolibros marcados como completados quedan disponibles sin conexion si se guardaron correctamente en IndexedDB u OPFS.</p>
      </motion.div>
    </motion.section>
  )
}

const ProgressIcon = ({ progress, active = false }: { progress: number; active?: boolean }) => {
  const value = Math.max(0, Math.min(1, progress))
  const angle = Math.round(value * 360)
  return (
    <span
      className="relative grid size-5 place-items-center rounded-full"
      style={{
        background: `conic-gradient(rgba(60,184,255,1) ${angle}deg, rgba(255,255,255,0.2) ${angle}deg 360deg)`,
      }}
      aria-hidden="true"
    >
      <span className="grid size-3.5 place-items-center rounded-full bg-bg-900">
        {active ? <LoaderCircle className="size-3 animate-spin text-cyan-300" /> : <Download className="size-3 text-cyan-300" />}
      </span>
    </span>
  )
}
