import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, GripVertical, ListPlus, LoaderCircle, MinusCircle, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { Audiobook } from '../../domain/audiobook'
import { Reveal } from '../../components/motion/reveal'
import { TiltCard } from '../../components/motion/tilt-card'
import { BookCover } from '../../components/ui/book-cover'
import { EqualizerBars } from '../../components/ui/equalizer-bars'
import { ProgressRing } from '../../components/ui/progress-ring'
import { formatDurationCompact, formatHoursRatio } from '../../lib/format'
import { useLibraryStore } from '../library/library-store'
import { useResolvedCover } from '../library/use-resolved-cover'
import { useBookProgressGetter } from '../library/use-book-progress'
import { usePlayerStore } from '../player/player-store'
import { CollectionArtwork } from './collection-artwork'
import { BookPickerSheet, CollectionNameSheet, ConfirmDeleteSheet } from './collection-sheets'
import { useCollectionStore } from './collection-store'
import { formatBookCount, resolveCollectionBooks } from './collection-utils'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const CollectionDetailPage = () => {
  const reduceMotion = useReducedMotion()
  const navigate = useNavigate()
  const location = useLocation()
  const { collectionId } = useParams()
  const collection = useCollectionStore((state) => (collectionId ? state.records[collectionId] : undefined))
  const collections = useCollectionStore((state) => state.collections)
  const bootstrapped = useCollectionStore((state) => state.bootstrapped)
  const renameCollection = useCollectionStore((state) => state.renameCollection)
  const deleteCollection = useCollectionStore((state) => state.deleteCollection)
  const removeBook = useCollectionStore((state) => state.removeBook)
  const setBookIds = useCollectionStore((state) => state.setBookIds)
  const allBooks = useLibraryStore((state) => state.books)
  const activeBookId = usePlayerStore((state) => state.activeBookId)
  const playing = usePlayerStore((state) => state.playing)
  const pending = usePlayerStore((state) => state.pending)
  const loadBook = usePlayerStore((state) => state.loadBook)
  const playPause = usePlayerStore((state) => state.playPause)
  const getProgress = useBookProgressGetter()
  const [picking, setPicking] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  // Recien creada desde la lista: abrir directamente el selector de libros
  useEffect(() => {
    const state = location.state as { openPicker?: boolean } | null
    if (!state?.openPicker) return
    setPicking(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  const booksById = useMemo(() => new Map(allBooks.map((book) => [book.id, book])), [allBooks])
  const books = useMemo(() => (collection ? resolveCollectionBooks(collection, booksById) : []), [booksById, collection])
  const firstCover = useResolvedCover({
    bookId: books[0]?.id,
    source: books[0]?.source ?? 'drive',
    coverFileId: books[0]?.coverFileId,
    coverUrl: books[0]?.coverUrl,
  })

  if (!collection || collection.deleted) {
    return (
      <section className="glass mt-10 space-y-4 rounded-[2rem] p-10 text-center text-white/60">
        <p>{bootstrapped ? 'Esta coleccion ya no existe.' : 'Cargando...'}</p>
        {bootstrapped && (
          <button type="button" onClick={() => navigate('/collections')} className="btn-secondary">
            <ChevronLeft className="size-4" /> Colecciones
          </button>
        )}
      </section>
    )
  }

  const snapshots = books.map((book) => ({ book, ...getProgress(book.id) }))
  const totalSeconds = snapshots.reduce((sum, item) => sum + item.totalSeconds, 0)
  const listenedSeconds = snapshots.reduce((sum, item) => sum + Math.min(item.listenedSeconds, item.totalSeconds), 0)
  const percent = totalSeconds > 0 ? (listenedSeconds / totalSeconds) * 100 : 0

  // "Continuar": el libro activo si es de la coleccion; si no, el ultimo escuchado sin
  // terminar; si no, el primero sin terminar en el orden de la coleccion.
  const unfinished = snapshots.filter((item) => item.percent < 99.5)
  const activeInCollection = snapshots.find((item) => item.book.id === activeBookId)
  const lastListened = [...unfinished].filter((item) => item.progress).sort((a, b) => (b.progress?.updatedAt ?? '').localeCompare(a.progress?.updatedAt ?? ''))[0]
  const target = activeInCollection ?? lastListened ?? unfinished[0] ?? snapshots[0]
  const targetIsActive = Boolean(target && target.book.id === activeBookId)
  const targetPlaying = targetIsActive && playing
  const hasStarted = snapshots.some((item) => item.progress)

  const playTarget = async () => {
    if (!target) return
    if (targetIsActive) {
      await playPause()
      return
    }
    await loadBook(target.book.id, target.progress?.trackId, true)
  }

  const openBook = (book: Audiobook) =>
    navigate(`/player/${book.id}`, { state: { from: location.pathname, fromLabel: collection.name } })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = books.map((book) => book.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    void setBookIds(collection.id, arrayMove(ids, oldIndex, newIndex))
  }

  return (
    <>
      {/* Fondo ambient con la primera portada, como en el reproductor pero mas sutil */}
      {createPortal(
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <AnimatePresence>
            <motion.div
              key={firstCover ?? 'fallback'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2 }}
              className="absolute inset-0 scale-150"
            >
              {firstCover ? (
                <img src={firstCover} alt="" className="h-full w-full object-cover opacity-50 blur-[80px] saturate-[1.6]" />
              ) : (
                <div className="h-full w-full bg-[linear-gradient(130deg,#1d2a62,#7f49e8,#f03daf)] opacity-40 blur-[80px]" />
              )}
            </motion.div>
          </AnimatePresence>
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/70 to-black" />
        </div>,
        document.body,
      )}

      <section className="relative mx-auto max-w-5xl space-y-10 pb-8 pt-2 sm:pt-6">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="relative z-20 flex items-center justify-between gap-2"
        >
          <button type="button" onClick={() => navigate('/collections')} className="btn-pill glass pl-2.5 text-[13px] text-white/90">
            <ChevronLeft className="size-4" /> Colecciones
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setRenaming(true)} className="btn-pill glass text-[13px] text-white/90" aria-label="Renombrar coleccion">
              <Pencil className="size-3.5" /> <span className="hidden sm:inline">Renombrar</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="btn-pill glass text-[13px] text-rose-200 hover:text-rose-100"
              aria-label="Eliminar coleccion"
            >
              <Trash2 className="size-3.5" /> <span className="hidden sm:inline">Eliminar</span>
            </button>
          </div>
        </motion.div>

        {/* Cabecera */}
        <div className="grid items-end gap-8 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-10">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.85, rotateX: 20, y: 30 }}
            animate={{ opacity: 1, scale: 1, rotateX: 0, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22, mass: 0.9 }}
            style={{ transformPerspective: 1200 }}
            className="mx-auto w-full max-w-[260px] pt-[7%]"
          >
            <TiltCard maxTilt={12} hoverScale={1.02} glareRadiusClassName="rounded-[1.75rem]">
              <CollectionArtwork
                books={books}
                name={collection.name}
                radiusClassName="rounded-[1.75rem]"
                className="shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)]"
              />
            </TiltCard>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.1 }}
            className="min-w-0 space-y-4 text-center sm:text-left"
          >
            <div className="space-y-1.5">
              <p className="text-eyebrow">Coleccion</p>
              <h1 className="text-display text-gradient break-words text-[2.4rem] leading-[1.02] sm:text-6xl">{collection.name}</h1>
              <p className="text-[15px] text-white/60">
                {formatBookCount(books.length)}
                {totalSeconds > 0 && ` · ${formatDurationCompact(totalSeconds)}`}
              </p>
            </div>
            {books.length > 0 && (
              <div className="flex justify-center sm:justify-start">
                <div className="glass inline-flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3.5">
                  <ProgressRing percent={percent} size={36} strokeWidth={3} label={`Progreso de ${collection.name}`} />
                  <span className="text-xs tabular-nums text-white/75">{formatHoursRatio(listenedSeconds, totalSeconds)}</span>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
              {target && (
                <motion.button
                  type="button"
                  onClick={() => void playTarget()}
                  disabled={pending && targetIsActive}
                  whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                  className="btn-primary min-w-0 disabled:opacity-70"
                >
                  {pending && targetIsActive ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : targetPlaying ? (
                    <Pause className="size-4" fill="currentColor" />
                  ) : (
                    <Play className="size-4" fill="currentColor" />
                  )}
                  <span className="max-w-[200px] truncate">
                    {targetPlaying ? 'Pausar' : hasStarted ? `Continuar · ${target.book.title}` : 'Empezar'}
                  </span>
                </motion.button>
              )}
              <button type="button" onClick={() => setPicking(true)} className="btn-secondary">
                <ListPlus className="size-4" /> {books.length > 0 ? 'Editar libros' : 'Añadir libros'}
              </button>
            </div>
          </motion.div>
        </div>

        {/* Libros */}
        {books.length === 0 ? (
          <Reveal>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="w-full rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-10 text-center text-[15px] text-white/55 transition hover:border-white/25 hover:bg-white/[0.05] hover:text-white/80"
            >
              Esta coleccion esta vacia. Pulsa para añadir audiolibros.
            </button>
          </Reveal>
        ) : (
          <Reveal>
            <div className="mb-4 flex items-end justify-between gap-2 px-1">
              <div>
                <p className="text-eyebrow mb-1">Orden de la coleccion</p>
                <h2 className="text-display text-2xl">Libros</h2>
              </div>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={books.map((book) => book.id)} strategy={verticalListSortingStrategy}>
                <div className="grouped">
                  {snapshots.map(({ book, percent: bookPercent, listenedSeconds: bookListened }, index) => (
                      <CollectionBookRow
                        key={book.id}
                        book={book}
                        index={index}
                        percent={bookPercent}
                        listenedSeconds={bookListened}
                        isPlaying={activeBookId === book.id && playing}
                        onOpen={() => openBook(book)}
                        onRemove={() => void removeBook(collection.id, book.id)}
                      />
                    ))}
                </div>
              </SortableContext>
            </DndContext>
          </Reveal>
        )}
      </section>

      <BookPickerSheet
        open={picking}
        onClose={() => setPicking(false)}
        books={allBooks}
        selectedIds={books.map((book) => book.id)}
        onSave={(bookIds) => {
          void setBookIds(collection.id, bookIds)
          setPicking(false)
        }}
      />
      <CollectionNameSheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Renombrar coleccion"
        submitLabel="Guardar"
        initialName={collection.name}
        editingId={collection.id}
        collections={collections}
        onSubmit={async (name) => {
          await renameCollection(collection.id, name)
          setRenaming(false)
        }}
      />
      <ConfirmDeleteSheet
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        collectionName={collection.name}
        onConfirm={() => {
          setConfirmingDelete(false)
          navigate('/collections', { replace: true })
          void deleteCollection(collection.id)
        }}
      />
    </>
  )
}

