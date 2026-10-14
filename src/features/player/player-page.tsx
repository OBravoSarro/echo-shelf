import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { AlertCircle, CheckCircle2, ChevronLeft, Circle, Download, Gauge, HardDriveDownload, LoaderCircle, Pause, Pencil, Play, RefreshCw, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ProgressRing } from '../../components/ui/progress-ring'
import {
  calculateBookProgressPercent,
  calculateListenedSeconds,
  calculateTrackProgressPercent,
  resolveTrackDurationSeconds,
} from '../../lib/book-progress'
import { formatHoursRatio, formatSeconds } from '../../lib/format'
import { useLibraryStore } from '../library/library-store'
import { useResolvedCover } from '../library/use-resolved-cover'
import { useDownloadStore } from '../downloads/download-store'
import { type EnrichedMetadataCandidate, searchBookMetadata } from '../metadata/book-enrichment'
import { usePlayerStore } from './player-store'

const SPEEDS = [0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]

export const PlayerPage = () => {
  const reduceMotion = useReducedMotion()
  const navigate = useNavigate()
  const params = useParams()
  const bookId = params.bookId
  const library = useLibraryStore()
  const updateBookMetadata = useLibraryStore((state) => state.updateBookMetadata)
  const readTrackIdsByBook = useLibraryStore((state) => state.readTrackIdsByBook)
  const markTrackRead = useLibraryStore((state) => state.markTrackRead)
  const enqueueBook = useDownloadStore((state) => state.enqueueBook)
  const enqueueTrack = useDownloadStore((state) => state.enqueueTrack)
  const removeTrackDownload = useDownloadStore((state) => state.removeTrackDownload)
  const downloadedTrackIds = useDownloadStore((state) => state.downloadedTrackIds)
  const jobs = useDownloadStore((state) => state.jobs)
  const activeBookId = usePlayerStore((state) => state.activeBookId)
  const currentTrackId = usePlayerStore((state) => state.currentTrackId)
  const playing = usePlayerStore((state) => state.playing)
  const position = usePlayerStore((state) => state.position)
  const duration = usePlayerStore((state) => state.duration)
  const speed = usePlayerStore((state) => state.speed)
  const error = usePlayerStore((state) => state.error)
  const loadBook = usePlayerStore((state) => state.loadBook)
  const playPause = usePlayerStore((state) => state.playPause)
  const seek = usePlayerStore((state) => state.seek)
  const skip = usePlayerStore((state) => state.skip)
  const setSpeed = usePlayerStore((state) => state.setSpeed)
  const next = usePlayerStore((state) => state.next)
  const prev = usePlayerStore((state) => state.prev)
  const book = library.books.find((item) => item.id === bookId)
  const tracks = bookId ? library.tracksByBook[bookId] ?? [] : []
  const savedProgress = bookId ? library.progressByBook[bookId] : undefined
  const activeTrack = tracks.find((track) => track.id === currentTrackId)
  const readTrackIds = readTrackIdsByBook[bookId ?? ''] ?? []
  const cover = useResolvedCover({
    bookId: book?.id,
    source: book?.source ?? 'drive',
    coverFileId: book?.coverFileId,
    coverUrl: book?.coverUrl,
  })
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftAuthor, setDraftAuthor] = useState('')
  const [draftNarrator, setDraftNarrator] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftPublisher, setDraftPublisher] = useState('')
  const [draftPublishedYear, setDraftPublishedYear] = useState('')
  const [draftGenres, setDraftGenres] = useState('')
  const [draftIsbn, setDraftIsbn] = useState('')
  const [suggestions, setSuggestions] = useState<EnrichedMetadataCandidate[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | undefined>()

  useEffect(() => {
    if (!book) return
    setDraftTitle(book.title)
    setDraftAuthor(book.author)
    setDraftNarrator(book.narrator)
    setDraftDescription(book.description ?? '')
    setDraftPublisher(book.publisher ?? '')
    setDraftPublishedYear(book.publishedYear ? String(book.publishedYear) : '')
    setDraftGenres((book.genres ?? []).join(', '))
    setDraftIsbn(book.isbn ?? '')
    setSuggestions([])
    setSuggestionsError(undefined)
  }, [book])

  useEffect(() => {
    if (!bookId) return
    if (activeBookId === bookId) return
    void loadBook(bookId)
  }, [activeBookId, bookId, loadBook])

  const coverRef = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll()

  // La portada en el flujo: parallax hacia arriba (solo translate, sin cambiar layout)
  const coverY = useTransform(scrollY, [0, 300], [0, -60])
  // Ligero zoom-out al hacer scroll — da profundidad sin hueco
  const coverScale = useTransform(scrollY, [0, 300], [1, 0.88])
  // La copia backdrop: escala hacia afuera y se difumina
  const backdropScale = useTransform(scrollY, [0, 300], [1.05, 1.25])
  const backdropOpacity = useTransform(scrollY, [0, 180], [0, 0.55])
  // Contenido (título, controles) sube con el scroll — parallax suave
  const contentY = useTransform(scrollY, [0, 300], [0, -30])

  if (!book || !bookId) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-slate-300">
        Libro no encontrado.
      </section>
    )
  }

  const playerProgress =
    activeBookId === bookId && currentTrackId
      ? {
          ...savedProgress,
          bookId,
          trackId: currentTrackId,
          positionSeconds: position,
          updatedAt: savedProgress?.updatedAt ?? 'live',
          completed: false,
          speed: speed ?? 1,
        }
      : savedProgress
  const readPercent = calculateBookProgressPercent({
    tracks,
    totalDurationSeconds: book.totalDurationSeconds,
    progress: playerProgress,
    readTrackIds,
  })
  const listenedSeconds = calculateListenedSeconds({
    tracks,
    progress: playerProgress,
    readTrackIds,
    totalDurationSeconds: book.totalDurationSeconds,
  })

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-55"
        style={{ background: book.coverGradient ?? 'linear-gradient(130deg,#1d2a62,#7f49e8)' }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.2),transparent_40%)]" />

      {/* Backdrop — portada expandida que emerge conforme scrolleas */}
      {cover && !reduceMotion && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden rounded-3xl"
          style={{ opacity: backdropOpacity }}
        >
          <motion.img
            src={cover}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ scale: backdropScale }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg-950/60 to-bg-950/95" />
        </motion.div>
      )}

      <div className="relative z-10 mx-auto max-w-3xl">
        <div className="relative z-20 mb-5 flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs"
          >
            <ChevronLeft className="size-4" /> Biblioteca
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs"
          >
            <Pencil className="size-4" /> Editar metadatos
          </button>
        </div>

        {/* Portada en el flujo — parallax y zoom-out suave con scroll */}
        <div className="relative mx-auto mb-8 w-full max-w-[360px]" style={{ aspectRatio: '1' }}>
          <motion.div
            ref={coverRef}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.92, y: 20 }}
            animate={reduceMotion ? {} : { opacity: 1, scale: 1, y: 0 }}
            style={reduceMotion
              ? { background: book.coverGradient }
              : { background: book.coverGradient, scale: coverScale, y: coverY }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="absolute inset-0 overflow-hidden rounded-[2rem] border border-white/20 shadow-[0_28px_58px_rgba(6,6,14,0.66)]"
          >
            {cover ? <img src={cover} alt={`Portada de ${book.title}`} className="absolute inset-0 h-full w-full object-cover" /> : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
          </motion.div>
        </div>

        <motion.div
          className="space-y-1 text-center"
          style={reduceMotion ? undefined : { y: contentY }}
        >
          <h1 className="text-2xl font-semibold sm:text-3xl">{book.title}</h1>
          <p className="text-sm text-slate-100/90">{book.author} · {book.narrator}</p>
          {(book.publisher || book.publishedYear) && (
            <p className="text-xs text-slate-200/80">
              {[book.publisher, book.publishedYear ? String(book.publishedYear) : undefined].filter(Boolean).join(' · ')}
            </p>
          )}
          {book.isbn && <p className="text-xs text-slate-200/70">ISBN {book.isbn}</p>}
          <p className="text-xs text-slate-200/90">{activeTrack?.title ?? 'Sin pista activa'}</p>
          <div className="pt-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/20 px-2 py-1">
              <ProgressRing percent={readPercent} size={40} label={`Porcentaje leido de ${book.title}`} />
              <span className="rounded-full border border-white/15 bg-white/6 px-2 py-1 text-xs text-slate-100/85">
                {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
              </span>
            </div>
          </div>
        </motion.div>

        <div className="mt-8 space-y-2">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan"
              style={{ width: `${Math.min(100, (Math.min(position, duration) / Math.max(duration, 1)) * 100)}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(duration, 1)}
              value={Math.min(position, duration)}
              onChange={(e) => seek(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Progress"
            />
          </div>
          <div className="flex justify-between text-xs text-slate-200/90">
            <span>{formatSeconds(position)}</span>
            <span>{formatSeconds(duration)}</span>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          <motion.button
            type="button"
            onClick={() => skip(-15)}
            aria-label="Back 15s"
            whileTap={reduceMotion ? undefined : { scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex size-12 items-center justify-center rounded-full border border-white/25 bg-white/8 text-[11px] font-semibold tracking-wide text-white transition hover:border-white/40 hover:bg-white/12"
          >
            -15s
          </motion.button>
          <motion.button
            type="button"
            onClick={() => prev()}
            aria-label="Previous"
            whileTap={reduceMotion ? undefined : { scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex size-12 items-center justify-center rounded-full border border-white/25 bg-white/8 text-white transition hover:border-white/40 hover:bg-white/12"
          >
            <SkipBack className="size-4" />
          </motion.button>
          <motion.button
            type="button"
            onClick={() => playPause()}
            aria-label={playing ? 'Pause' : 'Play'}
            whileTap={reduceMotion ? undefined : { scale: 0.9 }}
            whileHover={reduceMotion ? undefined : { scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            className="inline-flex size-14 items-center justify-center rounded-full bg-white text-bg-950 shadow-[0_0_18px_rgba(255,255,255,0.35)]"
          >
            {playing ? <Pause className="size-7" /> : <Play className="size-7" />}
          </motion.button>
          <motion.button
            type="button"
            onClick={() => next()}
            aria-label="Next"
            whileTap={reduceMotion ? undefined : { scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex size-12 items-center justify-center rounded-full border border-white/25 bg-white/8 text-white transition hover:border-white/40 hover:bg-white/12"
          >
            <SkipForward className="size-4" />
          </motion.button>
          <motion.button
            type="button"
            onClick={() => skip(15)}
            aria-label="Forward 15s"
            whileTap={reduceMotion ? undefined : { scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            className="inline-flex size-12 items-center justify-center rounded-full border border-white/25 bg-white/8 text-[11px] font-semibold tracking-wide text-white transition hover:border-white/40 hover:bg-white/12"
          >
            +15s
          </motion.button>
        </div>

        <div className="mt-8 rounded-2xl border border-white/20 bg-black/15 p-4 backdrop-blur-lg">
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-100">
            <Gauge className="size-4" /> Velocidad
          </div>
          <div className="flex flex-wrap gap-2">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSpeed(value)}
                className={`rounded-lg px-3 py-2 text-xs ${speed === value ? 'bg-white text-bg-950' : 'bg-white/12 text-slate-100'}`}
              >
                {value}x
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/15 bg-black/15 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Capitulos</h2>
            {book.source === 'drive' && (
              <button
                type="button"
                onClick={() => {
                  void enqueueBook(book.id)
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-slate-100"
              >
                <Download className="size-3.5" /> Descargar todo
              </button>
            )}
          </div>
          <motion.div
            className="max-h-56 space-y-2 overflow-y-auto pr-1"
            initial="hidden"
            animate="visible"
            variants={reduceMotion ? undefined : { hidden: {}, visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } } }}
          >
            {tracks.map((track) => {
              const trackDuration = resolveTrackDurationSeconds({
                track,
                totalDurationSeconds: book.totalDurationSeconds,
                trackCount: tracks.length,
              })
              const trackProgress = calculateTrackProgressPercent({
                track,
                tracks,
                progress: playerProgress,
                readTrackIds,
                totalDurationSeconds: book.totalDurationSeconds,
              })
              return (
                <motion.div
                key={track.id}
                variants={reduceMotion ? undefined : { hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0, transition: { duration: 0.22 } } }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${track.id === currentTrackId ? 'bg-white/20' : 'bg-white/8 hover:bg-white/14'}`}
              >
                <button type="button" onClick={() => loadBook(bookId, track.id, true)} className="min-w-0 flex-1 text-left">
                  <span className="truncate">{track.title}</span>
                </button>
                <span className="ml-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const read = readTrackIds.includes(track.id)
                      void markTrackRead(bookId, track.id, !read)
                    }}
                    className={`rounded p-1 ${readTrackIds.includes(track.id) ? 'text-emerald-300 hover:text-emerald-200' : 'text-slate-300 hover:text-white'}`}
                    aria-label={readTrackIds.includes(track.id) ? 'Marcar capitulo como no leido' : 'Marcar capitulo como leido'}
                    title={readTrackIds.includes(track.id) ? 'Marcado como leido' : 'Marcar como leido'}
                  >
                    {readTrackIds.includes(track.id) ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
                  </button>
                  <span className="text-[10px] text-slate-300">{Math.round(trackProgress)}%</span>
                  <span className="text-xs text-slate-200">{formatSeconds(trackDuration)}</span>
                  {(() => {
                    const job = jobs.find((item) => item.trackId === track.id)
                    if (downloadedTrackIds.includes(track.id)) {
                      return (
                        <>
                          <HardDriveDownload className="size-3.5 text-emerald-300" />
                          <button
                            type="button"
                            onClick={() => {
                              void removeTrackDownload(track.id)
                            }}
                            className="rounded p-1 text-slate-300 hover:text-white"
                            aria-label="Eliminar descarga"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      )
                    }
                    if (job?.status === 'running') {
                      return (
                        <span className="inline-flex items-center gap-1 text-cyan-300">
                          <LoaderCircle className="size-3.5 animate-spin" />
                          <span className="text-[10px] uppercase">{Math.round((job.progress || 0) * 100)}%</span>
                        </span>
                      )
                    }
                    if (job?.status === 'queued') {
                      return (
                        <span className="inline-flex items-center gap-1 text-cyan-300">
                          <LoaderCircle className="size-3.5 animate-spin" />
                        </span>
                      )
                    }
                    if (job?.status === 'error') {
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            void enqueueTrack(bookId, track.id)
                          }}
                          className="inline-flex items-center gap-1 rounded p-1 text-rose-300 hover:text-rose-200"
                          aria-label="Reintentar descarga"
                        >
                          <AlertCircle className="size-3.5" />
                          <RefreshCw className="size-3.5" />
                        </button>
                      )
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          void enqueueTrack(bookId, track.id)
                        }}
                        className="rounded p-1 text-slate-300 hover:text-white"
                        aria-label="Descargar capitulo"
                      >
                        <Download className="size-3.5" />
                      </button>
                    )
                  })()}
                </span>
              </motion.div>
              )
            })}
          </motion.div>
        </div>

        {error && <p className="mt-4 text-sm text-rose-200">{error}</p>}
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-bg-900 p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Editar metadatos</h2>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-white/20 px-3 py-1 text-xs"
              >
                Cerrar
              </button>
            </div>
            <div className="space-y-3">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Titulo"
              />
              <input
                value={draftAuthor}
                onChange={(event) => setDraftAuthor(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Autor"
              />
              <input
                value={draftNarrator}
                onChange={(event) => setDraftNarrator(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Narrador"
              />
              <textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                className="h-24 w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Descripcion"
              />
              <input
                value={draftPublisher}
                onChange={(event) => setDraftPublisher(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Editorial"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={draftIsbn}
                  onChange={(event) => setDraftIsbn(event.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                  placeholder="ISBN"
                />
                <input
                  value={draftPublishedYear}
                  onChange={(event) => setDraftPublishedYear(event.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                  placeholder="Ano de publicacion"
                />
              </div>
              <input
                value={draftGenres}
                onChange={(event) => setDraftGenres(event.target.value)}
                className="w-full rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Generos (coma separados)"
              />
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium">Sugerencias online</h3>
                  <button
                    type="button"
                    onClick={async () => {
                      setSuggestionsLoading(true)
                      setSuggestionsError(undefined)
                      try {
                        const results = await searchBookMetadata(draftTitle || book.title, draftAuthor || book.author, draftIsbn)
                        setSuggestions(results)
                      } catch (error) {
                        setSuggestionsError(error instanceof Error ? error.message : 'No se pudieron cargar sugerencias')
                      } finally {
                        setSuggestionsLoading(false)
                      }
                    }}
                    className="rounded-lg border border-white/20 px-3 py-1 text-xs"
                  >
                    Buscar metadata
                  </button>
                </div>
                {suggestionsLoading && <p className="text-xs text-slate-300">Buscando en Open Library y Google Books...</p>}
                {suggestionsError && <p className="text-xs text-rose-300">{suggestionsError}</p>}
                {!suggestionsLoading && suggestions.length === 0 && (
                  <p className="text-xs text-slate-400">Sin sugerencias cargadas todavia.</p>
                )}
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {suggestions.map((candidate, index) => (
                    <button
                      key={`${candidate.source}-${candidate.title}-${index}`}
                      type="button"
                      onClick={() => {
                        setDraftTitle(candidate.title)
                        setDraftAuthor(candidate.author)
                        setDraftDescription(candidate.description ?? draftDescription)
                        setDraftPublisher(candidate.publisher ?? draftPublisher)
                        setDraftPublishedYear(candidate.publishedYear ? String(candidate.publishedYear) : draftPublishedYear)
                        setDraftIsbn(candidate.isbn ?? draftIsbn)
                        if (candidate.genres?.length) {
                          setDraftGenres(candidate.genres.join(', '))
                        }
                        void updateBookMetadata(book.id, {
                          title: candidate.title,
                          author: candidate.author,
                          description: candidate.description,
                          publisher: candidate.publisher,
                          publishedYear: candidate.publishedYear,
                          genres: candidate.genres,
                          isbn: candidate.isbn,
                          coverUrl: candidate.coverUrl,
                          coverFileId: undefined,
                        })
                      }}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left"
                    >
                      <p className="truncate text-sm font-medium">{candidate.title}</p>
                      <p className="truncate text-xs text-slate-400">{candidate.author} · {candidate.source}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  const yearNumber = Number(draftPublishedYear)
                  const genres = draftGenres
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                  await updateBookMetadata(book.id, {
                    title: draftTitle,
                    author: draftAuthor,
                    narrator: draftNarrator,
                    description: draftDescription,
                    publisher: draftPublisher || undefined,
                    publishedYear: Number.isFinite(yearNumber) && yearNumber > 0 ? yearNumber : undefined,
                    genres: genres.length > 0 ? genres : undefined,
                    isbn: draftIsbn || undefined,
                  })
                  setEditing(false)
                }}
                className="rounded-xl bg-gradient-to-r from-accent-violet to-accent-magenta px-4 py-2 text-sm font-medium"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
