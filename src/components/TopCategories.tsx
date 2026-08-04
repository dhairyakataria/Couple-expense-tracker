import { formatPaise } from '@/lib/money'

export interface CategorySlice {
  name: string
  paise: number
}

export default function TopCategories({ slices }: { slices: CategorySlice[] }) {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">No categorised spending yet.</p>
  }

  const max = Math.max(...slices.map((s) => s.paise), 1)

  return (
    <ul className="space-y-3">
      {slices.map((s) => (
        <li key={s.name} className="space-y-1">
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
        </li>
      ))}
    </ul>
  )
}
