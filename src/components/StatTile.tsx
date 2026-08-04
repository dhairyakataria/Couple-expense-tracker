import { formatPaise } from '@/lib/money'

export default function StatTile({
  label,
  paise,
  hint,
  tone = 'default',
}: {
  label: string
  paise: number
  hint?: string
  tone?: 'default' | 'muted'
}) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p
        className={`tabular mt-1 text-xl font-semibold ${
          tone === 'muted' ? 'text-ink-600' : 'text-ink-900'
        }`}
      >
        {formatPaise(paise)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  )
}
