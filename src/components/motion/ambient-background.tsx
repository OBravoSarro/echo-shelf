import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

/**
 * Fondo global tipo "aurora": manchas de color desenfocadas que respiran
 * (CSS keyframes) y se desplazan a distinta velocidad con el scroll (parallax).
 * Capa motion (parallax) e interior CSS (aurora) separados para no pisar `transform`.
 */
export const AmbientBackground = () => {
  const reduceMotion = useReducedMotion()
  const { scrollY } = useScroll()
  const slow = useTransform(scrollY, [0, 2000], [0, -160])
  const mid = useTransform(scrollY, [0, 2000], [0, -320])
  const fast = useTransform(scrollY, [0, 2000], [0, -520])

  return (
    <div aria-hidden="true" className="noise pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <motion.div style={reduceMotion ? undefined : { y: slow }} className="absolute -left-[25%] -top-[30%] h-[80vh] w-[80vw]">
        <div className="h-full w-full animate-aurora rounded-full bg-accent-violet/25 blur-[120px] will-change-transform" />
      </motion.div>
      <motion.div style={reduceMotion ? undefined : { y: mid }} className="absolute -right-[20%] top-[-10%] h-[65vh] w-[60vw]">
        <div className="h-full w-full animate-aurora-slow rounded-full bg-accent-magenta/[0.18] blur-[120px] will-change-transform" />
      </motion.div>
      <motion.div style={reduceMotion ? undefined : { y: fast }} className="absolute left-[20%] top-[55%] h-[60vh] w-[55vw]">
        <div className="h-full w-full animate-aurora rounded-full bg-accent-cyan/[0.12] blur-[140px] will-change-transform" />
      </motion.div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(0,0,0,0.35)_55%,#000_100%)]" />
    </div>
  )
}
