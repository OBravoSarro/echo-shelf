import {
  Cloud,
  CloudOff,
  FolderSearch,
  GripVertical,
  LayoutGrid,
  LayoutList,
  LoaderCircle,
  Pause,
  Play,
  Rows,
  Search,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { type ReactNode, useRef, useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from 'react-router-dom'
import type { Audiobook } from '../../domain/audiobook'
import { Reveal } from '../../components/motion/reveal'
import { TiltCard } from '../../components/motion/tilt-card'
import { EqualizerBars } from '../../components/ui/equalizer-bars'
import { LargeTitle, SectionHeader } from '../../components/ui/large-title'
import { ProgressRing } from '../../components/ui/progress-ring'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { UserAvatar } from '../../components/ui/user-avatar'
import { calculateListenedSeconds } from '../../lib/book-progress'
import { hasFirebaseAuthConfig } from '../../lib/env'
import { calculateBookProgressPercent } from '../../lib/book-progress'
import { formatDurationCompact, formatHoursRatio, formatSeconds } from '../../lib/format'
import { useAuthStore } from '../auth/auth-store'
import { usePlayerStore } from '../player/player-store'
import { useLibraryStore } from './library-store'
import { useResolvedCover } from './use-resolved-cover'

export const LibraryPage = () => {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'grid' | 'list'>('cards')
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({})
  // ref para detectar cuándo la sección "Continuar escuchando" sale del viewport
  // Callback ref + objeto memoizado: la sección se monta DESPUÉS de cargar los libros
  // (async desde IndexedDB) y `useInView` solo se suscribe cuando cambia el objeto ref.
  // Con un useRef fijo el observer nunca llegaba a engancharse y el mini player no salía.
  const [continueEl, setContinueEl] = useState<HTMLElement | null>(null)
  const continueRef = useMemo(() => ({ current: continueEl }), [continueEl])
  const continueInView = useInView(continueRef, { amount: 0.1 })
  // El sticky solo se activa después de que el observer haya reportado al menos
  // una vez que el elemento estaba visible — evita el flash en primer render.
  const [hasBeenInView, setHasBeenInView] = useState(false)
  useEffect(() => {
    if (continueInView) setHasBeenInView(true)
  }, [continueInView])
  useEffect(() => {
    const stored = window.localStorage.getItem('library-view')
    if (stored === 'cards' || stored === 'grid' || stored === 'list') {
      setViewMode(stored)
    }
  }, [])
  const showSticky = hasBeenInView && !continueInView
  const session = useAuthStore()
  const library = useLibraryStore()
  const activeBookId = usePlayerStore((state) => state.activeBookId)
  const currentTrackId = usePlayerStore((state) => state.currentTrackId)
  const playing = usePlayerStore((state) => state.playing)
  const pending = usePlayerStore((state) => state.pending)
  const position = usePlayerStore((state) => state.position)
  const duration = usePlayerStore((state) => state.duration)
  const speed = usePlayerStore((state) => state.speed)
  const loadBook = usePlayerStore((state) => state.loadBook)
  const playPause = usePlayerStore((state) => state.playPause)
  const prev = usePlayerStore((state) => state.prev)
  const next = usePlayerStore((state) => state.next)
  const seek = usePlayerStore((state) => state.seek)
  const skip = usePlayerStore((state) => state.skip)
  const reorderBooks = useLibraryStore((state) => state.reorderBooks)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = library.books.findIndex((b) => b.id === active.id)
    const newIndex = library.books.findIndex((b) => b.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(library.books, oldIndex, newIndex)
    void reorderBooks(reordered.map((b) => b.id))
  }

  const books = useMemo(() => {
    const source = library.books
    if (!search.trim()) return source
    const lower = search.toLowerCase()
    return source.filter((book) => [book.title, book.author, book.narrator].join(' ').toLowerCase().includes(lower))
  }, [library.books, search])

  const getEffectiveProgress = (bookId: string) => {
    const savedProgress = library.progressByBook[bookId]
    if (activeBookId !== bookId || !currentTrackId) {
      return savedProgress
    }
    if (!savedProgress && !playing && position <= 0) {
      return undefined
    }
    return {
      ...savedProgress,
      bookId,
      trackId: currentTrackId,
      positionSeconds: position,
      updatedAt: savedProgress?.updatedAt ?? new Date().toISOString(),
      completed: false,
      speed,
    }
  }

  const continueListening = books
    .map((book) => ({ book, progress: getEffectiveProgress(book.id) }))
    .filter((item) => Boolean(item.progress))
    .sort((a, b) => {
      const ta = a.progress?.updatedAt ?? ''
      const tb = b.progress?.updatedAt ?? ''
      return tb.localeCompare(ta)
    })
    .slice(0, 1)
  const showSkeleton = library.loading && books.length === 0

  const toggleDescription = (bookId: string) => {
    setExpandedDescriptions((current) => ({
      ...current,
      [bookId]: !current[bookId],
    }))
  }

  const handleContinuePlay = async (bookId: string, trackId?: string) => {
    if (activeBookId === bookId) {
      await playPause()
      return
    }
    await loadBook(bookId, trackId, true)
  }

  const ensureBookLoaded = async (bookId: string, trackId?: string) => {
    if (activeBookId === bookId) {
      return true
    }
    await loadBook(bookId, trackId, false)
    return usePlayerStore.getState().activeBookId === bookId
  }

  const handleContinuePrev = async (bookId: string, trackId?: string) => {
    const ready = await ensureBookLoaded(bookId, trackId)
    if (!ready) return
    await prev()
  }

  const handleContinueNext = async (bookId: string, trackId?: string) => {
    const ready = await ensureBookLoaded(bookId, trackId)
    if (!ready) return
    await next()
  }

  const handleContinueSkip = async (bookId: string, trackId: string | undefined, seconds: number) => {
    const ready = await ensureBookLoaded(bookId, trackId)
    if (!ready) return
    skip(seconds)
  }

  const handleContinueSeek = async (bookId: string, trackId: string | undefined, seconds: number) => {
    const ready = await ensureBookLoaded(bookId, trackId)
    if (!ready) return
    seek(seconds)
  }

  const getBookPercent = (bookId: string) => {
    const { book, tracks, effectiveProgress } = getProgressContext(bookId)
    if (!book) return 0
    const readTrackIds = library.readTrackIdsByBook[bookId] ?? []

    return calculateBookProgressPercent({
      tracks,
      totalDurationSeconds: book.totalDurationSeconds,
      progress: effectiveProgress,
      readTrackIds,
    })
  }

  const getBookListenedSeconds = (bookId: string) => {
    const { book, tracks, effectiveProgress } = getProgressContext(bookId)
    const readTrackIds = library.readTrackIdsByBook[bookId] ?? []
    return calculateListenedSeconds({
      tracks,
      progress: effectiveProgress,
      readTrackIds,
      totalDurationSeconds: book?.totalDurationSeconds,
    })
  }

  const getProgressContext = (bookId: string) => {
    const book = library.books.find((item) => item.id === bookId)
    const tracks = library.tracksByBook[bookId] ?? []
    const effectiveProgress = getEffectiveProgress(bookId)
    return { book, tracks, effectiveProgress }
  }

  // libro para el sticky: el activo si está en continueListening, si no el primero
  const stickyItem =
    continueListening.find((item) => item.book.id === activeBookId) ?? continueListening[0]

  const handleViewChange = (mode: 'cards' | 'grid' | 'list') => {
    setViewMode(mode)
    window.localStorage.setItem('library-view', mode)
  }

  return (
    <section className="space-y-10 pb-4 sm:space-y-14">
      {/* Sticky mini player — portal a body para no afectar el flujo del DOM */}
      {createPortal(
        <AnimatePresence>
          {stickyItem && showSticky && (
            <StickyMiniPlayer
              book={stickyItem.book}
              progress={stickyItem.progress}
              source={library.source}
              activeBookId={activeBookId}
              playing={playing}
              pending={pending}
              position={position}
              duration={duration}
              percent={getBookPercent(stickyItem.book.id)}
              onPlay={() => void handleContinuePlay(stickyItem.book.id, stickyItem.progress?.trackId)}
              onNavigate={() => navigate(`/player/${stickyItem.book.id}`)}
              reduceMotion={reduceMotion ?? false}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

      <div className="space-y-6">
        <LargeTitle
          eyebrow="Biblioteca"
          title="EchoShelf"
          subtitle="Tu biblioteca de audiolibros"
          trailing={
            session.connected && (session.displayName || session.email) ? (
              <div className="glass flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-xs text-white/80">
                <UserAvatar
                  photoUrl={session.photoUrl}
                  name={session.displayName}
                  email={session.email}
                  sizeClassName="size-7"
                  textClassName="text-[10px] font-semibold"
                  fallbackClassName="bg-white/20"
                />
                <span className="max-w-[140px] truncate font-medium">{session.displayName ?? session.email}</span>
              </div>
            ) : session.reconnectRequired ? (
              <button
                type="button"
                onClick={() => {
                  void session.reconnect()
                }}
                className="btn-pill border border-amber-300/30 bg-amber-300/15 text-xs text-amber-100"
              >
                <CloudOff className="size-3.5" /> Reconectar Google
              </button>
            ) : null
          }
        />

        {/* Search */}
        <Reveal delay={0.1} y={16}>
          <label className="glass group flex items-center gap-3 rounded-full px-5 py-3.5 transition duration-300 focus-within:border-white/20 focus-within:bg-white/[0.08] focus-within:ring-4 focus-within:ring-accent-violet/20">
            <Search className="size-4 text-white/40 transition group-focus-within:text-white/80" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Busca por titulo, autor o narrador"
              className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-white/35"
            />
          </label>
        </Reveal>
      </div>

      {/* Warnings */}
      {!hasFirebaseAuthConfig && (
        <Reveal>
          <div className="rounded-[1.375rem] border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-100 backdrop-blur-xl">
            Falta configuracion de Firebase Auth. Configura Drive desde Ajustes para sincronizar tu biblioteca.
          </div>
        </Reveal>
      )}

      {!library.driveRootId && (
        <Reveal>
          <div className="glass flex flex-col items-start justify-between gap-4 rounded-[1.75rem] p-5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent-violet to-accent-magenta shadow-[0_10px_30px_-8px_rgba(240,61,175,0.6)]">
                <FolderSearch className="size-5" />
              </span>
              <p className="text-sm leading-relaxed text-white/70">No hay carpeta de Google Drive configurada. Ve a Ajustes para conectarla y sincronizar tu biblioteca.</p>
            </div>
            <button type="button" onClick={() => navigate('/settings')} className="btn-primary shrink-0">
              Configurar en Ajustes
            </button>
          </div>
        </Reveal>
      )}

      {/* Skeleton */}
      {showSkeleton && (
        <article className="grid gap-6 rounded-[2rem] border border-white/[0.06] bg-white/[0.03] p-6 sm:grid-cols-[240px_1fr]">
          <div className="skeleton aspect-square rounded-[1.5rem]" />
          <div className="space-y-3 pt-2">
            <div className="skeleton h-9 w-64" />
            <div className="skeleton h-4 w-72" />
            <div className="skeleton h-4 w-80" />
          </div>
        </article>
      )}

      {!showSkeleton && books.length === 0 && (
        <Reveal>
          <div className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-10 text-center text-[15px] text-white/55">
            No hay audiolibros en la biblioteca. Conecta Drive y sincroniza tu carpeta desde Ajustes.
          </div>
        </Reveal>
      )}

      {/* Continuar escuchando */}
      {continueListening.length > 0 && (
        <section ref={setContinueEl} className="space-y-5">
          <Reveal>
            <SectionHeader eyebrow="Ahora" title="Continuar escuchando" />
          </Reveal>
          {continueListening.map(({ book, progress }) => {
            const isActive = activeBookId === book.id
            return (
              <Reveal key={book.id} delay={0.05}>
                <ContinueHero
                  book={book}
                  source={library.source}
                  isActive={isActive}
                  playing={playing}
                  pending={pending}
                  positionSeconds={isActive ? position : (progress?.positionSeconds ?? 0)}
                  totalSeconds={Math.max(1, isActive && duration > 0 ? duration : book.totalDurationSeconds)}
                  percent={getBookPercent(book.id)}
                  listenedSeconds={getBookListenedSeconds(book.id)}
                  onNavigate={() => navigate(`/player/${book.id}`)}
                  onPlay={() => void handleContinuePlay(book.id, progress?.trackId)}
                  onPrev={() => void handleContinuePrev(book.id, progress?.trackId)}
                  onNext={() => void handleContinueNext(book.id, progress?.trackId)}
                  onSkip={(seconds) => void handleContinueSkip(book.id, progress?.trackId, seconds)}
                  onSeek={(seconds) => void handleContinueSeek(book.id, progress?.trackId, seconds)}
                />
              </Reveal>
            )
          })}
        </section>
      )}

      {/* Tu biblioteca */}
      {books.length > 0 && (
        <section className="space-y-5">
          <Reveal>
            <SectionHeader
              eyebrow={`${books.length} ${books.length === 1 ? 'titulo' : 'titulos'}`}
              title="Tu biblioteca"
              trailing={
                <SegmentedControl
                  layoutId="library-view-mode"
                  value={viewMode}
                  onChange={handleViewChange}
                  options={[
                    { value: 'cards', label: <><LayoutList className="size-3.5" /> Cards</> },
                    { value: 'grid', label: <><LayoutGrid className="size-3.5" /> Grid</> },
                    { value: 'list', label: <><Rows className="size-3.5" /> Lista</> },
                  ]}
                />
              }
            />
          </Reveal>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={books.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={viewMode}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  {viewMode === 'cards' && (
                    <div className="space-y-5">
                      {books.map((book) => (
                        <SortableBookCard
                          key={book.id}
                          book={book}
                          percent={getBookPercent(book.id)}
                          listenedSeconds={getBookListenedSeconds(book.id)}
                          source={library.source}
                          expandedDescription={Boolean(expandedDescriptions[book.id])}
                          onToggleDescription={() => toggleDescription(book.id)}
                          onNavigate={() => navigate(`/player/${book.id}`)}
                          isPlaying={activeBookId === book.id && playing}
                        />
                      ))}
                    </div>
                  )}
                  {viewMode === 'grid' && (
                    <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 xl:grid-cols-4">
                      {books.map((book, index) => (
                        <GridBookCard
                          key={book.id}
                          book={book}
                          index={index}
                          percent={getBookPercent(book.id)}
                          listenedSeconds={getBookListenedSeconds(book.id)}
                          source={library.source}
                          onNavigate={() => navigate(`/player/${book.id}`)}
                          isPlaying={activeBookId === book.id && playing}
                        />
                      ))}
                    </div>
                  )}
                  {viewMode === 'list' && (
                    <div className="grouped">
                      {books.map((book) => (
                        <SimpleBookRow
                          key={book.id}
                          book={book}
                          percent={getBookPercent(book.id)}
                          source={library.source}
                          onNavigate={() => navigate(`/player/${book.id}`)}
                          isPlaying={activeBookId === book.id && playing}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </SortableContext>
          </DndContext>
        </section>
      )}

      {/* Footer */}
      <footer className="flex flex-wrap items-center gap-3 pt-2 text-xs text-white/40">
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${navigator.onLine ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-amber-400'}`} />
          {navigator.onLine ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}
          {navigator.onLine ? 'Con conexion' : 'Sin conexion'}
        </span>
        {library.loading && (
          <span className="inline-flex items-center gap-1.5">
            <LoaderCircle className="size-3.5 animate-spin" /> Sincronizando biblioteca...
          </span>
        )}
        {library.error && <span className="text-rose-300">{library.error}</span>}
      </footer>
    </section>
  )
}

// ─── Continue Listening Hero ──────────────────────────────────────────────────

const ContinueHero = ({
  book,
  source,
  isActive,
  playing,
  pending,
  positionSeconds,
  totalSeconds,
  percent,
  listenedSeconds,
  onNavigate,
  onPlay,
  onPrev,
  onNext,
  onSkip,
  onSeek,
}: {
  book: Audiobook
  source: 'drive'
  isActive: boolean
  playing: boolean
  pending: boolean
  positionSeconds: number
  totalSeconds: number
  percent: number
  listenedSeconds: number
  onNavigate: () => void
  onPlay: () => void
  onPrev: () => void
  onNext: () => void
  onSkip: (seconds: number) => void
  onSeek: (seconds: number) => void
}) => {
  const reduceMotion = useReducedMotion()
  const cover = useResolvedCover({ bookId: book.id, source, coverFileId: book.coverFileId, coverUrl: book.coverUrl })
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  // Parallax en dos planos: el fondo se mueve en sentido contrario a la portada
  const backdropY = useTransform(scrollYProgress, [0, 1], [-50, 50])
  const backdropScale = useTransform(scrollYProgress, [0, 0.5, 1], [1.35, 1.2, 1.35])
  const coverY = useTransform(scrollYProgress, [0, 1], [36, -36])
  const disabled = pending && isActive
  const isPlaying = isActive && playing
  const progressPct = Math.min(100, (positionSeconds / totalSeconds) * 100)

  return (
    <article
      ref={ref}
      className="group relative isolate cursor-pointer overflow-hidden rounded-[2rem] border border-white/[0.08] bg-surface-800/40 shadow-float"
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onNavigate()}
    >
      {/* Fondo: portada ampliada, desenfocada y saturada (estilo Apple Music) */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={reduceMotion ? undefined : { y: backdropY, scale: backdropScale }}
      >
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover opacity-70 blur-3xl saturate-[1.8]" />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(130deg,#1d2a62,#7f49e8,#f03daf)] opacity-60 blur-2xl" />
        )}
      </motion.div>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-black/30 via-black/50 to-black/80" />

      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,260px)_1fr] sm:items-center sm:gap-10 sm:p-8">
        <motion.div style={reduceMotion ? undefined : { y: coverY }} className="mx-auto w-full max-w-[260px]">
          <TiltCard maxTilt={12} glareRadiusClassName="rounded-[1.5rem]">
            <motion.div
              animate={reduceMotion ? undefined : { scale: isPlaying ? 1 : 0.94 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="[transform:translateZ(40px)]"
            >
              <CoverArt
                src={cover}
                title={book.title}
                className={`aspect-square rounded-[1.5rem] transition-shadow duration-700 ${isPlaying ? 'shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)]' : 'shadow-[0_20px_40px_-16px_rgba(0,0,0,0.8)]'}`}
              />
            </motion.div>
          </TiltCard>
        </motion.div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            <p className="text-eyebrow inline-flex items-center gap-2 text-white/70">
              <EqualizerBars active={isPlaying} className="text-accent-cyan" />
              {isPlaying ? 'Reproduciendo' : 'En pausa'}
            </p>
            <h4 className="text-display text-3xl leading-[1.05] sm:text-[2.6rem]">{book.title}</h4>
            <p className="text-[15px] text-white/60">{book.author}</p>
            <div className="flex items-center gap-2 pt-1">
              <ProgressRing percent={percent} size={34} strokeWidth={3} label={`Porcentaje leido de ${book.title}`} />
              <span className="text-xs tabular-nums text-white/55">{formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}</span>
            </div>
          </div>

          <div className="space-y-1.5" onClick={(event) => event.stopPropagation()}>
            <div className="scrubber">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white transition-[width] duration-300"
                style={{ width: `${progressPct}%` }}
              />
              <input
                type="range"
                min={0}
                max={totalSeconds}
                step={1}
                value={Math.min(positionSeconds, totalSeconds)}
                onChange={(event) => onSeek(Number(event.target.value))}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={`Progreso de ${book.title}`}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] tabular-nums text-white/45">
              <span>{formatSeconds(positionSeconds)}</span>
              <span>-{formatSeconds(Math.max(0, totalSeconds - positionSeconds))}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 sm:justify-start sm:gap-3" onClick={(event) => event.stopPropagation()}>
            <IconButton onClick={() => onSkip(-15)} disabled={disabled} label="Retroceder 15 segundos" text="-15s" />
            <IconButton onClick={onPrev} disabled={disabled} label="Pista anterior" icon={<SkipBack className="size-4" fill="currentColor" />} />
            <PlayButton onClick={onPlay} disabled={disabled} isActive={isActive} playing={playing} />
            <IconButton onClick={onNext} disabled={disabled} label="Pista siguiente" icon={<SkipForward className="size-4" fill="currentColor" />} />
            <IconButton onClick={() => onSkip(15)} disabled={disabled} label="Avanzar 15 segundos" text="+15s" />
          </div>
        </div>
      </div>
    </article>
  )
}

// ─── Sortable Book Card ───────────────────────────────────────────────────────

const SortableBookCard = ({
  book,
  percent,
  listenedSeconds,
  source,
  expandedDescription,
  onToggleDescription,
  onNavigate,
  isPlaying,
}: {
  book: Audiobook
  percent: number
  listenedSeconds: number
  source: 'drive'
  expandedDescription: boolean
  onToggleDescription: () => void
  onNavigate: () => void
  isPlaying: boolean
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  const dragHandle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      className="touch-none rounded-full p-2 text-white/30 transition hover:bg-white/10 hover:text-white/70 active:text-white"
      aria-label="Reordenar"
    >
      <GripVertical className="size-4" />
    </button>
  )

  return (
    <div
      ref={setNodeRef}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
    >
      <Reveal>
        <TiltCard
          maxTilt={4}
          hoverScale={1.008}
          className={`grid gap-6 rounded-[1.75rem] border p-5 transition-colors duration-500 sm:grid-cols-[200px_1fr] sm:p-6 ${isDragging ? 'border-accent-violet/60 bg-white/[0.08] shadow-[0_0_0_4px_rgba(123,99,255,0.25)]' : 'border-white/[0.07] bg-white/[0.035] hover:border-white/[0.14] hover:bg-white/[0.055]'}`}
        >
          <div className="[transform:translateZ(36px)]">
            <BookCover
              bookId={book.id}
              source={source}
              coverFileId={book.coverFileId}
              coverUrl={book.coverUrl}
              title={book.title}
              className="aspect-square rounded-[1.25rem] shadow-[0_24px_48px_-16px_rgba(0,0,0,0.8)]"
            />
          </div>
          <div className="min-w-0 space-y-3 [transform:translateZ(18px)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                {isPlaying && (
                  <p className="text-eyebrow inline-flex items-center gap-2 text-accent-cyan">
                    <EqualizerBars active /> Reproduciendo
                  </p>
                )}
                <h4 className="text-display text-2xl leading-tight sm:text-[1.75rem]">{book.title}</h4>
                <p className="text-sm text-white/55">{book.author} · Narrado por {book.narrator}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ProgressRing percent={percent} size={44} strokeWidth={3.5} label={`Porcentaje leido de ${book.title}`} />
                {dragHandle}
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <DescriptionBlock
                description={book.description}
                expanded={expandedDescription}
                onToggle={onToggleDescription}
              />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-xs text-white/65">
                {formatDurationCompact(book.totalDurationSeconds)}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-xs tabular-nums text-white/65">
                {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
              </span>
            </div>
          </div>
        </TiltCard>
      </Reveal>
    </div>
  )
}

// ─── Grid Book Card ───────────────────────────────────────────────────────────

const GridBookCard = ({
  book,
  index,
  percent,
  listenedSeconds,
  source,
  onNavigate,
  isPlaying,
}: {
  book: Audiobook
  index: number
  percent: number
  listenedSeconds: number
  source: 'drive'
  onNavigate: () => void
  isPlaying: boolean
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  return (
    <div
      ref={setNodeRef}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
    >
      <Reveal delay={(index % 4) * 0.07}>
        <TiltCard
          maxTilt={12}
          hoverScale={1.03}
          glareRadiusClassName="rounded-[1.25rem]"
          className={`group rounded-[1.5rem] ${isDragging ? 'ring-4 ring-accent-violet/40' : ''}`}
        >
          <div className="relative [transform:translateZ(30px)]">
            <BookCover
              bookId={book.id}
              source={source}
              coverFileId={book.coverFileId}
              coverUrl={book.coverUrl}
              title={book.title}
              className="aspect-square w-full rounded-[1.25rem] shadow-[0_24px_40px_-14px_rgba(0,0,0,0.85)] transition-shadow duration-500 group-hover:shadow-[0_40px_60px_-16px_rgba(0,0,0,0.95)]"
            />
            <div className="absolute left-2.5 top-2.5 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-md">
              {formatDurationCompact(book.totalDurationSeconds)}
            </div>
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              onClick={(event) => event.stopPropagation()}
              className="absolute right-2.5 top-2.5 touch-none rounded-full bg-black/45 p-1.5 text-white/80 opacity-100 backdrop-blur-md transition sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="Reordenar"
            >
              <GripVertical className="size-3.5" />
            </button>
            {isPlaying && (
              <div className="absolute bottom-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-white text-black shadow-lg">
                <EqualizerBars active />
              </div>
            )}
          </div>
          <div className="mt-3 space-y-0.5 px-0.5 [transform:translateZ(14px)]">
            <p className="truncate text-[15px] font-semibold tracking-tight">{book.title}</p>
            <p className="truncate text-xs text-white/50">{book.author}</p>
          </div>
          <div className="mt-2.5 flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <ProgressRing percent={percent} size={28} strokeWidth={2.5} label={`Porcentaje leido de ${book.title}`} />
              <span className="hidden text-[10px] tabular-nums text-white/45 sm:inline">
                {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
              </span>
            </div>
            <span className="text-[10px] text-white/40">{book.trackCount} pistas</span>
          </div>
        </TiltCard>
      </Reveal>
    </div>
  )
}

// ─── Simple List Row ──────────────────────────────────────────────────────────

const SimpleBookRow = ({
  book,
  percent,
  source,
  onNavigate,
  isPlaying,
}: {
  book: Audiobook
  percent: number
  source: 'drive'
  onNavigate: () => void
  isPlaying: boolean
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  return (
    <div
      ref={setNodeRef}
      onClick={onNavigate}
      className={`grouped-row w-full text-left transition-colors duration-300 ${isDragging ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05] active:bg-white/[0.08]'}`}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onNavigate()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
    >
      <BookCover
        bookId={book.id}
        source={source}
        coverFileId={book.coverFileId}
        coverUrl={book.coverUrl}
        title={book.title}
        className="size-14 shrink-0 rounded-xl shadow-[0_8px_16px_-6px_rgba(0,0,0,0.8)]"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[15px] font-medium tracking-tight">
          {isPlaying && <EqualizerBars active className="text-accent-cyan" />}
          <span className="truncate">{book.title}</span>
        </p>
        <p className="truncate text-xs text-white/45">{book.author} · {book.narrator}</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#a99bff] via-[#f48fd4] to-[#7cd3ff] transition-[width] duration-700"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      </div>
      <span className="w-9 text-right text-[11px] tabular-nums text-white/40">{Math.round(percent)}%</span>
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
        className="touch-none rounded-full p-1.5 text-white/30 hover:text-white/70 active:text-white"
        aria-label="Reordenar"
      >
        <GripVertical className="size-4" />
      </span>
    </div>
  )
}

// ─── Sticky Mini Player ────────────────────────────────────────────────────────

type Book = ReturnType<typeof useLibraryStore.getState>['books'][number]
type Progress = ReturnType<typeof useLibraryStore.getState>['progressByBook'][string]

const StickyMiniPlayer = ({
  book,
  progress,
  source,
  activeBookId,
  playing,
  pending,
  position,
  duration,
  percent,
  onPlay,
  onNavigate,
  reduceMotion,
}: {
  book: Book
  progress?: Progress
  source: 'drive'
  activeBookId: string | undefined
  playing: boolean
  pending: boolean
  position: number
  duration: number
  percent: number
  onPlay: () => void
  onNavigate: () => void
  reduceMotion: boolean
}) => {
  const isActive = activeBookId === book.id
  const disabled = pending && isActive
  const positionSeconds = isActive ? position : (progress?.positionSeconds ?? 0)
  const totalSeconds = Math.max(1, isActive && duration > 0 ? duration : book.totalDurationSeconds)
  const progressPct = Math.min(100, (positionSeconds / totalSeconds) * 100)

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -60, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -60, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="fixed left-0 right-0 top-0 z-40 mx-auto max-w-2xl px-4 pt-[calc(env(safe-area-inset-top)+0.6rem)] sm:px-6 lg:pl-72"
    >
      <div
        className="glass-strong relative cursor-pointer overflow-hidden rounded-[1.375rem]"
        onClick={onNavigate}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
        aria-label={`Abrir reproductor de ${book.title}`}
      >
        <div
          className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-[#a99bff] via-[#f48fd4] to-[#7cd3ff] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <BookCover
            bookId={book.id}
            source={source}
            coverFileId={book.coverFileId}
            coverUrl={book.coverUrl}
            title={book.title}
            className="size-11 shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-[13px] font-semibold tracking-tight">
              {isActive && playing && <EqualizerBars active className="text-accent-cyan" />}
              <span className="truncate">{book.title}</span>
            </p>
            <p className="truncate text-[11px] text-white/50">{book.author}</p>
          </div>
          <ProgressRing percent={percent} size={30} strokeWidth={2.5} label={`Progreso ${book.title}`} />
          <motion.button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPlay() }}
            disabled={disabled}
            whileTap={reduceMotion ? undefined : { scale: 0.86 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            aria-label={isActive && playing ? 'Pausar' : 'Reproducir'}
            className="ml-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:opacity-60"
          >
            <PlayPauseIcon pending={disabled} playing={isActive && playing} className="size-4" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Play / Pause icon con morph ──────────────────────────────────────────────

const PlayPauseIcon = ({ pending, playing, className }: { pending: boolean; playing: boolean; className: string }) => {
  const reduceMotion = useReducedMotion()
  if (pending) return <LoaderCircle className={`${className} animate-spin`} />
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={playing ? 'pause' : 'play'}
        initial={reduceMotion ? false : { scale: 0.4, opacity: 0, rotate: -45 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={reduceMotion ? undefined : { scale: 0.4, opacity: 0, rotate: 45 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
        className="inline-flex"
      >
        {playing ? <Pause className={className} fill="currentColor" /> : <Play className={`${className} translate-x-[1px]`} fill="currentColor" />}
      </motion.span>
    </AnimatePresence>
  )
}

// ─── Play Button with spring scale ────────────────────────────────────────────

const PlayButton = ({
  onClick,
  disabled,
  isActive,
  playing,
}: {
  onClick: () => void
  disabled?: boolean
  isActive: boolean
  playing: boolean
}) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={reduceMotion ? undefined : { scale: 0.88 }}
      whileHover={reduceMotion ? undefined : { scale: 1.07 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      aria-label={isActive && playing ? 'Pausar' : 'Reproducir'}
      className="inline-flex size-16 items-center justify-center rounded-full bg-white text-black shadow-[0_12px_32px_-8px_rgba(255,255,255,0.45)] disabled:opacity-70"
    >
      <PlayPauseIcon pending={Boolean(disabled)} playing={isActive && playing} className="size-6" />
    </motion.button>
  )
}

// ─── Description with animated height ─────────────────────────────────────────

const DescriptionBlock = ({ description, expanded, onToggle }: { description?: string; expanded: boolean; onToggle: () => void }) => {
  const reduceMotion = useReducedMotion()

  if (!description?.trim()) {
    return <p className="text-sm text-white/35">Sin descripcion disponible.</p>
  }

  const canExpand = description.length > 180

  return (
    <div>
      <motion.p
        key={expanded ? 'expanded' : 'collapsed'}
        initial={reduceMotion ? false : { opacity: 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className={`text-sm leading-relaxed text-white/50 ${!expanded && canExpand ? 'line-clamp-3' : ''}`}
      >
        {description}
      </motion.p>
      {canExpand && (
        <button type="button" onClick={onToggle} className="mt-1.5 text-xs font-semibold text-accent-cyan transition hover:text-white">
          {expanded ? 'Leer menos' : 'Leer mas'}
        </button>
      )}
    </div>
  )
}

// ─── Icon Button ───────────────────────────────────────────────────────────────

const IconButton = ({
  onClick,
  disabled,
  label,
  icon,
  text,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  icon?: ReactNode
  text?: string
}) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      whileTap={reduceMotion ? undefined : { scale: 0.86 }}
      whileHover={reduceMotion ? undefined : { scale: 1.06 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="inline-flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white backdrop-blur-md transition-colors hover:bg-white/[0.16] disabled:opacity-60 sm:size-12"
    >
      {text ? <span className="text-[11px] font-semibold tabular-nums tracking-wide">{text}</span> : icon}
    </motion.button>
  )
}

// ─── Book Cover ────────────────────────────────────────────────────────────────

const CoverArt = ({ src, title, className }: { src?: string; title: string; className: string }) => {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: 'linear-gradient(130deg,#1d2a62,#7f49e8)' }}>
      {src ? (
        <img
          src={src}
          alt={`Portada de ${title}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-700 ease-apple-out ${loaded ? 'scale-100 opacity-100' : 'scale-105 opacity-0'}`}
        />
      ) : null}
      {/* Brillo superior + sombra interior para dar volumen de "objeto" */}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-gradient-to-b from-white/10 via-transparent to-black/30" />
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
    </div>
  )
}

const BookCover = ({
  bookId,
  source,
  coverFileId,
  coverUrl,
  title,
  className,
}: {
  bookId?: string
  source: 'drive'
  coverFileId?: string
  coverUrl?: string
  title: string
  className: string
}) => {
  const resolvedCover = useResolvedCover({ bookId, source, coverFileId, coverUrl })
  return <CoverArt src={resolvedCover} title={title} className={className} />
}
