import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { AlertCircle, CheckCircle2, ChevronLeft, Circle, Download, Gauge, HardDriveDownload, LoaderCircle, Pause, Pencil, Play, RefreshCw, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { Reveal } from '../../components/motion/reveal'
import { TiltCard } from '../../components/motion/tilt-card'
import { EqualizerBars } from '../../components/ui/equalizer-bars'
import { ProgressRing } from '../../components/ui/progress-ring'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Sheet } from '../../components/ui/sheet'
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
const EASE_OUT = [0.16, 1, 0.3, 1] as const

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

  const { scrollY } = useScroll()
  // Parallax: la portada se adelanta al scroll y se aleja (zoom-out) dando profundidad
  const coverY = useTransform(scrollY, [0, 400], [0, -40])
  const coverScale = useTransform(scrollY, [0, 400], [1, 0.88])
  // Fondo ambient: se acerca y oscurece conforme bajas
  const ambientScale = useTransform(scrollY, [0, 800], [1.5, 1.9])
  const ambientDim = useTransform(scrollY, [0, 600], [0.35, 0.7])

  if (!book || !bookId) {
    return (
      <section className="glass mt-10 rounded-[2rem] p-10 text-center text-white/60">
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
  const safeDuration = Math.max(duration, 1)
  const clampedPosition = Math.min(position, duration)
  const isPlayingThis = playing && activeBookId === bookId

  const saveMetadata = async () => {
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
  }

  return (
    <>
      {/* Fondo ambient a pantalla completa con la portada (estilo Apple Music).
          Portal a body: el wrapper de transición de página no debe actuar de containing block. */}
      {createPortal(
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-black">
          <AnimatePresence>
            <motion.div
              key={cover ?? book.coverGradient ?? 'fallback'}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2 }}
            >
              <motion.div className="absolute inset-0" style={reduceMotion ? { scale: 1.5 } : { scale: ambientScale }}>
                <div className={`absolute inset-0 ${reduceMotion ? '' : 'animate-[spin_90s_linear_infinite]'}`}>
                  {cover ? (
                    <img src={cover} alt="" className="h-full w-full object-cover opacity-80 blur-[90px] saturate-[1.8]" />
                  ) : (
                    <div
                      className="h-full w-full opacity-80 blur-[80px]"
                      style={{ background: book.coverGradient ?? 'linear-gradient(130deg,#1d2a62,#7f49e8,#f03daf)' }}
                    />
                  )}
                </div>
              </motion.div>
            </motion.div>
          </AnimatePresence>
          <motion.div className="absolute inset-0 bg-black" style={{ opacity: reduceMotion ? 0.5 : ambientDim }} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/80" />
        </div>,
        document.body,
      )}

      <section className="relative mx-auto max-w-6xl pb-8 pt-2 sm:pt-6">
        {/* Barra superior */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="relative z-20 mb-6 flex items-center justify-between gap-2"
        >
          <button type="button" onClick={() => navigate('/')} className="btn-pill glass pl-2.5 text-[13px] text-white/90">
            <ChevronLeft className="size-4" /> Biblioteca
          </button>
          <button type="button" onClick={() => setEditing(true)} className="btn-pill glass text-[13px] text-white/90">
            <Pencil className="size-3.5" /> Editar metadatos
          </button>
        </motion.div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          {/* Columna principal: portada + info + transporte */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            {/* Portada: parallax de scroll (capa externa) + escala por play/pause (capa media) + tilt 3D */}
            <motion.div
              className="relative mx-auto mb-10 w-full max-w-[380px]"
              style={reduceMotion ? undefined : { y: coverY, scale: coverScale, transformOrigin: 'center top' }}
            >
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, scale: 0.8, rotateX: 25, y: 40 }}
                animate={{ opacity: 1, scale: isPlayingThis || reduceMotion ? 1 : 0.84, rotateX: 0, y: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 22, mass: 0.9 }}
                style={{ transformPerspective: 1200 }}
              >
                <TiltCard maxTilt={14} hoverScale={1.02} glareRadiusClassName="rounded-[2rem]">
                  <div
                    className={`relative aspect-square overflow-hidden rounded-[2rem] transition-shadow duration-700 ease-apple-out ${isPlayingThis ? 'shadow-[0_50px_100px_-20px_rgba(0,0,0,0.9)]' : 'shadow-[0_24px_48px_-16px_rgba(0,0,0,0.75)]'}`}
                    style={{ background: book.coverGradient ?? 'linear-gradient(130deg,#1d2a62,#7f49e8)' }}
                  >
                    {cover ? <img src={cover} alt={`Portada de ${book.title}`} className="absolute inset-0 h-full w-full object-cover" /> : null}
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/25" />
                    <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" />
                  </div>
                </TiltCard>
              </motion.div>
            </motion.div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 20, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.1 }}
              className="space-y-1.5 text-center lg:text-left"
            >
              <p className="text-eyebrow inline-flex items-center gap-2 text-white/60">
                <EqualizerBars active={isPlayingThis} className="text-white" />
                <span className="truncate">{activeTrack?.title ?? 'Sin pista activa'}</span>
              </p>
              <h1 className="text-display text-[2rem] leading-[1.05] sm:text-[2.6rem]">{book.title}</h1>
              <p className="text-[15px] text-white/65">{book.author} · {book.narrator}</p>
              {(book.publisher || book.publishedYear || book.isbn) && (
                <p className="text-xs text-white/40">
                  {[book.publisher, book.publishedYear ? String(book.publishedYear) : undefined, book.isbn ? `ISBN ${book.isbn}` : undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <div className="flex justify-center pt-3 lg:justify-start">
                <div className="glass inline-flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3.5">
                  <ProgressRing percent={readPercent} size={36} strokeWidth={3} label={`Porcentaje leido de ${book.title}`} />
                  <span className="text-xs tabular-nums text-white/75">{formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}</span>
                </div>
              </div>
            </motion.div>

            {/* Scrubber */}
            <div className="mt-8 space-y-2">
              <div className="scrubber">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-white"
                  style={{ width: `${Math.min(100, (clampedPosition / safeDuration) * 100)}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={safeDuration}
                  value={clampedPosition}
                  onChange={(e) => seek(Number(e.target.value))}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Progress"
                />
              </div>
              <div className="flex justify-between text-xs tabular-nums text-white/50">
                <span>{formatSeconds(position)}</span>
                <span>-{formatSeconds(Math.max(0, duration - position))}</span>
              </div>
            </div>

            {/* Transporte */}
            <div className="mt-6 flex items-center justify-center gap-3 sm:gap-5">
              <TransportButton onClick={() => skip(-15)} label="Back 15s">
                <span className="text-[12px] font-semibold tabular-nums">-15</span>
              </TransportButton>
              <TransportButton onClick={() => prev()} label="Previous" bare>
                <SkipBack className="size-7" fill="currentColor" />
              </TransportButton>
              <motion.button
                type="button"
                onClick={() => playPause()}
                aria-label={playing ? 'Pause' : 'Play'}
                whileTap={reduceMotion ? undefined : { scale: 0.86 }}
                whileHover={reduceMotion ? undefined : { scale: 1.06 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className="relative inline-flex size-[76px] items-center justify-center rounded-full bg-white text-black shadow-[0_16px_40px_-10px_rgba(255,255,255,0.5)]"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={playing ? 'pause' : 'play'}
                    initial={reduceMotion ? false : { scale: 0.3, opacity: 0, rotate: -60 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={reduceMotion ? undefined : { scale: 0.3, opacity: 0, rotate: 60 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    className="inline-flex"
                  >
                    {playing ? <Pause className="size-8" fill="currentColor" /> : <Play className="size-8 translate-x-[2px]" fill="currentColor" />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
              <TransportButton onClick={() => next()} label="Next" bare>
                <SkipForward className="size-7" fill="currentColor" />
              </TransportButton>
              <TransportButton onClick={() => skip(15)} label="Forward 15s">
                <span className="text-[12px] font-semibold tabular-nums">+15</span>
              </TransportButton>
            </div>

            {/* Velocidad */}
            <div className="mt-8 flex flex-col items-center gap-3 lg:items-start">
              <p className="text-eyebrow inline-flex items-center gap-1.5">
                <Gauge className="size-3.5" /> Velocidad
              </p>
              <SegmentedControl
                layoutId="player-speed"
                value={String(speed)}
                onChange={(value) => setSpeed(Number(value))}
                options={SPEEDS.map((value) => ({ value: String(value), label: `${value}x` }))}
                className="justify-center"
              />
            </div>

            {error && <p className="mt-4 text-center text-sm text-rose-200 lg:text-left">{error}</p>}
          </div>

          {/* Capítulos */}
          <Reveal className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-2">
              <div>
                <p className="text-eyebrow mb-1">{tracks.length} pistas</p>
                <h2 className="text-display text-2xl">Capitulos</h2>
              </div>
              {book.source === 'drive' && (
                <button
                  type="button"
                  onClick={() => {
                    void enqueueBook(book.id)
                  }}
                  className="btn-secondary text-xs"
                >
                  <Download className="size-3.5" /> Descargar todo
                </button>
              )}
            </div>
            <motion.div
              className="grouped"
              initial="hidden"
              animate="visible"
              variants={reduceMotion ? undefined : { hidden: {}, visible: { transition: { staggerChildren: 0.03, delayChildren: 0.2 } } }}
            >
              {tracks.map((track, index) => {
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
                const isCurrent = track.id === currentTrackId
                const isRead = readTrackIds.includes(track.id)
                return (
                  <motion.div
                    key={track.id}
                    variants={reduceMotion ? undefined : { hidden: { opacity: 0, x: -12 }, visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: EASE_OUT } } }}
                    className={`grouped-row text-sm transition-colors duration-300 ${isCurrent ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'}`}
                  >
                    {/* Barra de progreso del capítulo como fondo sutil */}
                    {trackProgress > 0 && trackProgress < 100 && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 bg-white/[0.04]"
                        style={{ width: `${trackProgress}%` }}
                      />
                    )}
                    <span className="relative grid w-6 shrink-0 place-items-center text-xs tabular-nums text-white/35">
                      {isCurrent ? <EqualizerBars active={isPlayingThis} className="text-accent-cyan" /> : index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => loadBook(bookId, track.id, true)}
                      className={`relative min-w-0 flex-1 truncate text-left ${isCurrent ? 'font-semibold text-white' : isRead ? 'text-white/45' : 'text-white/85'}`}
                    >
                      {track.title}
                    </button>
                    <span className="relative ml-2 flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          void markTrackRead(bookId, track.id, !isRead)
                        }}
                        className={`rounded-full p-1 transition ${isRead ? 'text-emerald-300 hover:text-emerald-200' : 'text-white/30 hover:text-white'}`}
                        aria-label={isRead ? 'Marcar capitulo como no leido' : 'Marcar capitulo como leido'}
                        title={isRead ? 'Marcado como leido' : 'Marcar como leido'}
                      >
                        {isRead ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                      </button>
                      <span className="hidden w-8 text-right text-[10px] tabular-nums text-white/40 sm:inline">{Math.round(trackProgress)}%</span>
                      <span className="w-12 text-right text-xs tabular-nums text-white/50">{formatSeconds(trackDuration)}</span>
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
                                className="rounded-full p-1 text-white/40 transition hover:text-white"
                                aria-label="Eliminar descarga"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </>
                          )
                        }
                        if (job?.status === 'running') {
                          return (
                            <span className="inline-flex items-center gap-1 text-accent-cyan">
                              <LoaderCircle className="size-3.5 animate-spin" />
                              <span className="text-[10px] tabular-nums">{Math.round((job.progress || 0) * 100)}%</span>
                            </span>
                          )
                        }
                        if (job?.status === 'queued') {
                          return (
                            <span className="inline-flex items-center gap-1 text-accent-cyan">
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
                              className="inline-flex items-center gap-1 rounded-full p-1 text-rose-300 hover:text-rose-200"
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
                            className="rounded-full p-1 text-white/40 transition hover:text-white"
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

            {book.description?.trim() && (
              <div className="mt-8">
                <p className="text-eyebrow mb-2">Sinopsis</p>
                <p className="text-[15px] leading-relaxed text-white/60">{book.description}</p>
              </div>
            )}
          </Reveal>
        </div>
      </section>

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Editar metadatos"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="button" onClick={() => void saveMetadata()} className="btn-primary">
              Guardar cambios
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} className="field" placeholder="Titulo" />
          <input value={draftAuthor} onChange={(event) => setDraftAuthor(event.target.value)} className="field" placeholder="Autor" />
          <input value={draftNarrator} onChange={(event) => setDraftNarrator(event.target.value)} className="field" placeholder="Narrador" />
          <textarea
            value={draftDescription}
            onChange={(event) => setDraftDescription(event.target.value)}
            className="field h-28 resize-none"
            placeholder="Descripcion"
          />
          <input value={draftPublisher} onChange={(event) => setDraftPublisher(event.target.value)} className="field" placeholder="Editorial" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={draftIsbn} onChange={(event) => setDraftIsbn(event.target.value)} className="field" placeholder="ISBN" />
            <input
              value={draftPublishedYear}
              onChange={(event) => setDraftPublishedYear(event.target.value)}
              className="field"
              placeholder="Ano de publicacion"
            />
          </div>
          <input value={draftGenres} onChange={(event) => setDraftGenres(event.target.value)} className="field" placeholder="Generos (coma separados)" />

          <div className="grouped mt-2 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Sugerencias online</h3>
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
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                {suggestionsLoading && <LoaderCircle className="size-3.5 animate-spin" />}
                Buscar metadata
              </button>
            </div>
            {suggestionsLoading && <p className="text-xs text-white/55">Buscando en Open Library y Google Books...</p>}
            {suggestionsError && <p className="text-xs text-rose-300">{suggestionsError}</p>}
            {!suggestionsLoading && suggestions.length === 0 && <p className="text-xs text-white/40">Sin sugerencias cargadas todavia.</p>}
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {suggestions.map((candidate, index) => (
                <motion.button
                  key={`${candidate.source}-${candidate.title}-${index}`}
                  type="button"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.4, ease: EASE_OUT }}
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
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-left transition hover:bg-white/[0.08]"
                >
                  <p className="truncate text-sm font-medium">{candidate.title}</p>
                  <p className="truncate text-xs text-white/45">{candidate.author} · {candidate.source}</p>
                </motion.button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </>
  )
}

const TransportButton = ({
  onClick,
  label,
  children,
  bare = false,
}: {
  onClick: () => void
  label: string
  children: ReactNode
  bare?: boolean
}) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      whileTap={reduceMotion ? undefined : { scale: 0.82 }}
      whileHover={reduceMotion ? undefined : { scale: 1.08 }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      className={
        bare
          ? 'inline-flex size-12 items-center justify-center rounded-full text-white/90 transition-colors hover:text-white'
          : 'inline-flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white backdrop-blur-md transition-colors hover:bg-white/[0.16]'
      }
    >
      {children}
    </motion.button>
  )
}
