import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { type ReactNode, useRef } from 'react'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
  /** Desplazamiento inicial en px */
  y?: number
  /** Desenfoque de entrada (usar solo en titulares: es caro y crea containing block) */
  blur?: boolean
  once?: boolean
}

/**
 * Aparición al entrar en viewport: fade + subida + ligero scale.
 * Curva "ease-out expo" similar a la de las landing de Apple.
 */
export const Reveal = ({ children, className, delay = 0, y = 28, blur = false, once = true }: RevealProps) => {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, scale: 0.985, ...(blur ? { filter: 'blur(12px)' } : {}) }}
      whileInView={{ opacity: 1, y: 0, scale: 1, ...(blur ? { filter: 'blur(0px)' } : {}) }}
      viewport={{ once, amount: 0.12, margin: '0px 0px -40px 0px' }}
      transition={{ duration: 0.9, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  )
}

interface ParallaxProps {
  children: ReactNode
  className?: string
  /** Intensidad: px recorridos a lo largo del paso por viewport (positivo = va más lento que el scroll) */
  offset?: number
}

/**
 * Capa con parallax ligado a la posición del elemento en el viewport.
 */
export const Parallax = ({ children, className, offset = 60 }: ParallaxProps) => {
  const reduceMotion = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset])

  return (
    <motion.div ref={ref} className={className} style={reduceMotion ? undefined : { y }}>
      {children}
    </motion.div>
  )
}
