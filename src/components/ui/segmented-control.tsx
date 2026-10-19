import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  ariaLabel?: string
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: ReadonlyArray<SegmentOption<T>>
  onChange: (value: T) => void
  /** Debe ser único por instancia para que la animación compartida no salte entre controles */
  layoutId: string
  className?: string
}

/**
 * Segmented control de iOS: la "píldora" seleccionada se desliza entre opciones
 * con una animación de layout compartida.
 */
export const SegmentedControl = <T extends string>({ value, options, onChange, layoutId, className }: SegmentedControlProps<T>) => {
  const reduceMotion = useReducedMotion()

  return (
    <div
      role="tablist"
      className={`no-scrollbar relative inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-white/[0.06] bg-white/[0.06] p-1 ${className ?? ''}`}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={`relative z-0 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 sm:px-3.5 text-xs font-medium transition-colors duration-300 ${active ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
          >
            {active &&
              (reduceMotion ? (
                <span className="absolute inset-0 -z-10 rounded-full bg-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]" />
              ) : (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 -z-10 rounded-full bg-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_12px_rgba(0,0,0,0.3)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              ))}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
