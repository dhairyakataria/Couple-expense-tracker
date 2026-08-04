'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createHouseholdAction, type OnboardingState } from './actions'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-brand-500 px-4 py-3 font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create household'}
    </button>
  )
}

export default function OnboardingForm() {
  const [state, action] = useActionState(createHouseholdAction, {} as OnboardingState)
  const [model, setModel] = useState<'equal' | 'ratio'>('equal')
  const [myShare, setMyShare] = useState(60)
  const [showSalaryHelper, setShowSalaryHelper] = useState(false)
  const [salaryMe, setSalaryMe] = useState('')
  const [salaryPartner, setSalaryPartner] = useState('')

  const suggested = (() => {
    const a = Number(salaryMe.replace(/[^\d]/g, ''))
    const b = Number(salaryPartner.replace(/[^\d]/g, ''))
    if (!a || !b) return null
    return Math.round((a / (a + b)) * 100)
  })()

  return (
    <form action={action} className="space-y-8">
      <div className="space-y-2">
        <label className="text-sm font-medium text-ink-700">Household name</label>
        <input
          name="name"
          required
          maxLength={60}
          placeholder="e.g. Sweta & Ankit"
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 outline-none focus:border-brand-500"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink-700">Your month starts on</label>
        <select
          name="period_start_day"
          defaultValue="1"
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 outline-none focus:border-brand-500"
        >
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d === 1 ? '1st — calendar month' : `${d}${ordinal(d)} of each month`}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-500">
          Pick your salary date if you budget from payday to payday.
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-medium text-ink-700">How will you split household costs?</label>
        <input type="hidden" name="model" value={model} />
        <input type="hidden" name="my_share_bp" value={model === 'ratio' ? myShare * 100 : 5000} />

        <div className="grid grid-cols-2 gap-2">
          <Choice active={model === 'equal'} onClick={() => setModel('equal')} title="Equally" subtitle="50 : 50" />
          <Choice active={model === 'ratio'} onClick={() => setModel('ratio')} title="By ratio" subtitle="e.g. 60 : 40" />
        </div>

        {model === 'ratio' && (
          <div className="space-y-3 rounded-xl bg-white p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-600">Your share</span>
              <span className="tabular text-lg font-semibold text-ink-900">
                {myShare} : {100 - myShare}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={myShare}
              onChange={(e) => setMyShare(Number(e.target.value))}
              className="w-full accent-[var(--color-brand-500)]"
            />

            <button
              type="button"
              onClick={() => setShowSalaryHelper((v) => !v)}
              className="text-sm text-brand-600 underline-offset-2 hover:underline"
            >
              {showSalaryHelper ? 'Hide' : 'Work it out from our incomes'}
            </button>

            {showSalaryHelper && (
              <div className="space-y-2 rounded-lg bg-ink-50 p-3">
                <p className="text-xs text-ink-500">
                  Used only to suggest a ratio. Neither figure is saved.
                </p>
                <div className="flex gap-2">
                  <input
                    inputMode="numeric"
                    value={salaryMe}
                    onChange={(e) => setSalaryMe(e.target.value)}
                    placeholder="Your income"
                    className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2"
                  />
                  <input
                    inputMode="numeric"
                    value={salaryPartner}
                    onChange={(e) => setSalaryPartner(e.target.value)}
                    placeholder="Their income"
                    className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2"
                  />
                </div>
                {suggested !== null && (
                  <button
                    type="button"
                    onClick={() => setMyShare(suggested)}
                    className="text-sm font-medium text-brand-600"
                  >
                    Use {suggested} : {100 - suggested}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {state.error && <p className="text-sm text-owing-500">{state.error}</p>}

      <Submit />
    </form>
  )
}

function Choice({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white'
      }`}
    >
      <div className="font-medium text-ink-900">{title}</div>
      <div className="tabular text-sm text-ink-500">{subtitle}</div>
    </button>
  )
}

function ordinal(d: number) {
  if (d > 3 && d < 21) return 'th'
  return ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th'
}
