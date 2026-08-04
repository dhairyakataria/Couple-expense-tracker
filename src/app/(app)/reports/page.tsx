import Link from 'next/link'
import { loadSettlement, loadTransactions, requireHousehold } from '@/lib/data'
import { formatPeriodLabel, periodEndFor, periodStartFor, todayIso } from '@/lib/settlement/periods'
import { formatPaise } from '@/lib/money'
import StatTile from '@/components/StatTile'
import TopCategories, { type CategorySlice } from '@/components/TopCategories'
import ContributionProgress from '@/components/ContributionProgress'
import PeriodPicker from '@/components/PeriodPicker'
import ClosePeriodButton from '@/components/ClosePeriodButton'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const params = await searchParams
  const { household, members, me } = await requireHousehold()
  const { result } = await loadSettlement(household.id, members)

  const today = todayIso(household.timezone)
  const currentStart = periodStartFor(today, household.period_start_day)

  const ordered = [...result.periods].sort((a, b) => (a.startsOn > b.startsOn ? -1 : 1))
  const selected =
    ordered.find((p) => p.startsOn === params.period) ??
    ordered.find((p) => p.startsOn === currentStart) ??
    ordered[0]

  if (!selected) {
    return (
      <main className="px-4 pt-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Reports</h1>
        <p className="mt-4 text-ink-500">Log a few transactions and reports will appear here.</p>
      </main>
    )
  }

  const endsOn = periodEndFor(selected.startsOn)
  const txns = await loadTransactions(household.id, {
    from: selected.startsOn,
    to: endsOn,
    limit: 2000,
  })

  const sum = (fn: (t: (typeof txns)[number]) => boolean) =>
    txns.filter(fn).reduce((acc, t) => acc + t.amount_paise, 0)

  const byCategory = new Map<string, number>()
  for (const t of txns) {
    const key = t.category?.name ?? 'Uncategorised'
    byCategory.set(key, (byCategory.get(key) ?? 0) + t.amount_paise)
  }
  const categories: CategorySlice[] = [...byCategory.entries()]
    .map(([name, paise]) => ({ name, paise }))
    .filter((s) => s.paise > 0)
    .sort((a, b) => b.paise - a.paise)

  const exportHref = `/api/export?from=${selected.startsOn}&to=${endsOn}`

  return (
    <main className="space-y-4 px-4 pt-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Reports</h1>
        <p className="text-sm text-ink-500">{formatPeriodLabel(selected.startsOn, endsOn)}</p>
      </header>

      <PeriodPicker
        periods={ordered.map((p) => ({
          startsOn: p.startsOn,
          label: formatPeriodLabel(p.startsOn, p.endsOn),
          closed: p.closed,
        }))}
        selected={selected.startsOn}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Household" paise={selected.householdTotalPaise} />
        <StatTile label="Everything" paise={txns.reduce((a, t) => a + t.amount_paise, 0)} />
        <StatTile label="Personal" paise={sum((t) => t.txn_type === 'personal')} tone="muted" />
        <StatTile label="For each other" paise={sum((t) => t.txn_type === 'partner')} tone="muted" />
      </div>

      <ContributionProgress lines={selected.lines} members={members} meId={me.id} />

      <section className="rounded-2xl bg-white p-5">
        <h2 className="mb-3 font-medium text-ink-900">By person</h2>
        <ul className="space-y-2 text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex justify-between">
              <span className="text-ink-700">{m.id === me.id ? 'You' : m.display_name}</span>
              <span className="tabular font-medium text-ink-900">
                {formatPaise(sum((t) => t.payer_user_id === m.id))} paid
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-5">
        <h2 className="mb-3 font-medium text-ink-900">By category</h2>
        <TopCategories slices={categories} />
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-5">
        <h2 className="font-medium text-ink-900">This period</h2>
        {selected.closed ? (
          <p className="text-sm text-ink-500">
            Settled and locked. Reopen it from Settings if something needs correcting.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-500">
              Closing locks these transactions against edits. It does not clear anyone&rsquo;s
              balance — only an actual payment does that.
            </p>
            <ClosePeriodButton periodId={selected.periodId} />
          </>
        )}
        <Link
          href={exportHref}
          className="block rounded-xl border border-ink-200 px-4 py-2.5 text-center font-medium text-ink-800"
        >
          Download as CSV
        </Link>
      </section>
    </main>
  )
}
