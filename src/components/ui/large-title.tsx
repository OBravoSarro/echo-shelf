import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import type { ReactNode } from 'react'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

interface LargeTitleProps {
  title: string
  subtitle?: string
  eyebrow?: string
  trailing?: ReactNode
}

/**
 * "Large title" estilo iOS: entra con blur + subida y, al hacer scroll,
 * se encoge, sube y se desvanece (parallax del encabezado).
 */
export const LargeTitle = ({ title, subtitle, eyebrow, trailing }: LargeTitleProps) => {
  const reduceMotion = useReducedMotion()
  const { scrollY } = useScroll()
  const scale = useTransform(scrollY, [0, 160], [1, 0.9])
  const y = useTransform(scrollY, [0, 160], [0, -28])
  const opacity = useTransform(scrollY, [0, 140], [1, 0])

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pt-6 sm:pt-10">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 24, filter: 'blur(14px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 1, ease: EASE_OUT }}
      >
        <motion.div style={reduceMotion ? undefined : { scale, y, opacity, transformOrigin: 'left bottom' }}>
          {eyebrow && <p className="text-eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-display text-gradient text-[2.6rem] leading-[1.02] sm:text-6xl lg:text-7xl">{title}</h1>
          {subtitle && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/55 sm:text-[17px]">{subtitle}</p>}
        </motion.div>
      </motion.div>
      {trailing && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.15 }}
        >
          {trailing}
        </motion.div>
      )}
    </header>
  )
}

interface SectionHeaderProps {
  title: string
  eyebrow?: string
  trailing?: ReactNode
}

export const SectionHeader = ({ title, eyebrow, trailing }: SectionHeaderProps) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      {eyebrow && <p className="text-eyebrow mb-1">{eyebrow}</p>}
      <h3 className="text-display text-2xl text-white sm:text-[1.75rem]">{title}</h3>
    </div>
    {trailing}
  </div>
)
