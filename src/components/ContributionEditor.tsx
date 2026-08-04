'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateContribution } from '@/app/actions/household'
import { parseRupeesToPaise, formatPaise, paiseToRupeeString } from '@/lib/money'
import { formatDayLabel } from '@/lib/settlement/periods'
import type { Profile } from '@/types/app'

type Model = 'equal' | 'ratio' | 'fixed'

export default function ContributionEditor({
  members,
  meId,
  currentModel,
  currentShares,
  nextEffectiveFrom,
}: {
  members: Profile[]
  meId: string
  currentModel: Model
  currentShares: Record<string, { ratioBp: number | null; fixedAmountPaise: number | null }>
  nextEffectiveFrom: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [model, setModel] = useState<Model>(currentModel)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [myBp, setMyBp] = useState(currentShares[meId]?.ratioBp ?? 5000)
  const [fixed, setFixed] = useState<Record<string, string>>(
    Object.fromEntries(
      members.map((m) => [
        m.id,
        currentShares[m.id]?.fixedAmountPaise
          ? paiseToRupeeString(currentShares[m.id].fixedAmountPaise!)
          : '',
      ]),
    ),
  )

  const partner = members.find((m) => m.id !== meId)

  const save = () =>
    start(async () => {
      setError(null)
      setMessage(null)

      const shares = members.map((m) => {
        if (model === 'equal') {
          return { userId: m.id, ratioBp: Math.round(10000 / members.length), fixedAmountPaise: null }
        }
        if (model === 'ratio') {
          return {
            userId: m.id,
            ratioBp: m.id === meId ? myBp : 10000 - myBp,
            fixedAmountPaise: null,
          }
        }
        return {
          userId: m.id,
          ratioBp: null,
          fixedAmountPaise: parseRupeesToPaise(fixed[m.id] ?? '') ?? 0,
        }
      })

      // An equal split across an odd number of members will not land on 10000.
      if (model === 'equal') {
        const total = shares.reduce((sum, s) => sum + (s.ratioBp ?? 0), 0)
        if (total !== 10000 && shares[0].ratioBp !== null) {
          shares[0].ratioBp += 10000 - total
        }
      }

      const result = await updateContribution({ model, shares })
      if (result.error) setError(result.error)
      else {
        setMessage(`Saved. This takes effect from ${formatDayLabel(nextEffectiveFrom)}.`)
        router.refresh()
      }
    })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {(['equal', 'ratio', 'fixed'] as Model[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setModel(m)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition ${
              model === m ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-700'
            }`}
          >
            {m === 'equal' ? 'Equal' : m === 'ratio' ? 'By ratio' : 'Fixed'}
          </button>
        ))}
      </div>

      {model === 'equal' && (
        <p className="text-sm text-ink-500">
          Household costs split down the middle, whoever happens to pay.
        </p>
      )}

      {model === 'ratio' && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-ink-600">You : {partner?.display_name ?? 'Partner'}</span>
            <span className="tabular text-lg font-semibold text-ink-900">
              {Math.round(myBp / 100)} : {100 - Math.round(myBp / 100)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(myBp / 100)}
            onChange={(e) => setMyBp(Number(e.target.value) * 100)}
            className="w-full accent-[var(--color-brand-500)]"
          />
        </div>
      )}

      {model === 'fixed' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            Each of you covers a set amount. Anything the household spends beyond the two figures
            is split down the middle.
          </p>
          {members.map((m) => (
            <div key={m.id} className="space-y-1">
              <label className="text-sm text-ink-600">
                {m.id === meId ? 'You contribute' : `${m.display_name} contributes`}
              </label>
              <input
                inputMode="decimal"
                value={fixed[m.id] ?? ''}
                onChange={(e) => setFixed((prev) => ({ ...prev, [m.id]: e.target.value }))}
                placeholder="30000"
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 outline-none focus:border-brand-500"
              />
            </div>
          ))}
          <p className="tabular text-sm text-ink-500">
            Committed total:{' '}
            {formatPaise(
              members.reduce((sum, m) => sum + (parseRupeesToPaise(fixed[m.id] ?? '') ?? 0), 0),
            )}
          </p>
        </div>
      )}

      <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600">
        Changes apply from the start of the next period ({formatDayLabel(nextEffectiveFrom)}).
        Months already recorded keep the split that was in force at the time.
      </p>

      {error && <p className="text-sm text-owing-500">{error}</p>}
      {message && <p className="text-sm text-owed-500">{message}</p>}

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="w-full rounded-xl bg-brand-500 px-4 py-3 font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save split'}
      </button>
    </div>
  )
}
