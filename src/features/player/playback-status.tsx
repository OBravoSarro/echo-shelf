import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { usePlayerStore } from './player-store'

/**
 * Solo aparece cuando hay algo que el usuario tiene que saber o hacer:
 * un error (con reintentar) o un aviso accionable ("pulsa play"). El progreso
 * de carga se muestra en la propia fila del capitulo, no aqui.
 */
export const PlaybackStatus = () => {
  const reduceMotion = useReducedMotion()
  const loadStatus = usePlayerStore((state) => state.loadStatus)
  const retry = usePlayerStore((state) => state.retry)

  const isError = loadStatus.phase === 'error'
  const text = isError ? (loadStatus.message ?? 'No se pudo cargar el capitulo') : loadStatus.phase === 'idle' ? loadStatus.message : undefined

  return (
    <div className="mt-4 min-h-[2.25rem]" aria-live="polite">
      <AnimatePresence initial={false}>
        {text && (
          <motion.div
            key={isError ? 'error' : 'message'}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className={`flex items-center justify-center gap-2 text-[13px] lg:justify-start ${isError ? 'text-rose-200' : 'text-white/55'}`}
          >
            <AlertCircle className="size-4 shrink-0" />
            <span className="min-w-0">{text}</span>
            {isError && (
              <button type="button" onClick={() => void retry()} className="btn-pill glass text-[12px] text-white/90">
                <RefreshCw className="size-3.5" /> Reintentar
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
