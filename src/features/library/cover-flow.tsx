import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Audiobook } from '../../domain/audiobook'
import { BookCover } from '../../components/ui/book-cover'
import { EqualizerBars } from '../../components/ui/equalizer-bars'
import { ProgressRing } from '../../components/ui/progress-ring'
import { formatDurationCompact, formatHoursRatio } from '../../lib/format'
import { usePlayerStore } from '../player/player-store'
import { useBookProgressGetter } from './use-book-progress'
import { useResolvedCover } from './use-resolved-cover'

const EASE_OUT = [0.16, 1, 0.3, 1] as const
const SNAP_SPRING = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 } as const
/** Portadas montadas a cada lado de la activa */
const VISIBLE_RADIUS = 6
/** Desplazamiento minimo (px) para considerar el gesto un arrastre y no un toque */
const DRAG_THRESHOLD = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface CoverFlowProps {
  books: Audiobook[]
  /** Libro en el que arranca el carrusel (p. ej. el que esta sonando) */
  initialBookId?: string
  onOpen: (book: Audiobook) => void
}

/**
 * Vista "cover flow": carrusel 3D de portadas con arrastre, rueda horizontal,
 * flechas de teclado y snapping con muelle. La posicion es un MotionValue continuo,
 * asi que cada portada calcula su transformacion sin re-renderizar React.
 */
export const CoverFlow = ({ books, initialBookId, onOpen }: CoverFlowProps) => {
  const reduceMotion = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const initialIndex = Math.max(0, books.findIndex((book) => book.id === initialBookId))
  const scroll = useMotionValue(initialIndex)
  const coverSize = useMotionValue(240)
  const [size, setSize] = useState(240)
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean; samples: { x: number; t: number }[] } | null>(null)
  const suppressClickRef = useRef(false)
  const lastIndex = Math.max(0, books.length - 1)

  // Tamaño de portada proporcional al ancho disponible
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => {
      const next = Math.round(clamp(stage.clientWidth * 0.42, 170, 300))
      setSize(next)
      coverSize.set(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [coverSize])

  useMotionValueEvent(scroll, 'change', (value) => {
    const next = clamp(Math.round(value), 0, lastIndex)
    setActiveIndex((current) => (current === next ? current : next))
  })

  const goTo = useCallback(
    (index: number) => {
      animationRef.current?.stop()
      const target = clamp(index, 0, lastIndex)
      if (reduceMotion) {
        scroll.set(target)
        return
      }
      animationRef.current = animate(scroll, target, SNAP_SPRING)
    },
    [lastIndex, reduceMotion, scroll],
  )

  // Si cambia la lista (filtro/busqueda) se mantiene el libro activo si sigue presente
  const activeBookIdRef = useRef(books[activeIndex]?.id)
  activeBookIdRef.current = books[activeIndex]?.id ?? activeBookIdRef.current
  const booksKey = books.map((book) => book.id).join('|')
  useEffect(() => {
    const index = books.findIndex((book) => book.id === activeBookIdRef.current)
    animationRef.current?.stop()
    scroll.set(index >= 0 ? index : 0)
    setActiveIndex(index >= 0 ? index : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booksKey])

  // Rueda / trackpad horizontal (listener nativo para poder hacer preventDefault)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let snapTimer: number | undefined
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      animationRef.current?.stop()
      scroll.set(clamp(scroll.get() + event.deltaX / (coverSize.get() * 0.9), -0.3, lastIndex + 0.3))
      window.clearTimeout(snapTimer)
      snapTimer = window.setTimeout(() => goTo(Math.round(scroll.get())), 110)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', onWheel)
      window.clearTimeout(snapTimer)
    }
  }, [coverSize, goTo, lastIndex, scroll])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    animationRef.current?.stop()
    suppressClickRef.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: scroll.get(),
      moved: false,
      samples: [{ x: event.clientX, t: performance.now() }],
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      drag.moved = true
      // Solo capturamos al confirmar el arrastre: asi un toque sigue llegando a la portada
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const step = coverSize.get() * 0.62
    const raw = drag.startScroll - dx / step
    // Resistencia elastica en los extremos
    const rubber = raw < 0 ? raw * 0.35 : raw > lastIndex ? lastIndex + (raw - lastIndex) * 0.35 : raw
    scroll.set(rubber)
    drag.samples.push({ x: event.clientX, t: performance.now() })
    if (drag.samples.length > 5) drag.samples.shift()
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.moved) return
    suppressClickRef.current = true
    const first = drag.samples[0]
    const last = drag.samples[drag.samples.length - 1]
    const elapsed = Math.max(1, last.t - first.t)
    const velocity = (last.x - first.x) / elapsed // px/ms
    const step = coverSize.get() * 0.62
    // Proyeccion por inercia: un "flick" rapido avanza varias portadas
    const inertia = clamp((-velocity * 160) / step, -4, 4)
    goTo(Math.round(scroll.get() + inertia))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      goTo(activeIndex + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goTo(activeIndex - 1)
    } else if (event.key === 'Enter' && books[activeIndex]) {
      onOpen(books[activeIndex])
    }
  }

  const handleCoverClick = (index: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (index === activeIndex) onOpen(books[index])
    else goTo(index)
  }

  const activeBook = books[activeIndex]
  const stageHeight = Math.round(size * 1.32)

  return (
    <div className="space-y-6">
      <div className="relative -mx-5 overflow-x-clip sm:-mx-8 lg:-mx-12">
        <AmbientGlow book={activeBook} size={size} />
        <div
          ref={stageRef}
          role="listbox"
          aria-label="Carrusel de portadas"
          aria-activedescendant={activeBook ? `coverflow-${activeBook.id}` : undefined}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative cursor-grab select-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent-violet/50"
          style={{
            height: stageHeight,
            perspective: size * 4,
            touchAction: 'pan-y',
            maskImage: 'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)',
          }}
        >
          <div className="absolute inset-x-0 top-6 h-full" style={{ transformStyle: 'preserve-3d' }}>
            {books.map((book, index) =>
              Math.abs(index - activeIndex) <= VISIBLE_RADIUS ? (
                <CoverFlowItem
                  key={book.id}
                  book={book}
                  index={index}
                  scroll={scroll}
                  coverSize={coverSize}
                  size={size}
                  active={index === activeIndex}
                  onClick={() => handleCoverClick(index)}
                />
              ) : null,
            )}
          </div>
        </div>
      </div>

      {activeBook && (
        <CoverFlowDetails
          book={activeBook}
          index={activeIndex}
          total={books.length}
          onPrev={() => goTo(activeIndex - 1)}
          onNext={() => goTo(activeIndex + 1)}
          onOpen={() => onOpen(activeBook)}
        />
      )}
    </div>
  )
}

