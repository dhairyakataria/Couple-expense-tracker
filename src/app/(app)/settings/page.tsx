import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireHousehold } from '@/lib/data'
import { addMonths, formatPeriodLabel, periodStartFor, todayIso } from '@/lib/settlement/periods'
import { signOut } from '@/app/login/actions'
import ContributionEditor from '@/components/ContributionEditor'
import InvitePanel from '@/components/InvitePanel'
import { CategoryManager, PaymentMethodManager } from '@/components/ManageLists'
import LeaveHouseholdButton from '@/components/LeaveHouseholdButton'
import { ClosedPeriods, SettlementHistory } from '@/components/PeriodAdmin'
import type { ContributionModel } from '@/types/app'

export default async function SettingsPage() {
  const { household, members, me, partner, categories, paymentMethods } = await requireHousehold()
  const supabase = await createClient()

  const [configRes, periodsRes, transfersRes] = await Promise.all([
    supabase
      .from('contribution_configs')
      .select('id, model, effective_from, contribution_shares(user_id, ratio_bp, fixed_amount_paise)')
      .eq('household_id', household.id)
      .lte('effective_from', todayIso(household.timezone))
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('settlement_periods')
      .select('id, starts_on, ends_on, closed_at')
      .eq('household_id', household.id)
      .not('closed_at', 'is', null)
      .order('starts_on', { ascending: false }),
    supabase
      .from('settlement_transfers')
      .select('id, from_user_id, to_user_id, amount_paise, occurred_on')
      .eq('household_id', household.id)
      .is('deleted_at', null)
      .order('occurred_on', { ascending: false })
      .limit(20),
  ])

  const config = configRes.data as {
    id: string
    model: ContributionModel
    effective_from: string
    contribution_shares: { user_id: string; ratio_bp: number | null; fixed_amount_paise: number | null }[]
  } | null

  const currentShares = Object.fromEntries(
    (config?.contribution_shares ?? []).map((s) => [
      s.user_id,
      { ratioBp: s.ratio_bp, fixedAmountPaise: s.fixed_amount_paise },
    ]),
  )

  const nextEffectiveFrom = addMonths(
    periodStartFor(todayIso(household.timezone), household.period_start_day),
    1,
  )

  const closedPeriods = ((periodsRes.data ?? []) as {
    id: string
    starts_on: string
    ends_on: string
    closed_at: string
  }[]).map((p) => ({
    id: p.id,
    label: formatPeriodLabel(p.starts_on, p.ends_on),
    closedAt: p.closed_at,
  }))

  return (
    <main className="space-y-4 px-4 pt-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Settings</h1>

      <Section title="Household">
        <dl className="space-y-2 text-sm">
          <Row label="Name" value={household.name} />
          <Row
            label="Period"
            value={
              household.period_start_day === 1
                ? 'Calendar month'
                : `${household.period_start_day}th to ${household.period_start_day - 1}th`
            }
          />
          <Row label="Currency" value={household.currency} />
        </dl>
      </Section>

      <Section title="Members">
        <ul className="space-y-1 text-sm text-ink-800">
          {members.map((m) => (
            <li key={m.id} className="flex justify-between">
              <span>
                {m.display_name}
                {m.id === me.id && <span className="ml-2 text-ink-400">you</span>}
              </span>
              <span className="text-ink-400">{m.email}</span>
            </li>
          ))}
        </ul>

        {!partner && (
          <div className="mt-4">
            <p className="mb-3 text-sm text-ink-500">
              Settlement only means something once you are both logging. Invite your partner:
            </p>
            <InvitePanel householdName={household.name} />
          </div>
        )}

        <div className="mt-4 border-t border-ink-200 pt-4">
          <LeaveHouseholdButton />
        </div>
      </Section>

      <Section
        title="How you split household costs"
        subtitle={config ? `Currently: ${describeModel(config.model)}` : undefined}
      >
        <ContributionEditor
          members={members}
          meId={me.id}
          currentModel={(config?.model ?? 'equal') as 'equal' | 'ratio' | 'fixed'}
          currentShares={currentShares}
          nextEffectiveFrom={nextEffectiveFrom}
        />
      </Section>

      <Section title="Categories">
        <CategoryManager categories={categories} />
      </Section>

      <Section title="Payment methods">
        <PaymentMethodManager methods={paymentMethods} />
      </Section>

      <Section title="Payments between you">
        <SettlementHistory
          transfers={
            (transfersRes.data ?? []) as {
              id: string
              from_user_id: string
              to_user_id: string
              amount_paise: number
              occurred_on: string
            }[]
          }
          members={members}
          meId={me.id}
        />
      </Section>

      <Section
        title="Settled periods"
        subtitle="Reopening unlocks a period so old transactions can be corrected."
      >
        <ClosedPeriods periods={closedPeriods} />
      </Section>

      <Section title="Your data" subtitle="Everything, any time, either of you.">
        <Link
          href="/api/export"
          className="block rounded-xl border border-ink-200 px-4 py-2.5 text-center font-medium text-ink-800"
        >
          Download everything as CSV
        </Link>
      </Section>

      <form action={signOut} className="pb-4">
        <button
          type="submit"
          className="w-full rounded-xl border border-ink-200 bg-ink-100 px-4 py-3 font-medium text-owing-500"
        >
          Sign out
        </button>
      </form>
    </main>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-ink-100 p-5">
      <h2 className="font-extrabold text-ink-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-800">{value}</dd>
    </div>
  )
}

function describeModel(model: ContributionModel) {
  if (model === 'equal') return 'split equally'
  if (model === 'ratio') return 'split by ratio'
  return 'fixed amounts each'
}
