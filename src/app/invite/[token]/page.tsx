import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AcceptInviteButton from './AcceptInviteButton'

interface InvitePeek {
  household_name: string
  invited_by_name: string
  expires_at: string
  already_used: boolean
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()

  const { data } = await supabase.rpc('peek_invite', { p_token: token })
  const invite = (data as InvitePeek[] | null)?.[0]

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const expired = invite ? new Date(invite.expires_at) < new Date() : false

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      {!invite && (
        <Message
          title="This link is not valid"
          body="Ask your partner to send a fresh invitation."
        />
      )}

      {invite && invite.already_used && (
        <Message
          title="This invitation has already been used"
          body="If that was not you, ask your partner to send a new one."
        />
      )}

      {invite && !invite.already_used && expired && (
        <Message
          title="This invitation has expired"
          body="Invitations last 14 days. Ask your partner for a new link."
        />
      )}

      {invite && !invite.already_used && !expired && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
              {invite.invited_by_name} invited you
            </h1>
            <p className="mt-2 text-ink-500">
              Join <span className="font-medium text-ink-800">{invite.household_name}</span> to
              track shared expenses and settle up together.
            </p>
          </div>

          {user ? (
            <AcceptInviteButton token={token} />
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className="block w-full rounded-xl bg-brand-500 px-4 py-3 text-center font-medium text-white"
            >
              Sign in to accept
            </Link>
          )}
        </div>
      )}
    </main>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
      <p className="text-ink-500">{body}</p>
      <Link href="/" className="inline-block pt-4 font-medium text-brand-600">
        Go to Together
      </Link>
    </div>
  )
}
