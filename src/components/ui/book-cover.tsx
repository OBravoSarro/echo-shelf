import { useState } from 'react'
import { useResolvedCover } from '../../features/library/use-resolved-cover'

// ─── Book Cover ────────────────────────────────────────────────────────────────

export const CoverArt = ({ src, title, className }: { src?: string; title: string; className: string }) => {
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

export const BookCover = ({
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
