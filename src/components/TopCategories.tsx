import Link from 'next/link'
import { formatPaise } from '@/lib/money'

export interface CategorySlice {
  id: string | null
  name: string
  paise: number
}

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

  const max = Math.max(...slices.map((s) => s.paise), 1)

  return (
    <ul className="space-y-3">
      {slices.map((s) => {
        const bar = (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-700">{s.name}</span>
              <span className="tabular font-medium text-ink-900">{formatPaise(s.paise)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-200"
                style={{ width: `${(s.paise / max) * 100}%` }}
              />
            </div>
          </div>
        )

        const href = hrefFor?.(s) ?? null

        return (
          <li key={s.name}>
            {href ? (
              <Link href={href} className="block rounded-lg transition active:opacity-70">
                {bar}
              </Link>
            ) : (
              bar
            )}
          </li>
        )
      })}
    </ul>
  )
}
