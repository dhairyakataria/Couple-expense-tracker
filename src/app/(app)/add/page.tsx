import Link from 'next/link'
import { X } from 'lucide-react'
import { loadMerchantHints, loadRecentMerchants, requireHousehold } from '@/lib/data'
import { todayIso } from '@/lib/settlement/periods'
import TransactionForm from '@/components/TransactionForm'

export default async function AddPage() {
  const { household, members, me, partner, categories, paymentMethods } = await requireHousehold()
  const [merchants, hints] = await Promise.all([
    loadRecentMerchants(household.id),
    loadMerchantHints(household.id),
  ])

  return (
    <main>
      <header className="flex items-center justify-between px-4 pt-5">
        <h1 className="text-lg font-semibold text-ink-900">Add a transaction</h1>
        <Link
          href="/"
          aria-label="Close"
          className="rounded-full p-2 text-ink-400 transition active:bg-ink-100"
        >
          <X className="h-5 w-5" />
        </Link>
      </header>

      <TransactionForm
        members={members}
        me={me}
        partner={partner}
        categories={categories}
        paymentMethods={paymentMethods}
        merchants={merchants}
        merchantCategoryHints={hints}
        today={todayIso(household.timezone)}
      />
    </main>
  )
}