const CollectionBookRow = ({
  book,
  index,
  percent,
  listenedSeconds,
  isPlaying,
  onOpen,
  onRemove,
}: {
  book: Audiobook
  index: number
  percent: number
  listenedSeconds: number
  isPlaying: boolean
  onOpen: () => void
  onRemove: () => void
}) => {
  const reduceMotion = useReducedMotion()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: book.id })

  return (
    <div
      ref={setNodeRef}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }}
      className={`grouped-row w-full text-left transition-colors duration-300 ${isDragging ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05] active:bg-white/[0.08]'}`}
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT, delay: Math.min(index, 8) * 0.03 }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-white/35">
        {isPlaying ? <EqualizerBars active className="text-accent-cyan" /> : index + 1}
      </span>
      <BookCover
        bookId={book.id}
        source={book.source}
        coverFileId={book.coverFileId}
        coverUrl={book.coverUrl}
        title={book.title}
        className="size-14 shrink-0 rounded-xl shadow-[0_8px_16px_-6px_rgba(0,0,0,0.8)]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium tracking-tight">{book.title}</p>
        <p className="truncate text-xs text-white/45">
          {book.author} · <span className="tabular-nums">{formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}</span>
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#a99bff] via-[#f48fd4] to-[#7cd3ff] transition-[width] duration-700"
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        className="rounded-full p-2 text-white/35 transition hover:bg-white/10 hover:text-rose-200 sm:p-1.5"
        aria-label={`Quitar ${book.title} de la coleccion`}
        title="Quitar de la coleccion"
      >
        <MinusCircle className="size-4" />
      </button>
      </motion.div>
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
