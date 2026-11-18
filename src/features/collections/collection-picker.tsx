import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Check, Layers, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { BookCollection } from '../../domain/audiobook'
import { COLLECTION_NAME_MAX_LENGTH, findCollectionByName, normalizeCollectionName } from './collection-utils'

const SPRING = { type: 'spring', stiffness: 500, damping: 34 } as const

interface CollectionPickerProps {
  collections: BookCollection[]
  selectedIds: string[]
  /** Colecciones nuevas pendientes de crear al guardar */
  newNames: string[]
  onChangeSelected: (ids: string[]) => void
  onChangeNewNames: (names: string[]) => void
}

/**
 * Selector de colecciones del formulario de edicion: chips que se activan con un
 * toque y un chip "Nueva" que se transforma en campo de texto.
 */
export const CollectionPicker = ({ collections, selectedIds, newNames, onChangeSelected, onChangeNewNames }: CollectionPickerProps) => {
  const reduceMotion = useReducedMotion()
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = new Set(selectedIds)

  const toggle = (id: string) => {
    onChangeSelected(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])
  }

  const commitNew = () => {
    const name = normalizeCollectionName(value)
    setValue('')
    if (!name) {
      setAdding(false)
      return
    }
    // Si ya existe (o ya esta pendiente), se selecciona en lugar de duplicarla
    const existing = findCollectionByName(collections, name)
    if (existing) {
      if (!selected.has(existing.id)) onChangeSelected([...selectedIds, existing.id])
    } else if (!newNames.some((item) => normalizeCollectionName(item).toLowerCase() === name.toLowerCase())) {
      onChangeNewNames([...newNames, name])
    }
    // Mantener el campo abierto para encadenar varias
    inputRef.current?.focus()
  }

  const chipBase =
    'inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-300'

  return (
    <div className="grouped mt-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4 text-white/60" /> Colecciones
        </h3>
        <span className="text-[11px] tabular-nums text-white/40">{selectedIds.length + newNames.length} seleccionadas</span>
      </div>
      <LayoutGroup>
        <motion.div layout={!reduceMotion} className="flex flex-wrap gap-2">
          {collections.map((item) => {
            const active = selected.has(item.id)
            return (
              <motion.button
                key={item.id}
                type="button"
                layout={!reduceMotion}
                transition={SPRING}
                whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                onClick={() => toggle(item.id)}
                aria-pressed={active}
                className={`${chipBase} ${active ? 'border-transparent bg-white text-black' : 'border-white/[0.1] bg-white/[0.06] text-white/75 hover:bg-white/[0.12]'}`}
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {active && (
                    <motion.span
                      key="check"
                      initial={reduceMotion ? false : { scale: 0, opacity: 0, width: 0 }}
                      animate={{ scale: 1, opacity: 1, width: 'auto' }}
                      exit={reduceMotion ? undefined : { scale: 0, opacity: 0, width: 0 }}
                      transition={SPRING}
                      className="inline-flex"
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="truncate">{item.name}</span>
              </motion.button>
            )
          })}

          <AnimatePresence initial={false}>
            {newNames.map((name) => (
              <motion.span
                key={`new-${name}`}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.6 }}
                transition={SPRING}
                className={`${chipBase} border-transparent bg-gradient-to-r from-accent-violet to-accent-magenta pr-1.5 text-white`}
              >
                <Plus className="size-3.5" strokeWidth={3} />
                <span className="truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => onChangeNewNames(newNames.filter((item) => item !== name))}
                  className="grid size-5 place-items-center rounded-full bg-black/20 transition hover:bg-black/40"
                  aria-label={`Descartar coleccion ${name}`}
                >
                  <X className="size-3" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>

          <AnimatePresence initial={false} mode="popLayout">
            {adding ? (
              <motion.form
                key="input"
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.85 }}
                transition={SPRING}
                onSubmit={(event) => {
                  event.preventDefault()
                  commitNew()
                }}
                className="flex min-w-[200px] flex-1 items-center gap-1 rounded-full border border-white/20 bg-white/[0.09] py-0.5 pl-3 pr-0.5 ring-4 ring-accent-violet/20"
              >
                <input
                  ref={inputRef}
                  autoFocus
                  value={value}
                  maxLength={COLLECTION_NAME_MAX_LENGTH}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    // Escape cierra el campo sin cerrar la hoja entera
                    if (event.key === 'Escape') {
                      event.stopPropagation()
                      event.nativeEvent.stopImmediatePropagation()
                      setValue('')
                      setAdding(false)
                    }
                  }}
                  onBlur={() => {
                    if (!value.trim()) setAdding(false)
                  }}
                  placeholder="Nombre de la coleccion"
                  aria-label="Nombre de la nueva coleccion"
                  className="min-w-0 flex-1 bg-transparent py-1 text-xs text-white outline-none placeholder:text-white/35"
                />
                <button
                  type="submit"
                  disabled={!value.trim()}
                  className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black transition disabled:opacity-30"
                >
                  Añadir
                </button>
              </motion.form>
            ) : (
              <motion.button
                key="add"
                type="button"
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 0.85 }}
                transition={SPRING}
                whileTap={reduceMotion ? undefined : { scale: 0.92 }}
                onClick={() => setAdding(true)}
                className={`${chipBase} border-dashed border-white/25 text-white/70 hover:border-white/40 hover:text-white`}
              >
                <Plus className="size-3.5" /> Nueva coleccion
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </LayoutGroup>
      {collections.length === 0 && newNames.length === 0 && !adding && (
        <p className="mt-3 text-xs text-white/40">Crea tu primera coleccion para agrupar este libro con otros.</p>
      )}
    </div>
  )
}
