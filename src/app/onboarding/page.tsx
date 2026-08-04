import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OnboardingForm from './OnboardingForm'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: existing } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) redirect('/')

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Set up your household</h1>
      <p className="mt-2 text-ink-500">
        This takes about thirty seconds, and you can change all of it later.
      </p>
      <div className="mt-8">
        <OnboardingForm />
      </div>
    </main>
  )
}
