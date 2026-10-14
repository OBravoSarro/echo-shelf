interface ProgressRingProps {
  percent: number
  size?: number
  strokeWidth?: number
  label?: string
  valueLabel?: string
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

export const ProgressRing = ({ percent, size = 46, strokeWidth = 4, label, valueLabel }: ProgressRingProps) => {
  const safePercent = clampPercent(percent)
  const roundedPercent = Math.round(safePercent)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (roundedPercent / 100) * circumference

  const centerLabel = valueLabel ?? `${roundedPercent}%`

  return (
    <div className="inline-flex items-center gap-2" aria-label={label}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgb(34 211 238)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            fill="none"
            className="transition-all duration-300"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-slate-100">{centerLabel}</span>
      </div>
    </div>
  )
}
