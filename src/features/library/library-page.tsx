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
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
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
import { ProgressRing } from '../../components/ui/progress-ring'
import { UserAvatar } from '../../components/ui/user-avatar'
import { calculateListenedSeconds } from '../../lib/book-progress'
import { hasFirebaseAuthConfig } from '../../lib/env'
import { calculateBookProgressPercent } from '../../lib/book-progress'
import { formatDurationCompact, formatHoursRatio, formatSeconds } from '../../lib/format'
import { useAuthStore } from '../auth/auth-store'
import { usePlayerStore } from '../player/player-store'
import { useLibraryStore } from './library-store'
import { useResolvedCover } from './use-resolved-cover'

// Animation variants — stagger al montar (secciones visibles sin scroll)
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 280, damping: 28 },
  },
}

// whileInView variant — solo opacity para no desplazar el layout al hacer scroll
const cardInViewVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: 'easeOut' as const } },
}

export const LibraryPage = () => {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'grid' | 'list'>('cards')
  const [expandedDescriptions, setExpandedDescriptions] = useState<Record<string, boolean>>({})
  // ref para detectar cuándo la sección "Continuar escuchando" sale del viewport
  const continueRef = useRef<HTMLElement>(null)
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
    <section className="space-y-7 pb-4">
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
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">EchoShelf</h1>
          <p className="text-sm text-slate-400">Tu biblioteca de audiolibros</p>
        </div>
        {session.connected && (session.displayName || session.email) ? (
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs text-slate-200">
            <UserAvatar
              photoUrl={session.photoUrl}
              name={session.displayName}
              email={session.email}
              sizeClassName="size-6"
              textClassName="text-[10px] font-semibold"
              fallbackClassName="bg-white/20"
            />
            <span className="max-w-[140px] truncate">{session.displayName ?? session.email}</span>
          </div>
        ) : session.reconnectRequired ? (
          <button
            type="button"
            onClick={() => {
              void session.reconnect()
            }}
            className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/15 px-3 py-2 text-xs font-medium text-amber-100"
          >
            <CloudOff className="size-3.5" /> Reconectar Google
          </button>
        ) : null}
      </header>

      {/* Search */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-glow backdrop-blur-xl">
        <div className="flex items-center gap-3 rounded-xl bg-bg-900/80 px-3 py-2">
          <Search className="size-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Busca por titulo, autor o narrador"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Warnings */}
      {!hasFirebaseAuthConfig && (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-200">
          Falta configuracion de Firebase Auth. Configura Drive desde Ajustes para sincronizar tu biblioteca.
        </div>
      )}

      {!library.driveRootId && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-slate-300">No hay carpeta de Google Drive configurada. Ve a Ajustes para conectarla y sincronizar tu biblioteca.</p>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm"
          >
            <FolderSearch className="size-4" /> Configurar en Ajustes
          </button>
        </div>
      )}

      {/* Skeleton */}
      {showSkeleton && (
        <article className="grid gap-5 rounded-3xl border border-white/15 bg-white/6 p-5 shadow-glow sm:grid-cols-[240px_1fr]">
          <div className="aspect-square animate-pulse rounded-2xl bg-white/10" />
          <div className="space-y-3">
            <div className="h-8 w-64 animate-pulse rounded bg-white/10" />
            <div className="h-4 w-72 animate-pulse rounded bg-white/10" />
            <div className="h-4 w-80 animate-pulse rounded bg-white/10" />
          </div>
        </article>
      )}

      {!showSkeleton && books.length === 0 && (
        <div className="rounded-3xl border border-dashed border-white/20 bg-white/4 p-8 text-center text-slate-300">
          No hay audiolibros en la biblioteca. Conecta Drive y sincroniza tu carpeta desde Ajustes.
        </div>
      )}

      {/* Continuar escuchando */}
      {continueListening.length > 0 && (
        <section ref={continueRef} className="space-y-3">
          <h3 className="text-lg font-semibold">Continuar escuchando</h3>
          <motion.div
            className="grid gap-3"
            variants={reduceMotion ? undefined : containerVariants}
            initial="hidden"
            animate="visible"
          >
            {continueListening.map(({ book, progress }) => (
              <motion.article
                key={book.id}
                variants={reduceMotion ? undefined : itemVariants}
                className="rounded-2xl border border-white/10 bg-white/6 p-4 text-left transition hover:border-white/25"
              >
                {(() => {
                  const isActive = activeBookId === book.id
                  const positionSeconds = isActive ? position : (progress?.positionSeconds ?? 0)
                  const totalSeconds = Math.max(1, isActive && duration > 0 ? duration : book.totalDurationSeconds)
                  const disabled = pending && isActive

                  return (
                    <div
                      className="w-full text-left"
                      onClick={() => navigate(`/player/${book.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => event.key === 'Enter' && navigate(`/player/${book.id}`)}
                    >
                      {/* Header: portada + título + autor */}
                      <div className="flex items-center gap-3">
                        <BookCover
                          bookId={book.id}
                          source={library.source}
                          coverFileId={book.coverFileId}
                          coverUrl={book.coverUrl}
                          title={book.title}
                          className="size-14 shrink-0 rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{book.title}</p>
                          <p className="truncate text-xs text-slate-400">{book.author}</p>
                          {/* Progreso cae debajo en mobile */}
                          <div className="mt-1.5 flex items-center gap-2">
                            <ProgressRing percent={getBookPercent(book.id)} size={28} strokeWidth={3} label={`Porcentaje leido de ${book.title}`} />
                            <span className="text-[10px] text-slate-400">
                              {formatHoursRatio(getBookListenedSeconds(book.id), book.totalDurationSeconds)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Barra de progreso custom con parte completada pintada */}
                      <div className="mt-3 space-y-1">
                        <div
                          className="relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/15"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Track completado */}
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan"
                            style={{ width: `${Math.min(100, (positionSeconds / totalSeconds) * 100)}%` }}
                          />
                          {/* Input range encima para interactividad */}
                          <input
                            type="range"
                            min={0}
                            max={totalSeconds}
                            step={1}
                            value={Math.min(positionSeconds, totalSeconds)}
                            onChange={(event) => void handleContinueSeek(book.id, progress?.trackId, Number(event.target.value))}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label={`Progreso de ${book.title}`}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>{formatSeconds(positionSeconds)}</span>
                          <span>{formatSeconds(totalSeconds)}</span>
                        </div>
                      </div>

                      {/* Controles — stopPropagation para no navegar al player */}
                      <div
                        className="mt-3 flex w-full items-center justify-center gap-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconButton
                          onClick={() => void handleContinueSkip(book.id, progress?.trackId, -15)}
                          disabled={disabled}
                          label="Retroceder 15 segundos"
                          text="-15s"
                        />
                        <IconButton
                          onClick={() => void handleContinuePrev(book.id, progress?.trackId)}
                          disabled={disabled}
                          label="Pista anterior"
                          icon={<SkipBack className="size-4" />}
                        />
                        <PlayButton
                          onClick={() => void handleContinuePlay(book.id, progress?.trackId)}
                          disabled={disabled}
                          isActive={isActive}
                          playing={playing}
                        />
                        <IconButton
                          onClick={() => void handleContinueNext(book.id, progress?.trackId)}
                          disabled={disabled}
                          label="Pista siguiente"
                          icon={<SkipForward className="size-4" />}
                        />
                        <IconButton
                          onClick={() => void handleContinueSkip(book.id, progress?.trackId, 15)}
                          disabled={disabled}
                          label="Avanzar 15 segundos"
                          text="+15s"
                        />
                      </div>
                    </div>
                  )
                })()}
              </motion.article>
            ))}
          </motion.div>
        </section>
      )}

      {/* Tu biblioteca */}
      {books.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Tu biblioteca</h3>
            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1 text-xs text-slate-300">
              <button
                type="button"
                onClick={() => handleViewChange('cards')}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${viewMode === 'cards' ? 'bg-white/15 text-white' : 'hover:text-white'}`}
              >
                <LayoutList className="size-3.5" /> Cards
              </button>
              <button
                type="button"
                onClick={() => handleViewChange('grid')}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${viewMode === 'grid' ? 'bg-white/15 text-white' : 'hover:text-white'}`}
              >
                <LayoutGrid className="size-3.5" /> Grid
              </button>
              <button
                type="button"
                onClick={() => handleViewChange('list')}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${viewMode === 'list' ? 'bg-white/15 text-white' : 'hover:text-white'}`}
              >
                <Rows className="size-3.5" /> Lista
              </button>
            </div>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={books.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              {viewMode === 'cards' && (
                <div className="space-y-4">
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
                      reduceMotion={reduceMotion ?? false}
                    />
                  ))}
                </div>
              )}
              {viewMode === 'grid' && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {books.map((book) => (
                    <GridBookCard
                      key={book.id}
                      book={book}
                      percent={getBookPercent(book.id)}
                      listenedSeconds={getBookListenedSeconds(book.id)}
                      source={library.source}
                      onNavigate={() => navigate(`/player/${book.id}`)}
                    />
                  ))}
                </div>
              )}
              {viewMode === 'list' && (
                <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
                  {books.map((book) => (
                <SimpleBookRow
                  key={book.id}
                  book={book}
                  percent={getBookPercent(book.id)}
                  source={library.source}
                  onNavigate={() => navigate(`/player/${book.id}`)}
                />
                  ))}
                </div>
              )}
            </SortableContext>
          </DndContext>
        </section>
      )}

      {/* Footer */}
      <footer className="flex flex-wrap items-center gap-3 pt-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2">
          {navigator.onLine ? <Cloud className="size-4" /> : <CloudOff className="size-4" />}
          {navigator.onLine ? 'Con conexion' : 'Sin conexion'}
        </span>
        {library.loading && <span>Sincronizando biblioteca...</span>}
        {library.error && <span className="text-rose-300">{library.error}</span>}
      </footer>
    </section>
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
  reduceMotion,
}: {
  book: Audiobook
  percent: number
  listenedSeconds: number
  source: 'drive'
  expandedDescription: boolean
  onToggleDescription: () => void
  onNavigate: () => void
  reduceMotion: boolean
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  return (
    <motion.article
      ref={setNodeRef}
      variants={reduceMotion ? undefined : cardInViewVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px' }}
      className={`grid gap-5 rounded-3xl border bg-white/6 p-5 shadow-glow transition sm:grid-cols-[240px_1fr] ${isDragging ? 'border-white/40 shadow-[0_0_0_2px_rgba(123,99,255,0.5)]' : 'border-white/15 hover:border-white/30'}`}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : 1,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
    >
      <BookCover
        bookId={book.id}
        source={source}
        coverFileId={book.coverFileId}
        coverUrl={book.coverUrl}
        title={book.title}
        className="aspect-square rounded-2xl shadow-[0_18px_38px_rgba(0,0,0,0.45)]"
      />
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h4 className="text-2xl font-semibold leading-tight">{book.title}</h4>
            <div className="flex items-center gap-2 sm:hidden">
              <ProgressRing percent={percent} size={36} label={`Porcentaje leido de ${book.title}`} />
              <span className="rounded-full border border-white/15 bg-white/6 px-2.5 py-1 text-xs text-slate-200">
                {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
              </span>
              {/* Handle de drag — stop propagation para no navegar */}
              <button
                type="button"
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
                className="touch-none rounded-lg p-1.5 text-slate-500 hover:text-slate-300 active:text-white"
                aria-label="Reordenar"
              >
                <GripVertical className="size-5" />
              </button>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <ProgressRing percent={percent} size={52} label={`Porcentaje leido de ${book.title}`} />
            <span className="rounded-full border border-white/15 bg-white/6 px-2.5 py-1.5 text-xs text-slate-200">
              {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
            </span>
            {/* Handle de drag — stop propagation para no navegar */}
            <button
              type="button"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              className="touch-none rounded-lg p-1.5 text-slate-500 hover:text-slate-300 active:text-white"
              aria-label="Reordenar"
            >
              <GripVertical className="size-5" />
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-300">{book.author} · Narrado por {book.narrator}</p>
        <div onClick={(e) => e.stopPropagation()}>
          <DescriptionBlock
            description={book.description}
            expanded={expandedDescription}
            onToggle={onToggleDescription}
          />
        </div>
        <div className="flex flex-wrap gap-3 pt-1" onClick={(e) => e.stopPropagation()}>
          <span className="rounded-xl border border-white/15 px-3 py-2 text-xs text-slate-300">
            {formatDurationCompact(book.totalDurationSeconds)}
          </span>
        </div>
      </div>
    </motion.article>
  )
}

// ─── Grid Book Card ───────────────────────────────────────────────────────────

const GridBookCard = ({
  book,
  percent,
  listenedSeconds,
  source,
  onNavigate,
}: {
  book: Audiobook
  percent: number
  listenedSeconds: number
  source: 'drive'
  onNavigate: () => void
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  return (
    <motion.article
      ref={setNodeRef}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className={`group rounded-3xl border bg-white/6 p-4 shadow-glow transition ${isDragging ? 'border-white/40 shadow-[0_0_0_2px_rgba(123,99,255,0.5)]' : 'border-white/10 hover:border-white/25'}`}
      onClick={onNavigate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : 1,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
    >
      <div className="relative overflow-hidden rounded-2xl">
        <BookCover
          bookId={book.id}
          source={source}
          coverFileId={book.coverFileId}
          coverUrl={book.coverUrl}
          title={book.title}
          className="aspect-[1/1] w-full"
        />
        <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-bg-900/70 px-2 py-1 text-[10px] text-slate-200">
          {formatDurationCompact(book.totalDurationSeconds)}
        </div>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
          className="absolute right-3 top-3 touch-none rounded-full border border-white/15 bg-bg-900/70 p-1 text-slate-200"
          aria-label="Reordenar"
        >
          <GripVertical className="size-4" />
        </button>
      </div>
      <div className="mt-3 space-y-1">
        <p className="truncate text-sm font-semibold">{book.title}</p>
        <p className="truncate text-xs text-slate-400">{book.author}</p>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ProgressRing percent={percent} size={30} strokeWidth={3} label={`Porcentaje leido de ${book.title}`} />
          <span className="text-[10px] text-slate-400">
            {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
          {book.trackCount} pistas
        </span>
      </div>
    </motion.article>
  )
}

// ─── Simple List Row ──────────────────────────────────────────────────────────

const SimpleBookRow = ({
  book,
  percent,
  source,
  onNavigate,
}: {
  book: Audiobook
  percent: number
  source: 'drive'
  onNavigate: () => void
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  return (
    <div
      ref={setNodeRef}
      onClick={onNavigate}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${isDragging ? 'bg-white/12' : 'hover:bg-white/6'}`}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onNavigate()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : 1,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
    >
      <BookCover
        bookId={book.id}
        source={source}
        coverFileId={book.coverFileId}
        coverUrl={book.coverUrl}
        title={book.title}
        className="size-12 shrink-0 rounded-xl"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{book.title}</p>
        <p className="truncate text-xs text-slate-400">{book.author} · {book.narrator}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan" style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
      </div>
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
        className="ml-1 touch-none rounded p-1 text-slate-500 hover:text-slate-300 active:text-white"
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
      initial={reduceMotion ? false : { opacity: 0, y: -48 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -48 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="fixed left-0 right-0 top-0 z-40 mx-auto max-w-[1440px] px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:px-6 lg:px-10"
    >
      <div
        className="relative overflow-hidden rounded-2xl border border-white/15 bg-bg-900/90 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        onClick={onNavigate}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onNavigate()}
        aria-label={`Abrir reproductor de ${book.title}`}
      >
        {/* barra de progreso en el fondo */}
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-accent-violet to-accent-cyan transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
        <div className="flex items-center gap-3 px-3 py-2.5">
          <BookCover
            bookId={book.id}
            source={source}
            coverFileId={book.coverFileId}
            coverUrl={book.coverUrl}
            title={book.title}
            className="size-10 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{book.title}</p>
            <p className="truncate text-[10px] text-slate-400">{book.author}</p>
          </div>
          <ProgressRing percent={percent} size={30} strokeWidth={3} label={`Progreso ${book.title}`} />
          <motion.button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPlay() }}
            disabled={disabled}
            whileTap={reduceMotion ? undefined : { scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            aria-label={isActive && playing ? 'Pausar' : 'Reproducir'}
            className="ml-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-bg-950 shadow-[0_0_12px_rgba(255,255,255,0.25)] disabled:opacity-60"
          >
            {disabled ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : isActive && playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
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
      whileTap={reduceMotion ? undefined : { scale: 0.9 }}
      whileHover={reduceMotion ? undefined : { scale: 1.06 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      aria-label={isActive && playing ? 'Pausar' : 'Reproducir'}
      className="inline-flex size-14 items-center justify-center rounded-full bg-white text-bg-950 shadow-[0_0_18px_rgba(255,255,255,0.35)] disabled:opacity-70"
    >
      {disabled ? (
        <LoaderCircle className="size-6 animate-spin" />
      ) : isActive && playing ? (
        <Pause className="size-6" />
      ) : (
        <Play className="size-6" />
      )}
    </motion.button>
  )
}

// ─── Description with animated height ─────────────────────────────────────────

const DescriptionBlock = ({ description, expanded, onToggle }: { description?: string; expanded: boolean; onToggle: () => void }) => {
  const reduceMotion = useReducedMotion()

  if (!description?.trim()) {
    return <p className="text-sm text-slate-500">Sin descripcion disponible.</p>
  }

  const canExpand = description.length > 180

  return (
    <div>
      <div className={`overflow-hidden text-sm text-slate-400 ${!expanded && canExpand ? 'line-clamp-3' : ''}`}>
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.p
              key="expanded"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              {description}
            </motion.p>
          ) : (
            <p className="line-clamp-3">{description}</p>
          )}
        </AnimatePresence>
      </div>
      {canExpand && (
        <button type="button" onClick={onToggle} className="mt-1 text-xs font-medium text-cyan-300 hover:text-cyan-200">
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
      whileTap={reduceMotion ? undefined : { scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="inline-flex size-12 items-center justify-center rounded-full border border-white/25 bg-white/8 text-white transition hover:border-white/40 hover:bg-white/12 disabled:opacity-70"
    >
      {text ? <span className="text-[11px] font-semibold tracking-wide">{text}</span> : icon}
    </motion.button>
  )
}

// ─── Book Cover ────────────────────────────────────────────────────────────────

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

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: 'linear-gradient(130deg,#1d2a62,#7f49e8)' }}>
      {resolvedCover ? (
        <img
          src={resolvedCover}
          alt={`Portada de ${title}`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
    </div>
  )
}
