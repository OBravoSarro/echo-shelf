import { Layers } from 'lucide-react'
import type { Audiobook } from '../../domain/audiobook'
import { BookCover } from '../../components/ui/book-cover'

interface CollectionArtworkProps {
  books: Audiobook[]
  name: string
  /** Radio de la portada (clase tailwind `rounded-*`) */
  radiusClassName?: string
  /** Dibuja las "hojas" apiladas detras de la portada */
  stacked?: boolean
  className?: string
}

/**
 * Portada de una coleccion: mosaico 2x2 con 4+ libros, la primera portada con
 * menos, o un degradado con icono si esta vacia. Las capas apiladas detras le dan
 * aspecto de "pila de libros".
 */
export const CollectionArtwork = ({ books, name, radiusClassName = 'rounded-[1.25rem]', stacked = true, className = '' }: CollectionArtworkProps) => {
  const mosaic = books.length >= 4 ? books.slice(0, 4) : undefined
  const first = books[0]

  return (
    <div className={`relative ${className}`}>
      {stacked && (
        <>
          <div aria-hidden="true" className={`absolute inset-x-[12%] -top-[7%] h-1/2 border border-white/[0.08] bg-white/[0.1] ${radiusClassName}`} />
          <div aria-hidden="true" className={`absolute inset-x-[6%] -top-[3.5%] h-1/2 border border-white/[0.1] bg-white/[0.2] ${radiusClassName}`} />
        </>
      )}
      <div className={`relative aspect-square w-full overflow-hidden bg-[linear-gradient(130deg,#1d2a62,#7f49e8,#f03daf)] ${radiusClassName}`}>
        {mosaic ? (
          <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-black/40">
            {mosaic.map((book) => (
              <BookCover
                key={book.id}
                bookId={book.id}
                source={book.source}
                coverFileId={book.coverFileId}
                coverUrl={book.coverUrl}
                title={book.title}
                className="h-full w-full"
              />
            ))}
          </div>
        ) : first ? (
          <BookCover
            bookId={first.id}
            source={first.source}
            coverFileId={first.coverFileId}
            coverUrl={first.coverUrl}
            title={first.title}
            className="h-full w-full"
          />
        ) : (
          <div className="grid h-full w-full place-items-center" aria-label={`Coleccion ${name} vacia`}>
            <Layers className="size-1/4 text-white/80" strokeWidth={1.6} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/30" />
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" />
      </div>
    </div>
  )
}
