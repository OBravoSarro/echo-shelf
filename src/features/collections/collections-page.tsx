import { motion, useReducedMotion } from 'framer-motion'
import { Layers, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Reveal } from '../../components/motion/reveal'
import { TiltCard } from '../../components/motion/tilt-card'
import { LargeTitle, SectionHeader } from '../../components/ui/large-title'
import { ProgressRing } from '../../components/ui/progress-ring'
import { formatDurationCompact } from '../../lib/format'
import { useLibraryStore } from '../library/library-store'
import { useBookProgressGetter } from '../library/use-book-progress'
import { CollectionArtwork } from './collection-artwork'
import { CollectionNameSheet } from './collection-sheets'
import { useCollectionStore } from './collection-store'
import { formatBookCount, resolveCollectionBooks } from './collection-utils'

export const CollectionsPage = () => {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const collections = useCollectionStore((state) => state.collections)
  const createCollection = useCollectionStore((state) => state.createCollection)
  const books = useLibraryStore((state) => state.books)
  const getProgress = useBookProgressGetter()
  const [creating, setCreating] = useState(false)

  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])

  const cards = useMemo(
    () =>
      collections.map((collection) => {
        const items = resolveCollectionBooks(collection, booksById)
        let listened = 0
        let total = 0
        for (const book of items) {
          const snapshot = getProgress(book.id)
          listened += Math.min(snapshot.listenedSeconds, snapshot.totalSeconds)
          total += snapshot.totalSeconds
        }
        return { collection, books: items, totalSeconds: total, percent: total > 0 ? (listened / total) * 100 : 0 }
      }),
    [booksById, collections, getProgress],
  )

  return (
    <section className="space-y-10 pb-4 sm:space-y-14">
      <LargeTitle
        eyebrow="Biblioteca"
        title="Colecciones"
        subtitle="Agrupa tus audiolibros por saga, genero o como prefieras."
        trailing={
          <button type="button" onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="size-4" /> Nueva
          </button>
        }
      />

      {cards.length === 0 ? (
        <Reveal>
          <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] px-6 py-14 text-center">
            <motion.span
              animate={reduceMotion ? undefined : { y: [0, -8, 0], rotate: [0, -4, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              className="grid size-16 place-items-center rounded-[1.25rem] bg-gradient-to-br from-accent-violet to-accent-magenta shadow-[0_20px_40px_-12px_rgba(240,61,175,0.55)]"
            >
              <Layers className="size-7" />
            </motion.span>
            <div className="space-y-1">
              <p className="text-[15px] text-white/75">Aun no tienes colecciones.</p>
              <p className="text-sm text-white/45">Crea una aqui o desde "Editar metadatos" en cualquier libro.</p>
            </div>
            <button type="button" onClick={() => setCreating(true)} className="btn-accent mt-1">
              <Plus className="size-4" /> Crear coleccion
            </button>
          </div>
        </Reveal>
      ) : (
        <section className="space-y-5">
          <Reveal>
            <SectionHeader eyebrow={`${cards.length} ${cards.length === 1 ? 'coleccion' : 'colecciones'}`} title="Tus colecciones" />
          </Reveal>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 md:grid-cols-3 xl:grid-cols-4">
            {cards.map(({ collection, books: items, totalSeconds, percent }, index) => (
              <Reveal key={collection.id} delay={(index % 4) * 0.07}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/collections/${collection.id}`)}
                  onKeyDown={(event) => event.key === 'Enter' && navigate(`/collections/${collection.id}`)}
                  className="cursor-pointer pt-[7%]"
                  aria-label={`Abrir coleccion ${collection.name}`}
                >
                  <TiltCard maxTilt={12} hoverScale={1.03} glareRadiusClassName="rounded-[1.25rem]" className="group">
                    <div className="[transform:translateZ(30px)]">
                      <CollectionArtwork
                        books={items}
                        name={collection.name}
                        className="shadow-[0_24px_40px_-14px_rgba(0,0,0,0.85)] transition-shadow duration-500 group-hover:shadow-[0_40px_60px_-16px_rgba(0,0,0,0.95)]"
                      />
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-2 px-0.5 [transform:translateZ(14px)]">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold tracking-tight">{collection.name}</p>
                        <p className="truncate text-xs text-white/50">
                          {formatBookCount(items.length)}
                          {totalSeconds > 0 && ` · ${formatDurationCompact(totalSeconds)}`}
                        </p>
                      </div>
                      {items.length > 0 && <ProgressRing percent={percent} size={28} strokeWidth={2.5} label={`Progreso de ${collection.name}`} />}
                    </div>
                  </TiltCard>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      <CollectionNameSheet
        open={creating}
        onClose={() => setCreating(false)}
        title="Nueva coleccion"
        submitLabel="Crear"
        collections={collections}
        onSubmit={async (name) => {
          const created = await createCollection(name)
          setCreating(false)
          if (created) navigate(`/collections/${created.id}`, { state: { openPicker: true } })
        }}
      />
    </section>
  )
}
