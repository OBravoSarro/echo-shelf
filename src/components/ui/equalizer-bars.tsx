/** Barras de ecualizador animadas (indicador "reproduciendo ahora"). */
export const EqualizerBars = ({ active, className }: { active: boolean; className?: string }) => (
  <span aria-hidden="true" className={`inline-flex h-3 items-end gap-[2px] ${className ?? ''}`}>
    {[0, 0.2, 0.4, 0.1].map((delay, index) => (
      <span
        key={index}
        className={`w-[3px] origin-bottom rounded-full bg-current ${active ? 'animate-eq-bar' : 'scale-y-[0.35]'}`}
        style={{ height: '100%', animationDelay: `${delay}s` }}
      />
    ))}
  </span>
)
