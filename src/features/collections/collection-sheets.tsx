import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { Audiobook, BookCollection } from '../../domain/audiobook'
import { BookCover } from '../../components/ui/book-cover'
import { Sheet } from '../../components/ui/sheet'
import { COLLECTION_NAME_MAX_LENGTH, findCollectionByName, normalizeCollectionName } from './collection-utils'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

// ─── Crear / renombrar ────────────────────────────────────────────────────────

export const CollectionNameSheet = ({
  open,
  onClose,
  title,
  submitLabel,
  initialName = '',
  collections,
  editingId,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initialName?: string
  collections: BookCollection[]
  /** Coleccion que se esta renombrando (para no chocar consigo misma) */
  editingId?: string
  onSubmit: (name: string) => Promise<void> | void
}) => {
  const formId = useId()
  const [name, setName] = useState(initialName)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setName(initialName)
  }, [initialName, open])

  const normalized = normalizeCollectionName(name)
  const duplicate = findCollectionByName(collections, normalized)
  const duplicateError = duplicate && duplicate.id !== editingId ? 'Ya tienes una coleccion con ese nombre.' : undefined
  const canSubmit = Boolean(normalized) && !duplicateError && !submitting && normalized !== normalizeCollectionName(initialName)

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit(normalized)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" form={formId} disabled={!canSubmit} className="btn-primary disabled:opacity-40">
            {submitLabel}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="space-y-2"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={COLLECTION_NAME_MAX_LENGTH}
          autoFocus
          className="field"
          placeholder="Nombre de la coleccion"
          aria-label="Nombre de la coleccion"
          aria-invalid={Boolean(duplicateError)}
        />
        <AnimatePresence initial={false}>
          {duplicateError && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-1 text-xs text-rose-300"
            >
              {duplicateError}
            </motion.p>
          )}
        </AnimatePresence>
      </form>
    </Sheet>
  )
}

// ─── Confirmar borrado ────────────────────────────────────────────────────────

export const ConfirmDeleteSheet = ({
  open,
  onClose,
  collectionName,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  collectionName: string
  onConfirm: () => void
}) => (
  <Sheet
    open={open}
    onClose={onClose}
    title="Eliminar coleccion"
    footer={
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancelar
        </button>
        <button type="button" onClick={onConfirm} className="btn-pill bg-rose-500 text-white hover:bg-rose-400">
          Eliminar
        </button>
      </div>
    }
  >
    <p className="text-[15px] leading-relaxed text-white/65">
      Se eliminara <span className="font-semibold text-white">{collectionName}</span>. Los audiolibros seguiran en tu biblioteca.
    </p>
  </Sheet>
)

// ─── Selector de libros ───────────────────────────────────────────────────────

export const BookPickerSheet = ({
  open,
  onClose,
  books,
  selectedIds,
  onSave,
}: {
  open: boolean
  onClose: () => void
  books: Audiobook[]
  selectedIds: string[]
  onSave: (bookIds: string[]) => void
}) => {
  const reduceMotion = useReducedMotion()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Set<string>>(new Set(selectedIds))

  useEffect(() => {
    if (!open) return
    setDraft(new Set(selectedIds))
    setSearch('')
    // Solo al abrir: no pisar la seleccion en curso si la coleccion cambia en remoto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return books
    return books.filter((book) => [book.title, book.author, book.narrator].join(' ').toLowerCase().includes(query))
  }, [books, search])

  const toggle = (bookId: string) => {
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(bookId)) next.delete(bookId)
      else next.add(bookId)
      return next
    })
  }

  const changed = draft.size !== selectedIds.length || selectedIds.some((id) => !draft.has(id))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Libros de la coleccion"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-white/45">
            {draft.size} {draft.size === 1 ? 'seleccionado' : 'seleccionados'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!changed}
              onClick={() => {
                // Conserva el orden actual y añade los nuevos al final, en el orden de la biblioteca
                const kept = selectedIds.filter((id) => draft.has(id))
                const added = books.map((book) => book.id).filter((id) => draft.has(id) && !selectedIds.includes(id))
                onSave([...kept, ...added])
              }}
              className="btn-primary disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="glass group sticky top-0 z-10 flex items-center gap-3 rounded-full px-4 py-2.5 transition duration-300 focus-within:border-white/20 focus-within:ring-4 focus-within:ring-accent-violet/20">
          <Search className="size-4 text-white/40 transition group-focus-within:text-white/80" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar en tu biblioteca"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          />
        </label>
        {books.length === 0 && <p className="py-6 text-center text-sm text-white/45">Tu biblioteca esta vacia.</p>}
        {books.length > 0 && filtered.length === 0 && <p className="py-6 text-center text-sm text-white/45">Sin resultados.</p>}
        {filtered.length > 0 && (
          <div className="grouped">
            {filtered.map((book, index) => {
              const selected = draft.has(book.id)
              return (
                <motion.button
                  key={book.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggle(book.id)}
                  initial={reduceMotion ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT, delay: Math.min(index, 10) * 0.025 }}
                  className={`grouped-row w-full text-left transition-colors duration-300 ${selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]'}`}
                >
                  <BookCover
                    bookId={book.id}
                    source={book.source}
                    coverFileId={book.coverFileId}
                    coverUrl={book.coverUrl}
                    title={book.title}
                    className="size-11 shrink-0 rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{book.title}</span>
                    <span className="block truncate text-xs text-white/45">{book.author}</span>
                  </span>
                  <SelectionCheck selected={selected} />
                </motion.button>
              )
            })}
          </div>
        )}
      </div>
    </Sheet>
  )
}

export const SelectionCheck = ({ selected }: { selected: boolean }) => {
  const reduceMotion = useReducedMotion()
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${selected ? 'border-transparent bg-accent-violet' : 'border-white/25'}`}
    >
      <AnimatePresence initial={false}>
        {selected && (
          <motion.span
            initial={reduceMotion ? false : { scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduceMotion ? undefined : { scale: 0.3, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 24 }}
            className="inline-flex"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
