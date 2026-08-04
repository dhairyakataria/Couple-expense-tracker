import Link from 'next/link'
import { requireHousehold } from '@/lib/data'
import InvitePanel from '@/components/InvitePanel'

export default async function OnboardingInvitePage() {
  const { household, partner } = await requireHousehold()

  return (
    <main className="mx-auto min-h-screen max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Invite your partner</h1>
      <p className="mt-2 text-ink-500">
        Everything you both log lands in one shared view. You can do this later, but the
        settlement number only means something once you are both in.
      </p>

      <div className="mt-8">
        {partner ? (
          <p className="rounded-xl bg-owed-50 px-4 py-3 text-owed-500">
            {partner.display_name} has already joined.
          </p>
        ) : (
          <InvitePanel householdName={household.name} />
        )}
      </div>

      <Link
        href="/"
        className="mt-10 block text-center font-medium text-ink-500 underline-offset-2 hover:underline"
      >
        {partner ? 'Go to dashboard' : 'Skip for now'}
      </Link>
    </main>
  )
}