// ─── Portada individual ───────────────────────────────────────────────────────

const CoverFlowItem = ({
  book,
  index,
  scroll,
  coverSize,
  size,
  active,
  onClick,
}: {
  book: Audiobook
  index: number
  scroll: MotionValue<number>
  coverSize: MotionValue<number>
  size: number
  active: boolean
  onClick: () => void
}) => {
  // Desplazamiento continuo respecto al centro: 0 = activa, ±1 = vecinas…
  const offset = useTransform(scroll, (value) => index - value)
  const x = useTransform([offset, coverSize], ([o, s]: number[]) => {
    const distance = Math.abs(o)
    return Math.sign(o) * (Math.min(distance, 1) * s * 0.66 + Math.max(distance - 1, 0) * s * 0.27)
  })
  const z = useTransform([offset, coverSize], ([o, s]: number[]) => {
    const distance = Math.abs(o)
    return -Math.min(distance, 1) * s * 0.55 - Math.max(distance - 1, 0) * s * 0.08
  })
  const rotateY = useTransform(offset, (o) => -clamp(o, -1, 1) * 60)
  const zIndex = useTransform(offset, (o) => 1000 - Math.round(Math.abs(o) * 10))
  const opacity = useTransform(offset, (o) => clamp(VISIBLE_RADIUS - Math.abs(o), 0, 1))
  const shade = useTransform(offset, (o) => Math.min(Math.abs(o), 1.6) * 0.32)

  return (
    <motion.div
      id={`coverflow-${book.id}`}
      role="option"
      aria-selected={active}
      aria-label={book.title}
      onClick={onClick}
      className="absolute left-1/2 top-0 cursor-pointer"
      style={{ width: size, marginLeft: -size / 2, x, z, rotateY, zIndex, opacity, transformStyle: 'preserve-3d' }}
    >
      <div
        className="relative"
        style={{ WebkitBoxReflect: 'below 3px linear-gradient(transparent 62%, rgba(255,255,255,0.22))' } as CSSProperties}
      >
        <BookCover
          bookId={book.id}
          source={book.source}
          coverFileId={book.coverFileId}
          coverUrl={book.coverUrl}
          title={book.title}
          className={`aspect-square w-full rounded-[1.25rem] transition-shadow duration-500 ${active ? 'shadow-[0_40px_70px_-20px_rgba(0,0,0,0.95)]' : 'shadow-[0_20px_40px_-16px_rgba(0,0,0,0.8)]'}`}
        />
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-black" style={{ opacity: shade }} />
      </div>
    </motion.div>
  )
}

