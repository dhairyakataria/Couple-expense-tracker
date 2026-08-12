import Link from 'next/link'
import { formatPaise } from '@/lib/money'

export interface CategorySlice {
  id: string | null
  name: string
  paise: number
}

// Same r=15.9155-in-42x42-viewBox trick as ContributionProgress: the
// circumference is ~100, so segment lengths are plain 0–100 percentages.
const RING_R = 15.9155
const RING_CIRCUMFERENCE = 100

const DONUT_COLORS = [
  'var(--color-brand-700)',
  'var(--color-brand-500)',
  'var(--color-brand-200)',
  'var(--color-ink-700)',
  'var(--color-ink-400)',
]

export default function TopCategories({
  slices,
  hrefFor,
}: {
  slices: CategorySlice[]
  hrefFor?: (slice: CategorySlice) => string | null
}) {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">No categorised spending yet.</p>
  }

  const total = slices.reduce((a, s) => a + s.paise, 0) || 1
  let cumulative = 0
  const segments = slices.map((s, i) => {
    const pct = (s.paise / total) * 100
    const offset = 25 - cumulative
    cumulative += pct
    return { ...s, pct, offset, color: DONUT_COLORS[i % DONUT_COLORS.length] }
  })

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: 100, height: 100 }}>
        <svg width="100" height="100" viewBox="0 0 42 42">
          <circle cx="21" cy="21" r={RING_R} fill="none" stroke="var(--color-ink-200)" strokeWidth="6" />
          {segments.map((seg) => (
            <circle
              key={seg.name}
              cx="21"
              cy="21"
              r={RING_R}
              fill="none"
              stroke={seg.color}
              strokeWidth="6"
              strokeDasharray={`${seg.pct} ${RING_CIRCUMFERENCE - seg.pct}`}
              strokeDashoffset={seg.offset}
              style={{ transition: 'stroke-dasharray 900ms ease' }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-center text-sm font-extrabold leading-tight text-ink-900">
            {formatPaise(total)}
          </span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {segments.map((s) => {
          const row = (
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="h-2.5 w-2.5 shrink-0" style={{ background: s.color }} />
              <span className="flex-1 truncate text-ink-700">{s.name}</span>
              <span className="tabular font-semibold text-ink-900">{formatPaise(s.paise)}</span>
            </div>
          )

          const href = hrefFor?.(s) ?? null

          return (
            <li key={s.name}>
              {href ? (
                <Link href={href} className="block transition active:opacity-70">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
