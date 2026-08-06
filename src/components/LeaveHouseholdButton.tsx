'use client'

import { useState, useTransition } from 'react'
import { leaveHousehold } from '@/app/actions/household'

/**
 * The one intentional way to disconnect from a household. Two taps on
 * purpose — this hides the partner's data from you immediately and there is
 * no undo from here (they would need to invite you again).
 */
export default function LeaveHouseholdButton() {
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full py-2 text-sm font-medium text-owing-500"
      >
        Leave this household
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-center text-sm text-ink-500">
        You will stop seeing this household&apos;s expenses. Your partner keeps everything as-is.
      </p>
      {error && <p className="text-center text-sm text-owing-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await leaveHousehold()
              if (result?.error) setError(result.error)
            })
          }
          className="flex-1 rounded-xl bg-owing-500 px-4 py-3 font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Leaving…' : 'Leave for good'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="flex-1 rounded-xl border border-ink-200 bg-white px-4 py-3 font-medium text-ink-700"
        >
          Stay
        </button>
      </div>
    </div>
  )
}
