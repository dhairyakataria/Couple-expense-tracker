'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import {
  addCategory,
  addPaymentMethod,
  archiveCategory,
  archivePaymentMethod,
} from '@/app/actions/household'
import type { Category, PaymentMethod } from '@/types/app'

export function CategoryManager({ categories }: { categories: Category[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 bg-ink-100 py-1 pl-3 pr-1.5 text-sm text-ink-700"
          >
            {c.name}
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              onClick={() => start(async () => { await archiveCategory(c.id); router.refresh() })}
              className="p-0.5 text-ink-400 transition hover:text-owing-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category"
          className="w-full rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() =>
            start(async () => {
              const result = await addCategory(name)
              if (result?.error) setError(result.error)
              else {
                setName('')
                setError(null)
                router.refresh()
              }
            })
          }
          className="shrink-0 rounded-xl bg-ink-900 px-4 text-white disabled:opacity-40"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      {error && <p className="text-sm text-owing-500">{error}</p>}
      <p className="text-xs text-ink-400">
        Removing a category leaves past transactions untouched — it just stops appearing in the
        picker.
      </p>
    </div>
  )
}

export function PaymentMethodManager({ methods }: { methods: PaymentMethod[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [label, setLabel] = useState('')
  const [isJoint, setIsJoint] = useState(false)

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {methods.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2">
            <span className="text-sm text-ink-800">
              {m.label}
              {m.is_joint && (
                <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700">
                  Joint
                </span>
              )}
            </span>
            <button
              type="button"
              aria-label={`Remove ${m.label}`}
              onClick={() => start(async () => { await archivePaymentMethod(m.id); router.refresh() })}
              className="p-1 text-ink-400 transition hover:text-owing-500"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. HDFC Credit"
          className="w-full rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
        />
        <button
          type="button"
          disabled={pending || !label.trim()}
          onClick={() =>
            start(async () => {
              await addPaymentMethod(label, isJoint)
              setLabel('')
              setIsJoint(false)
              router.refresh()
            })
          }
          className="shrink-0 rounded-xl bg-ink-900 px-4 text-white disabled:opacity-40"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={isJoint}
          onChange={(e) => setIsJoint(e.target.checked)}
          className="h-4 w-4 rounded border-ink-300"
        />
        This is a joint account or shared card
      </label>
      <p className="text-xs text-ink-400">
        Spending from a joint method is treated as already split, so it never makes one of you owe
        the other.
      </p>
    </div>
  )
}
