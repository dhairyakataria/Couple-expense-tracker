'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createInvite } from '@/app/actions/household'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-brand-500 px-4 py-3 font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create link'}
    </button>
  )
}

export default function InvitePanel({ householdName }: { householdName: string }) {
  const [state, action] = useActionState(createInvite, {} as { link?: string; error?: string })
  const [copied, setCopied] = useState(false)

  const message = state.link
    ? `Join our household "${householdName}" on Together so we can track shared expenses: ${state.link}`
    : ''

  return (
    <div className="space-y-4">
      <form action={action} className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="Partner’s email"
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 outline-none focus:border-brand-500"
        />
        <Submit />
      </form>

      {state.error && <p className="text-sm text-owing-500">{state.error}</p>}

      {state.link && (
        <div className="space-y-3 rounded-xl bg-white p-4">
          <p className="text-sm text-ink-600">
            Send this link to your partner. It works once and expires in 14 days.
          </p>
          <p className="tabular break-all rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
            {state.link}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.link!)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 font-medium text-ink-800"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-xl bg-owed-500 px-4 py-2.5 text-center font-medium text-white"
            >
              Send on WhatsApp
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
