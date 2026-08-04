import Link from 'next/link'
import { loadSettlement, loadTransactions, requireHousehold } from '@/lib/data'
import {
  formatPeriodLabel,
  periodEndFor,
  periodStartFor,
  todayIso,
} from '@/lib/settlement/periods'
import SettlementCard from '@/components/SettlementCard'
import ContributionProgress from '@/components/ContributionProgress'
import StatTile from '@/components/StatTile'
import TrendChart, { type TrendPoint } from '@/components/TrendChart'
import TopCategories, { type CategorySlice } from '@/components/TopCategories'
import TransactionList from '@/components/TransactionList'

export default async function DashboardPage() {
  const { household, members, me, partner } = await requireHousehold()
  const { result } = await loadSettlement(household.id, members)

  const today = todayIso(household.timezone)
  const startsOn = periodStartFor(today, household.period_start_day)
  const endsOn = periodEndFor(startsOn)

  const current =
    result.periods.find((p) => p.startsOn === startsOn) ?? {
      periodId: 'pending',
      startsOn,
      endsOn,
      closed: false,
      configId: null,
      model: null,
      householdTotalPaise: 0,
      jointTotalPaise: 0,
      lines: members.map((m) => ({
        userId: m.id,
        expectedPaise: 0,
        actualPaidPaise: 0,
        deltaPaise: 0,
      })),
    }

  const periodTxns = await loadTransactions(household.id, {
    from: startsOn,
    to: endsOn,
    limit: 1000,
  })

  const sum = (predicate: (t: (typeof periodTxns)[number]) => boolean) =>
    periodTxns.filter(predicate).reduce((acc, t) => acc + t.amount_paise, 0)

  const myPersonal = sum((t) => t.txn_type === 'personal' && t.payer_user_id === me.id)
  const partnerPersonal = partner
    ? sum((t) => t.txn_type === 'personal' && t.payer_user_id === partner.id)
    : 0
  const partnerSpend = sum((t) => t.txn_type === 'partner')
  const total = periodTxns.reduce((acc, t) => acc + t.amount_paise, 0)

  const categoryTotals = new Map<string, number>()
  for (const t of periodTxns) {
    const name = t.category?.name
    if (!name) continue
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + t.amount_paise)
  }
  const topCategories: CategorySlice[] = [...categoryTotals.entries()]
    .map(([name, paise]) => ({ name, paise }))
    .filter((s) => s.paise > 0)
    .sort((a, b) => b.paise - a.paise)
    .slice(0, 5)

  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const trend: TrendPoint[] = result.periods.slice(-6).map((p) => ({
    // Label by the month the period ENDS in, which is the month a
    // salary-cycle household thinks of it as.
    label: MONTH_ABBR[Number(p.endsOn.slice(5, 7)) - 1],
    paise: p.householdTotalPaise,
    current: p.startsOn === startsOn,
  }))

  const recent = periodTxns.slice(0, 5)

  return (
    <main className="space-y-4 px-4 pt-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{household.name}</h1>
          <p className="text-sm text-ink-500">{formatPeriodLabel(startsOn, endsOn)}</p>
        </div>
        {current.closed && (
          <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">
            Settled
          </span>
        )}
      </header>

      <SettlementCard
        headline={result.headline}
        members={members}
        meId={me.id}
        hasPartner={Boolean(partner)}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Household"
          paise={current.householdTotalPaise}
          hint={current.jointTotalPaise > 0 ? 'includes joint account' : undefined}
        />
        <StatTile label="Total spent" paise={total} />
        <StatTile label="Your personal" paise={myPersonal} tone="muted" />
        <StatTile
          label={partner ? `${partner.display_name}'s personal` : 'Their personal'}
          paise={partnerPersonal}
          tone="muted"
        />
      </div>

      {partnerSpend !== 0 && (
        <StatTile
          label="Bought for each other"
          paise={partnerSpend}
          hint="gifts and reimbursables combined"
          tone="muted"
        />
      )}

      <ContributionProgress lines={current.lines} members={members} meId={me.id} />

      <section className="rounded-2xl bg-white p-5">
        <h2 className="mb-2 font-medium text-ink-900">Household spending by month</h2>
        <TrendChart data={trend} />
      </section>

      <section className="rounded-2xl bg-white p-5">
        <h2 className="mb-3 font-medium text-ink-900">Where it went</h2>
        <TopCategories slices={topCategories} />
      </section>

      <section className="overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-medium text-ink-900">Recent</h2>
          <Link href="/transactions" className="text-sm font-medium text-brand-600">
            See all
          </Link>
        </div>
        <div className="mt-2">
          <TransactionList
            transactions={recent}
            members={members}
            meId={me.id}
            emptyMessage="Nothing logged this month yet. Tap + to add the first one."
          />
        </div>
      </section>
    </main>
  )
}
