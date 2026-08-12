import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import {
  TRANSACTION_SELECT,
  loadMerchantHints,
  loadRecentMerchants,
  requireHousehold,
} from '@/lib/data'
import { paiseToRupeeString } from '@/lib/money'
import { todayIso } from '@/lib/settlement/periods'
import TransactionForm from '@/components/TransactionForm'
import TransactionDetail from '@/components/TransactionDetail'
import AuditTrail from '@/components/AuditTrail'
import type { AuditEntry, TransactionWithRefs } from '@/types/app'
import type { EntryType } from '@/app/actions/transactions'

export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const { id } = await params
  const { edit } = await searchParams
  const isEditing = edit === '1'
  const { household, members, me, partner, categories, paymentMethods } = await requireHousehold()
  const supabase = await createClient()

  const { data } = await supabase
    .from('transactions')
    .select(TRANSACTION_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  const txn = data as unknown as TransactionWithRefs

  // Editing needs merchant autocomplete data; viewing does not, so skip the
  // extra queries when we're just showing the details.
  const [merchants, hints, auditRes] = await Promise.all([
    isEditing ? loadRecentMerchants(household.id) : Promise.resolve([]),
    isEditing ? loadMerchantHints(household.id) : Promise.resolve({}),
    supabase
      .from('audit_log')
      .select('id, actor_user_id, entity_type, entity_id, action, before, after, created_at')
      .eq('entity_type', 'transaction')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const entryType: EntryType =
    txn.txn_type === 'household'
      ? 'household'
      : txn.txn_type === 'personal'
        ? 'personal'
        : txn.is_reimbursable
          ? 'partner_owed'
          : 'partner_gift'

  return (
    <main>
      <header className="flex items-center justify-between gap-2 px-2 pt-5">
        <div className="flex items-center gap-2">
          <Link
            href={isEditing ? `/transactions/${id}` : '/transactions'}
            aria-label="Back"
            className="rounded-full p-2 text-ink-500 transition active:bg-ink-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold text-ink-900">
            {isEditing ? 'Edit transaction' : 'Transaction'}
          </h1>
        </div>
        {!isEditing && !txn.deleted_at && (
          <Link
            href={`/transactions/${id}?edit=1`}
            className="mr-1 rounded-full px-3 py-1.5 text-sm font-medium text-brand-600 transition active:bg-brand-50"
          >
            Edit
          </Link>
        )}
      </header>

      {txn.deleted_at && (
        <p className="mx-4 mt-3 rounded-xl bg-ink-100 px-4 py-3 text-sm text-ink-600">
          This transaction was deleted. It no longer counts towards any total.
        </p>
      )}

      {txn.is_adjustment && (
        <p className="mx-4 mt-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Dated {txn.occurred_on}, but that month was already settled — so it sits in the current
          month as an adjustment.
        </p>
      )}

      {isEditing ? (
        <TransactionForm
          transactionId={txn.id}
          members={members}
          me={me}
          partner={partner}
          categories={categories}
          paymentMethods={paymentMethods}
          merchants={merchants}
          merchantCategoryHints={hints}
          today={todayIso(household.timezone)}
          initial={{
            amount: paiseToRupeeString(Math.abs(txn.amount_paise)),
            entryType,
            occurredOn: txn.occurred_on,
            payerUserId: txn.payer_user_id,
            categoryId: txn.category_id,
            paymentMethodId: txn.payment_method_id,
            merchant: txn.merchant ?? '',
            notes: txn.notes ?? '',
            isRefund: txn.amount_paise < 0,
          }}
        />
      ) : (
        <TransactionDetail txn={txn} members={members} me={me} />
      )}

      <section className="mx-4 mb-4 rounded-2xl bg-white p-5">
        <h2 className="mb-3 font-medium text-ink-900">History</h2>
        <AuditTrail entries={(auditRes.data ?? []) as AuditEntry[]} members={members} meId={me.id} />
      </section>
    </main>
  )
}
