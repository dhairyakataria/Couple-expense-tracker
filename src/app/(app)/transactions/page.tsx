import { Suspense } from 'react'
import { loadTransactions, requireHousehold } from '@/lib/data'
import TransactionList from '@/components/TransactionList'
import TransactionFilters from '@/components/TransactionFilters'
import { formatPaise } from '@/lib/money'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    type?: string
    payer?: string
    category?: string
    from?: string
    to?: string
    adjusted?: string
  }>
}) {
  const params = await searchParams
  const { household, members, me, categories } = await requireHousehold()

  const transactions = await loadTransactions(household.id, {
    search: params.q,
    txnType: params.type,
    payerId: params.payer,
    categoryId: params.category,
    from: params.from,
    to: params.to,
    limit: 300,
  })

  const total = transactions.reduce((sum, t) => sum + t.amount_paise, 0)

  return (
    <main className="space-y-4 px-4 pt-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">History</h1>
        <p className="tabular text-sm text-ink-500">
          {transactions.length} · {formatPaise(total)}
        </p>
      </header>

      {params.adjusted === '1' && (
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          That month is already settled, so this went into the current month as an adjustment.
          Its original date is kept on the transaction.
        </p>
      )}

      <Suspense fallback={<div className="h-28" />}>
        <TransactionFilters members={members} categories={categories} meId={me.id} />
      </Suspense>

      <section className="overflow-hidden rounded-2xl bg-ink-100">
        <TransactionList
          transactions={transactions}
          members={members}
          meId={me.id}
          emptyMessage="Nothing matches those filters."
        />
      </section>
    </main>
  )
}
