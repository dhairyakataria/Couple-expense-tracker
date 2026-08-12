'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatPaise } from '@/lib/money'
import { settleOutstanding } from '@/app/actions/settlement'
import type { Headline } from '@/lib/settlement/types'
import type { Profile } from '@/types/app'

/**
 * The single most important element on the screen. One sentence, no jargon,
 * no accounting vocabulary — just who owes whom.
 */
export default function SettlementCard({
  headline,
  members,
  meId,
  hasPartner,
}: {
  headline: Headline | null
  members: Profile[]
  meId: string
  hasPartner: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? 'Your partner'

  if (!hasPartner) {
    return (
      <section className="bg-ink-100 p-5">
        <p className="text-ink-500">
          Invite your partner to start settling up. Until then this is a personal expense log.
        </p>
      </section>
    )
  }

  if (!headline) {
    return (
      <section className="border border-brand-500 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">All square</p>
        <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-900">
          Nobody owes anybody
        </p>
      </section>
    )
  }

  const iAmOwed = headline.toUserId === meId
  const sentence = iAmOwed
    ? `${name(headline.fromUserId)} owes you`
    : `You owe ${name(headline.toUserId)}`

  return (
    <section className="bg-ink-100 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Balance</p>
      <p className="mt-1.5 text-xl font-extrabold tracking-tight text-ink-900">{sentence}</p>
      <p className="tabular mt-0.5 text-4xl font-extrabold tracking-tight text-brand-700">
        {formatPaise(headline.amountPaise)}
      </p>

      {confirming ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-ink-600">
            Record that {name(headline.fromUserId)} paid {name(headline.toUserId)}{' '}
            {formatPaise(headline.amountPaise)}? This clears the balance.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await settleOutstanding()
                  if (result?.error) setError(result.error)
                  else {
                    setConfirming(false)
                    router.refresh()
                  }
                })
              }
              className="flex-1 bg-brand-500 px-4 py-2.5 font-semibold text-ink-50 disabled:opacity-60"
            >
              {pending ? 'Recording…' : 'Yes, it is paid'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border border-ink-200 px-4 py-2.5 font-semibold text-ink-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 w-full bg-brand-500 px-4 py-2.5 font-semibold text-ink-50"
        >
          Settle up
        </button>
      )}

      {error && <p className="mt-2 text-sm text-owing-500">{error}</p>}
    </section>
  )
}
