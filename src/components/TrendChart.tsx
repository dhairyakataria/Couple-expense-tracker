import { formatPaiseCompact } from '@/lib/money'

export interface TrendPoint {
  label: string
  paise: number
  current: boolean
}

export default function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0 || data.every((d) => d.paise === 0)) {
    return (
      <p className="py-8 text-center text-sm text-ink-400">
        A couple of months of history and a trend will appear here.
      </p>
    )
  }

  const vals = data.map((d) => d.paise)
  const min = Math.min(...vals) * 0.9
  const max = Math.max(...vals) * 1.05
  const n = data.length
  const xs = data.map((_, i) => (n === 1 ? 150 : (i * 300) / (n - 1)))
  const ys = data.map((d) => 100 - ((d.paise - min) / (max - min || 1)) * 85)

  let pathD = `M ${xs[0]},${ys[0]}`
  for (let i = 1; i < n; i++) pathD += ` L ${xs[i]},${ys[i]}`
  const areaD = `${pathD} L ${xs[n - 1]},100 L ${xs[0]},100 Z`

  return (
    <div className="h-40 w-full">
      <svg width="100%" height="100%" viewBox="0 0 300 130" preserveAspectRatio="none">
        <path d={areaD} fill="var(--color-brand-100)" />
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-brand-700)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xs[i]}
            cy={ys[i]}
            r={d.current ? 4.2 : 3}
            fill={d.current ? 'var(--color-brand-500)' : 'var(--color-brand-700)'}
            stroke="var(--color-ink-100)"
            strokeWidth="1.5"
          >
            <title>{`${d.label}: ${formatPaiseCompact(d.paise)}`}</title>
          </circle>
        ))}
        {data.map((d, i) => (
          <text
            key={i}
            x={xs[i]}
            y="122"
            fontSize="11"
            textAnchor="middle"
            fill="var(--color-ink-900)"
            opacity="0.55"
          >
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
