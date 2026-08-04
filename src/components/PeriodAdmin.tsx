'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reopenPeriod, undoSettlement } from '@/app/actions/settlement'
import { formatPaise } from '@/lib/money'
import { formatDayLabel } from '@/lib/settlement/periods'
import type { Profile } from '@/types/app'

export function ClosedPeriods({
  periods,
}: {
  periods: { id: string; label: string; closedAt: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  if (periods.length === 0) {
    return <p className="text-sm text-ink-400">No periods have been closed yet.</p>
  }

  return (
    <ul className="space-y-2">
      {periods.map((p) => (
        <li key={p.id} className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-ink-800">{p.label}</p>
            <p className="text-xs text-ink-400">Closed {formatDayLabel(p.closedAt.slice(0, 10))}</p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await reopenPeriod(p.id); router.refresh() })}
            className="text-sm font-medium text-brand-600 disabled:opacity-50"
          >
            Reopen
          </button>
        </li>
      ))}
    </ul>
  )
}

export function SettlementHistory({
  transfers,
  members,
  meId,
}: {
  transfers: { id: string; from_user_id: string; to_user_id: string; amount_paise: number; occurred_on: string }[]
  members: Profile[]
  meId: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState<string | null>(null)

  const name = (id: string) => (id === meId ? 'You' : members.find((m) => m.id === id)?.display_name ?? 'Partner')

  if (transfers.length === 0) {
    return <p className="text-sm text-ink-400">No payments between you two yet.</p>
  }

  return (
    <ul className="space-y-2">
      {transfers.map((t) => (
        <li key={t.id} className="rounded-xl bg-ink-50 px-3 py-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-ink-800">
                {name(t.from_user_id)} paid {name(t.to_user_id)}{' '}
                <span className="tabular font-medium">{formatPaise(t.amount_paise)}</span>
              </p>
              <p className="text-xs text-ink-400">{formatDayLabel(t.occurred_on)}</p>
            </div>
            {confirming === t.id ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(async () => { await undoSettlement(t.id); setConfirming(null); router.refresh() })}
                  className="text-sm font-medium text-owing-500"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="text-sm text-ink-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(t.id)}
                className="text-sm font-medium text-ink-500"
              >
                Undo
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
