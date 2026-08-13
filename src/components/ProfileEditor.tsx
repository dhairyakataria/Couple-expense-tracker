'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateDisplayName } from '@/app/actions/household'

export default function ProfileEditor({ initialName }: { initialName: string }) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const dirty = name.trim() !== initialName.trim() && name.trim().length > 0

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Your name"
          className="w-full rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
        />
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const result = await updateDisplayName(name)
              if (result?.error) setError(result.error)
              else {
                setError(null)
                router.refresh()
              }
            })
          }
          className="shrink-0 rounded-xl bg-ink-900 px-4 font-medium text-white disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="text-sm text-owing-500">{error}</p>}
      <p className="text-xs text-ink-400">Visible to your partner everywhere in the app.</p>
    </div>
  )
}