// ─── Brillo ambiental tras el carrusel ────────────────────────────────────────

const AmbientGlow = ({ book, size }: { book?: Audiobook; size: number }) => {
  const cover = useResolvedCover({ bookId: book?.id, source: book?.source ?? 'drive', coverFileId: book?.coverFileId, coverUrl: book?.coverUrl })
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" style={{ height: size * 1.4 }}>
      <AnimatePresence>
        <motion.div
          key={cover ?? book?.id ?? 'none'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9 }}
          className="absolute top-[10%]"
          style={{ width: size * 1.6, height: size * 1.1 }}
        >
          {cover ? (
            <img src={cover} alt="" className="h-full w-full rounded-full object-cover opacity-45 blur-[70px] saturate-[1.8]" />
          ) : (
            <div className="h-full w-full rounded-full bg-[linear-gradient(130deg,#1d2a62,#7f49e8,#f03daf)] opacity-35 blur-[70px]" />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ─── Ficha del libro activo ───────────────────────────────────────────────────

/** Misma informacion que la vista Cards, centrada bajo el carrusel. */
const CoverFlowDetails = ({
  book,
  index,
  total,
  onPrev,
  onNext,
  onOpen,
}: {
  book: Audiobook
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onOpen: () => void
}) => {
  const reduceMotion = useReducedMotion()
  const getProgress = useBookProgressGetter()
  const activeBookId = usePlayerStore((state) => state.activeBookId)
  const playing = usePlayerStore((state) => state.playing)
  const { percent, listenedSeconds } = getProgress(book.id)
  const isPlaying = activeBookId === book.id && playing

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={book.id}
          initial={reduceMotion ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -6, filter: 'blur(6px)', transition: { duration: 0.15 } }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="flex w-full max-w-xl flex-col items-center gap-3 px-2"
        >
          <button type="button" onClick={onOpen} className="space-y-1.5">
            {isPlaying && (
              <p className="text-eyebrow inline-flex items-center gap-2 text-accent-cyan">
                <EqualizerBars active /> Reproduciendo
              </p>
            )}
            <h4 className="text-display line-clamp-2 text-2xl leading-tight sm:text-[1.75rem]">{book.title}</h4>
            <p className="text-sm text-white/55">
              {book.author} · Narrado por {book.narrator}
            </p>
          </button>
          <ExpandableDescription description={book.description} />
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <ProgressRing percent={percent} size={34} strokeWidth={3} label={`Porcentaje leido de ${book.title}`} />
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-xs text-white/65">
              {formatDurationCompact(book.totalDurationSeconds)}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-xs tabular-nums text-white/65">
              {formatHoursRatio(listenedSeconds, book.totalDurationSeconds)}
            </span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-xs tabular-nums text-white/65">
              {book.trackCount} pistas
            </span>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] p-1">
        <RoundButton onClick={onPrev} disabled={index <= 0} label="Portada anterior">
          <ChevronLeft className="size-4" />
        </RoundButton>
        <span className="min-w-[3.5rem] text-[11px] tabular-nums text-white/45">
          {index + 1} / {total}
        </span>
        <RoundButton onClick={onNext} disabled={index >= total - 1} label="Portada siguiente">
          <ChevronRight className="size-4" />
        </RoundButton>
      </div>
    </div>
  )
}

const ExpandableDescription = ({ description }: { description?: string }) => {
  const [expanded, setExpanded] = useState(false)
  if (!description?.trim()) {
    return <p className="text-sm text-white/35">Sin descripcion disponible.</p>
  }
  const canExpand = description.length > 180
  return (
    <div className="max-w-lg">
      <motion.p
        key={expanded ? 'expanded' : 'collapsed'}
        initial={{ opacity: 0.4 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className={`text-sm leading-relaxed text-white/50 ${!expanded && canExpand ? 'line-clamp-3' : ''}`}
      >
        {description}
      </motion.p>
      {canExpand && (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-1.5 text-xs font-semibold text-accent-cyan transition hover:text-white">
          {expanded ? 'Leer menos' : 'Leer mas'}
        </button>
      )}
    </div>
  )
}

const RoundButton = ({ onClick, disabled, label, children }: { onClick: () => void; disabled?: boolean; label: string; children: ReactNode }) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      whileTap={reduceMotion || disabled ? undefined : { scale: 0.86 }}
      whileHover={reduceMotion || disabled ? undefined : { scale: 1.06 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="inline-flex size-8 items-center justify-center rounded-full text-white/70 transition-[background-color,color,opacity] hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
    >
      {children}
    </motion.button>
  )
}
