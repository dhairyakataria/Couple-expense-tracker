'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Category, Profile } from '@/types/app'

export default function TransactionFilters({
  members,
  categories,
  meId,
}: {
  members: Profile[]
  categories: Category[]
  meId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [q, setQ] = useState(searchParams.get('q') ?? '')

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('adjusted')
    if (value) next.set(key, value)
    else next.delete(key)
    router.replace(`/transactions?${next.toString()}`)
  }

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const current = searchParams.get('q') ?? ''
    if (q === current) return
    const timer = setTimeout(() => setParam('q', q.trim() || null), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const type = searchParams.get('type')
  const payer = searchParams.get('payer')
  const category = searchParams.get('category')
  const hasFilters = Boolean(type || payer || category || searchParams.get('q'))

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search merchant or notes"
          className="w-full rounded-xl border border-ink-200 bg-ink-100 py-2.5 pl-9 pr-9 outline-none focus:border-brand-500"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-400"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Chip label="All" active={!type} onClick={() => setParam('type', null)} />
        <Chip label="Household" active={type === 'household'} onClick={() => setParam('type', 'household')} />
        <Chip label="Personal" active={type === 'personal'} onClick={() => setParam('type', 'personal')} />
        <Chip label="For partner" active={type === 'partner'} onClick={() => setParam('type', 'partner')} />

        <span className="w-px shrink-0 bg-ink-200" />

        {members.map((m) => (
          <Chip
            key={m.id}
            label={m.id === meId ? 'Paid by you' : `Paid by ${m.display_name}`}
            active={payer === m.id}
            onClick={() => setParam('payer', payer === m.id ? null : m.id)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <select
          value={category ?? ''}
          onChange={(e) => setParam('category', e.target.value || null)}
          className="flex-1 rounded-xl border border-ink-200 bg-ink-100 px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">Every category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQ('')
              router.replace('/transactions')
            }}
            className="shrink-0 text-sm font-medium text-brand-600"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 border px-3 py-1.5 text-sm transition ${
        active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 bg-ink-100 text-ink-700'
      }`}
    >
      {label}
    </button>
  )
}
