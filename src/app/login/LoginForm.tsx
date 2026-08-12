'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { signIn, signInWithGoogle, signUp, type AuthState } from './actions'

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-brand-500 px-4 py-3 font-medium text-white transition disabled:opacity-60"
    >
      {pending ? 'One moment…' : label}
    </button>
  )
}

export default function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const initial: AuthState = {}
  const [state, action] = useActionState(mode === 'signin' ? signIn : signUp, initial)

  return (
    <div className="space-y-6">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-ink-200 bg-ink-100 px-4 py-3 font-medium text-ink-800 transition hover:bg-ink-50"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path
              fill="#4285F4"
              d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"
            />
            <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
            <path
              fill="#EA4335"
              d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"
            />
          </svg>
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-400">
        <span className="h-px flex-1 bg-ink-200" />
        or
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />

        {mode === 'signup' && (
          <input
            name="display_name"
            placeholder="Your name"
            autoComplete="name"
            required
            className="w-full rounded-xl border border-ink-200 bg-ink-100 px-4 py-3 outline-none focus:border-brand-500"
          />
        )}

        <input
          name="email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          required
          className="w-full rounded-xl border border-ink-200 bg-ink-100 px-4 py-3 outline-none focus:border-brand-500"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          className="w-full rounded-xl border border-ink-200 bg-ink-100 px-4 py-3 outline-none focus:border-brand-500"
        />

        {state.error && <p className="text-sm text-owing-500">{state.error}</p>}
        {state.notice && <p className="text-sm text-owed-500">{state.notice}</p>}

        <Submit label={mode === 'signin' ? 'Sign in' : 'Create account'} />
      </form>

      <p className="text-center text-sm text-ink-500">
        {mode === 'signin' ? 'No account yet?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}
