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
    // Sin hueco reservado: el aviso entra desplegando su altura para no dejar
    // un espacio vacio entre los controles y los capitulos.
    <div aria-live="polite">
      <AnimatePresence initial={false}>
        {text && (
          <motion.div
            key={isError ? 'error' : 'message'}
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className={`flex items-center justify-center gap-2 pt-4 text-[13px] lg:justify-start ${isError ? 'text-rose-200' : 'text-white/55'}`}>
            <AlertCircle className="size-4 shrink-0" />
            <span className="min-w-0">{text}</span>
            {isError && (
              <button type="button" onClick={() => void retry()} className="btn-pill glass text-[12px] text-white/90">
                <RefreshCw className="size-3.5" /> Reintentar
              </button>
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
