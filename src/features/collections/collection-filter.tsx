import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, Layers, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Audiobook, BookCollection } from '../../domain/audiobook'
import { CollectionArtwork } from './collection-artwork'
import { formatBookCount, resolveCollectionBooks } from './collection-utils'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

interface CollectionFilterProps {
  collections: BookCollection[]
  booksById: Map<string, Audiobook>
  /** Id de la coleccion activa o `undefined` para "Todos los libros" */
  value?: string
  onChange: (collectionId: string | undefined) => void
}

/**
 * Filtro discreto por coleccion: una pildora con la mini portada y el nombre
 * que despliega un popover con todas las colecciones.
 */
export const CollectionFilter = ({ collections, booksById, value, onChange }: CollectionFilterProps) => {
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = collections.find((item) => item.id === value)
  const activeBooks = active ? resolveCollectionBooks(active, booksById) : []

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const select = (id: string | undefined) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className={`flex items-center rounded-full border backdrop-blur-xl transition-colors duration-300 ${active ? 'border-white/[0.16] bg-white/[0.1]' : 'border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.08]'}`}
      >
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={active ? `Filtrando por ${active.name}` : 'Filtrar por coleccion'}
          className="flex min-w-0 items-center gap-2 py-1 pl-1 pr-3 text-xs font-medium"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={active?.id ?? 'all'}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.6, rotate: -10 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.6, rotate: 10 }}
              transition={{ type: 'spring', stiffness: 460, damping: 28 }}
              className="block size-7 shrink-0"
            >
              {active ? (
                <CollectionArtwork books={activeBooks} name={active.name} stacked={false} radiusClassName="rounded-full" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-white/[0.1] text-white/70">
                  <Layers className="size-3.5" />
                </span>
              )}
            </motion.span>
          </AnimatePresence>
          <span className={`max-w-[130px] truncate sm:max-w-[180px] ${active ? 'text-white' : 'text-white/65'}`}>{active ? active.name : 'Colecciones'}</span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className="inline-flex text-white/45">
            <ChevronDown className="size-3.5" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {active && (
            <motion.button
              type="button"
              onClick={() => select(undefined)}
              aria-label="Quitar filtro de coleccion"
              initial={reduceMotion ? false : { width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={reduceMotion ? undefined : { width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <span className="mr-1 grid size-6 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white">
                <X className="size-3" />
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label="Colecciones"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -4 }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            style={{ transformOrigin: 'top right' }}
            className="glass-strong absolute right-0 top-full z-40 mt-2 max-h-[min(60vh,360px)] w-[min(18rem,calc(100vw-2.5rem))] overflow-y-auto rounded-[1.25rem] p-1.5"
          >
            <FilterOption selected={!active} onSelect={() => select(undefined)} label="Todos los libros" detail={formatBookCount(booksById.size)} index={0}>
              <span className="grid size-9 place-items-center rounded-lg bg-white/[0.08] text-white/70">
                <Layers className="size-4" />
              </span>
            </FilterOption>
            <div className="mx-2 my-1 h-px bg-white/[0.07]" />
            {collections.map((item, index) => {
              const items = resolveCollectionBooks(item, booksById)
              return (
                <FilterOption
                  key={item.id}
                  selected={item.id === active?.id}
                  onSelect={() => select(item.id)}
                  label={item.name}
                  detail={formatBookCount(items.length)}
                  index={index + 1}
                >
                  <CollectionArtwork books={items} name={item.name} stacked={false} radiusClassName="rounded-lg" className="size-9" />
                </FilterOption>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const FilterOption = ({
  selected,
  onSelect,
  label,
  detail,
  index,
  children,
}: {
  selected: boolean
  onSelect: () => void
  label: string
  detail: string
  index: number
  children: ReactNode
}) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      initial={reduceMotion ? false : { opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT, delay: Math.min(index, 8) * 0.025 }}
      className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors duration-200 ${selected ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'}`}
    >
      <span className="size-9 shrink-0">{children}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-white">{label}</span>
        <span className="block text-[11px] text-white/45">{detail}</span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-accent-cyan" strokeWidth={2.6} />}
    </motion.button>
  )
}
