import Link from 'next/link'
import { paiseToRupeeString } from '@/lib/money'
import { formatDayLabel } from '@/lib/settlement/periods'
import type { Profile, TransactionWithRefs } from '@/types/app'

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  personal: 'Personal',
  partner: 'For partner',
}

export default function TransactionDetail({
  txn,
  members,
  me,
}: {
  txn: TransactionWithRefs
  members: Profile[]
  me: Profile
}) {
  const payer = members.find((m) => m.id === txn.payer_user_id)
  const beneficiary = members.find((m) => m.id === txn.beneficiary_user_id)
  const isRefund = txn.amount_paise < 0

  const typeValue =
    txn.txn_type === 'partner' && beneficiary
      ? txn.is_reimbursable
        ? `${beneficiary.display_name} owes this back`
        : `Gift for ${beneficiary.display_name}`
      : (TYPE_LABEL[txn.txn_type] ?? txn.txn_type)

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col">
      <div className="px-4 pt-6">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-3xl font-medium text-ink-400">₹</span>
          <span className="tabular text-5xl font-semibold tracking-tight text-ink-900">
            {paiseToRupeeString(Math.abs(txn.amount_paise))}
          </span>
        </div>
        {isRefund && (
          <p className="mt-1 text-center text-sm font-medium text-owed-500">
            Refund / money back
          </p>
        )}
        <p className="mt-1 text-center text-sm text-ink-500">{formatDayLabel(txn.occurred_on)}</p>

        <div className="mt-6 divide-y divide-ink-200 overflow-hidden bg-ink-100">
          <DetailRow label="Type" value={typeValue} />
          <DetailRow label="Paid by" value={payer?.id === me.id ? 'You' : (payer?.display_name ?? 'Someone')} />
          {txn.merchant && <DetailRow label="Merchant" value={txn.merchant} />}
          <DetailRow label="Category" value={txn.category?.name ?? 'No category'} />
          <DetailRow
            label="Paid with"
            value={
              txn.payment_method
                ? `${txn.payment_method.label}${txn.payment_method.is_joint ? ' (joint)' : ''}`
                : 'Not recorded'
            }
          />
          {txn.notes && <DetailRow label="Notes" value={txn.notes} wrap />}
        </div>
      </div>

      {!txn.deleted_at && (
        <div className="mt-auto px-4 pb-4">
          <Link
            href={`/transactions/${txn.id}?edit=1`}
            className="block w-full rounded-xl bg-brand-500 px-4 py-3.5 text-center text-lg font-medium text-white transition active:opacity-90"
          >
            Edit transaction
          </Link>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-sm text-ink-500">{label}</span>
      <span className={`text-sm font-medium text-ink-900 ${wrap ? 'text-right' : 'truncate text-right'}`}>
        {value}
      </span>
    </div>
  )
}
