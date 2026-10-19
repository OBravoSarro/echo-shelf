import { useId } from 'react'

interface ProgressRingProps {
  percent: number
  size?: number
  strokeWidth?: number
  label?: string
  valueLabel?: string
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

export const ProgressRing = ({ percent, size = 46, strokeWidth = 4, label, valueLabel }: ProgressRingProps) => {
  const gradientId = useId()
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
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#a99bff" />
              <stop offset="55%" stopColor="#f48fd4" />
              <stop offset="100%" stopColor="#7cd3ff" />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            fill="none"
            className="transition-[stroke-dashoffset] duration-700 ease-apple-out"
          />
        </svg>
        <span
          className="absolute inset-0 grid place-items-center font-semibold tabular-nums text-white"
          style={{ fontSize: Math.max(8, Math.round(size * 0.26)) }}
        >
          {centerLabel}
        </span>
      </div>
    </div>
  )
}
