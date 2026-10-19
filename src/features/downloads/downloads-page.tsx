import { Download, HardDriveDownload, LoaderCircle, Trash2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useMemo } from 'react'
import { Reveal } from '../../components/motion/reveal'
import { LargeTitle } from '../../components/ui/large-title'
import { useDownloadStore } from './download-store'
import { useLibraryStore } from '../library/library-store'

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
    <section className="space-y-10 pb-4">
      <LargeTitle eyebrow="Offline" title="Descargas" subtitle="Cola persistente con recuperacion tras reinicio de la app." />

      {Object.keys(grouped).length === 0 && (
        <Reveal>
          <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] px-6 py-14 text-center">
            <motion.span
              animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="grid size-16 place-items-center rounded-[1.25rem] bg-gradient-to-br from-accent-cyan to-accent-violet shadow-[0_20px_40px_-12px_rgba(60,184,255,0.55)]"
            >
              <Download className="size-7" />
            </motion.span>
            <p className="text-[15px] text-white/55">Aun no hay descargas activas.</p>
          </div>
        </Reveal>
      )}

      {Object.entries(grouped).map(([bookId, bookJobs], groupIndex) => {
        const book = books.find((item) => item.id === bookId)
        const tracks = tracksByBook[bookId] ?? []
        const done = bookJobs.filter((job) => job.status === 'done').length
        const ratio = done / Math.max(1, bookJobs.length)
        return (
          <Reveal key={bookId} delay={Math.min(groupIndex, 3) * 0.05}>
            <article className="space-y-3">
              <div className="flex items-end justify-between gap-3 px-1">
                <div className="min-w-0">
                  <p className="text-eyebrow mb-1 tabular-nums">{done}/{bookJobs.length} completadas</p>
                  <h2 className="text-display truncate text-xl">{book?.title ?? bookId}</h2>
                </div>
                {done > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      void removeBookDownloads(bookId)
                    }}
                    className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  >
                    Borrar descargas
                  </button>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-[#7cd3ff] via-[#a99bff] to-[#f48fd4]"
                  initial={reduceMotion ? false : { width: 0 }}
                  animate={{ width: `${ratio * 100}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                />
              </div>
              <ul className="grouped">
                {bookJobs.map((job) => (
                  <li key={job.id} className="grouped-row justify-between text-sm">
                    <span className="min-w-0 truncate text-white/85">{tracks.find((track) => track.id === job.trackId)?.title ?? job.trackId}</span>
                    <div className="ml-3 flex shrink-0 items-center gap-2">
                      {(job.status === 'queued' || job.status === 'running') && (
                        <>
                          <ProgressIcon progress={job.status === 'queued' ? 0 : Math.max(0.05, job.progress)} active />
                          <button
                            type="button"
                            onClick={() => cancelJob(job.id)}
                            className="rounded-full p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
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
                            className="rounded-full p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
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
            </article>
          </Reveal>
        )
      })}

      <Reveal>
        <div className="glass flex items-start gap-4 rounded-[1.75rem] p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-cyan/15 text-accent-cyan">
            <HardDriveDownload className="size-5" />
          </span>
          <div>
            <p className="mb-1 text-[15px] font-semibold tracking-tight">Estado offline</p>
            <p className="text-sm leading-relaxed text-white/55">Los audiolibros marcados como completados quedan disponibles sin conexion si se guardaron correctamente en IndexedDB u OPFS.</p>
          </div>
        </div>
      </Reveal>
    </section>
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
      <span className="grid size-3.5 place-items-center rounded-full bg-surface-800">
        {active ? <LoaderCircle className="size-3 animate-spin text-cyan-300" /> : <Download className="size-3 text-cyan-300" />}
      </span>
    </span>
  )
}
