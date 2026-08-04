'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closePeriod } from '@/app/actions/settlement'

export default function ClosePeriodButton({ periodId }: { periodId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full rounded-xl bg-ink-900 px-4 py-2.5 font-medium text-white"
      >
        Close this period
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-600">
        Anything dated in this period will be locked. Later entries with an old date will land in
        the current month as an adjustment.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await closePeriod(periodId)
              if (result?.error) setError(result.error)
              else {
                setConfirming(false)
                router.refresh()
              }
            })
          }
          className="flex-1 rounded-xl bg-ink-900 px-4 py-2.5 font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Closing…' : 'Close it'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-xl border border-ink-200 px-4 py-2.5 font-medium text-ink-700"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-owing-500">{error}</p>}
    </div>
  )
}
