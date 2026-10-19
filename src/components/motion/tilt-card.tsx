import clsx from 'clsx'
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import type { PointerEvent, ReactNode } from 'react'
import { useFinePointer } from './use-fine-pointer'

const SPRING = { stiffness: 220, damping: 22, mass: 0.6 }

interface TiltCardProps {
  children: ReactNode
  /** Clases de la superficie que rota (borde, fondo, radio...) */
  className?: string
  /** Clases del contenedor con perspectiva (layout externo) */
  wrapperClassName?: string
  /** Inclinación máxima en grados */
  maxTilt?: number
  hoverScale?: number
  glare?: boolean
  /** Radio del reflejo, debe coincidir con el de la superficie */
  glareRadiusClassName?: string
}

/**
 * Tarjeta con inclinación 3D siguiendo el puntero + reflejo especular.
 * - Solo se activa con puntero fino y sin `prefers-reduced-motion`.
 * - Los hijos pueden usar `[transform:translateZ(Npx)]` para separarse en capas
 *   (la superficie usa `preserve-3d`).
 */
export const TiltCard = ({
  children,
  className,
  wrapperClassName,
  maxTilt = 8,
  hoverScale = 1.015,
  glare = true,
  glareRadiusClassName = 'rounded-[1.75rem]',
}: TiltCardProps) => {
  const reduceMotion = useReducedMotion()
  const finePointer = useFinePointer()
  const enabled = finePointer && !reduceMotion

  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(py, [0, 1], [maxTilt, -maxTilt]), SPRING)
  const rotateY = useSpring(useTransform(px, [0, 1], [-maxTilt, maxTilt]), SPRING)
  const glareX = useTransform(px, (v) => v * 100)
  const glareY = useTransform(py, (v) => v * 100)
  const glareOpacity = useSpring(0, SPRING)
  const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.28), rgba(255,255,255,0.06) 35%, transparent 60%)`

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    const rect = event.currentTarget.getBoundingClientRect()
    px.set((event.clientX - rect.left) / rect.width)
    py.set((event.clientY - rect.top) / rect.height)
  }

  const handleEnter = () => {
    if (enabled) glareOpacity.set(1)
  }

  const handleLeave = () => {
    px.set(0.5)
    py.set(0.5)
    glareOpacity.set(0)
  }

  return (
    <div
      className={clsx('perspective', wrapperClassName)}
      onPointerMove={handleMove}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
      <motion.div
        className={clsx('relative h-full w-full', className)}
        style={enabled ? { rotateX, rotateY, transformStyle: 'preserve-3d' } : undefined}
        whileHover={enabled ? { scale: hoverScale } : undefined}
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
        transition={{ type: 'spring', ...SPRING }}
      >
        {children}
        {glare && enabled && (
          <motion.div
            aria-hidden="true"
            className={clsx('pointer-events-none absolute inset-0 z-10 mix-blend-soft-light', glareRadiusClassName)}
            style={{ background: glareBackground, opacity: glareOpacity }}
          />
        )}
      </motion.div>
    </div>
  )
}
