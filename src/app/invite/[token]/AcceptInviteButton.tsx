'use client'

import { useState, useTransition } from 'react'
import { acceptInvite } from '@/app/actions/household'

export default function AcceptInviteButton({ token }: { token: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await acceptInvite(token)
            if (result?.error) setError(result.error)
          })
        }
        className="w-full rounded-xl bg-brand-500 px-4 py-3 font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Joining…' : 'Accept invitation'}
      </button>
      {error && <p className="text-sm text-owing-500">{error}</p>}
    </div>
  )
}
