'use client'

import { useRouter } from 'next/navigation'

export default function PeriodPicker({
  periods,
  selected,
}: {
  periods: { startsOn: string; label: string; closed: boolean }[]
  selected: string
}) {
  const router = useRouter()

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {periods.map((p) => (
        <button
          key={p.startsOn}
          type="button"
          onClick={() => router.replace(`/reports?period=${p.startsOn}`)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${
            p.startsOn === selected
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-ink-200 bg-white text-ink-700'
          }`}
        >
          {p.label}
          {p.closed && <span className="ml-1.5 text-xs text-ink-400">✓</span>}
        </button>
      ))}
    </div>
  )
}
