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
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Reports</h1>
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

  const byCategory = new Map<string, { id: string | null; paise: number }>()
  for (const t of txns) {
    const key = t.category?.name ?? 'Uncategorised'
    const existing = byCategory.get(key)
    byCategory.set(key, {
      id: t.category?.id ?? null,
      paise: (existing?.paise ?? 0) + t.amount_paise,
    })
  }
  const categories: CategorySlice[] = [...byCategory.entries()]
    .map(([name, { id, paise }]) => ({ id, name, paise }))
    .filter((s) => s.paise > 0)
    .sort((a, b) => b.paise - a.paise)

  const exportHref = `/api/export?from=${selected.startsOn}&to=${endsOn}`
  const periodQuery = `from=${selected.startsOn}&to=${endsOn}`
  const txnHref = (extra = '') => `/transactions?${periodQuery}${extra}`

  return (
    <main className="space-y-4 px-4 pt-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Reports</h1>
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
        <StatTile
          label="Household"
          paise={selected.householdTotalPaise}
          href={txnHref('&type=household')}
        />
        <StatTile
          label="Everything"
          paise={txns.reduce((a, t) => a + t.amount_paise, 0)}
          href={txnHref()}
        />
        <StatTile
          label="Personal"
          paise={sum((t) => t.txn_type === 'personal')}
          tone="muted"
          href={txnHref('&type=personal')}
        />
        <StatTile
          label="For each other"
          paise={sum((t) => t.txn_type === 'partner')}
          tone="muted"
          href={txnHref('&type=partner')}
        />
      </div>

      <ContributionProgress lines={selected.lines} members={members} meId={me.id} />

      <section className="rounded-2xl bg-ink-100 p-5">
        <h2 className="mb-3 font-extrabold text-ink-900">By person</h2>
        <ul className="text-sm">
          {members.map((m) => (
            <li key={m.id}>
              <Link
                href={txnHref(`&payer=${m.id}`)}
                className="flex justify-between rounded-lg py-1 transition active:opacity-70"
              >
                <span className="text-ink-700">{m.id === me.id ? 'You' : m.display_name}</span>
                <span className="tabular font-medium text-ink-900">
                  {formatPaise(sum((t) => t.payer_user_id === m.id))} paid
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-ink-100 p-5">
        <h2 className="mb-3 font-extrabold text-ink-900">By category</h2>
        <TopCategories
          slices={categories}
          hrefFor={(s) => (s.id ? txnHref(`&category=${s.id}`) : null)}
        />
      </section>

      <section className="space-y-3 rounded-2xl bg-ink-100 p-5">
        <h2 className="font-extrabold text-ink-900">This period</h2>
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
