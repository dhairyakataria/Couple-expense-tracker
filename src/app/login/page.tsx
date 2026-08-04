import { Suspense } from 'react'
import LoginForm from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Together</h1>
        <p className="mt-2 text-ink-500">
          Household money for two people who both earn.
        </p>
      </div>

      {params.error && (
        <p className="mb-4 rounded-lg bg-owing-50 px-4 py-3 text-sm text-owing-500">
          Sign-in did not complete. Please try again.
        </p>
      )}

      <Suspense>
        <LoginForm next={params.next ?? '/'} />
      </Suspense>
    </main>
  )
}
