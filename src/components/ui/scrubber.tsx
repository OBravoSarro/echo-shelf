import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { formatSeconds } from '../../lib/format'

interface ScrubberProps {
  value: number
  max: number
  onSeek: (seconds: number) => void
  label: string
  timeClassName?: string
}

/**
 * Barra de progreso arrastrable pensada para el dedo:
 * - zona tactil de 44 px (guia de Apple) aunque la barra visible sea fina
 * - toque o arrastre en cualquier punto (el <input range> de iOS solo se
 *   mueve agarrando el "thumb", que aqui es invisible)
 * - mientras arrastras solo se previsualiza; el seek se aplica al soltar,
 *   evitando decenas de seeks (y cortes de audio) por gesto
 */
export const Scrubber = ({ value, max, onSeek, label, timeClassName = 'text-xs text-white/50' }: ScrubberProps) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | undefined>()
  const safeMax = Math.max(1, max)
  const shown = Math.min(draft ?? value, safeMax)
  const percent = Math.min(100, (shown / safeMax) * 100)

  const valueAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return shown
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * safeMax
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Puntero ya liberado; el arrastre funcionara igual dentro de la zona
    }
    setDraft(valueAt(event.clientX))
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (draft === undefined) return
    setDraft(valueAt(event.clientX))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (draft === undefined) return
    const next = valueAt(event.clientX)
    setDraft(undefined)
    onSeek(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 60 : 15
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onSeek(Math.min(safeMax, value + step))
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onSeek(Math.max(0, value - step))
    else if (event.key === 'Home') onSeek(0)
    else return
    event.preventDefault()
  }

  const dragging = draft !== undefined

  return (
    <div className="space-y-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeMax)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={formatSeconds(shown)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDraft(undefined)}
        onKeyDown={onKeyDown}
        className="group relative flex h-11 cursor-pointer touch-none select-none items-center outline-none"
      >
        <div
          ref={trackRef}
          className={`relative w-full overflow-hidden rounded-full bg-white/15 transition-[height] duration-200 ease-apple-out group-focus-visible:h-2.5 ${dragging ? 'h-3' : 'h-1.5'}`}
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className={`-mt-2 flex justify-between tabular-nums ${timeClassName} ${dragging ? 'text-white' : ''}`}>
        <span>{formatSeconds(shown)}</span>
        <span>-{formatSeconds(Math.max(0, safeMax - shown))}</span>
      </div>
    </div>
  )
}
