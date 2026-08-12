import Link from 'next/link'
import { formatPaise } from '@/lib/money'
import { formatDayLabel } from '@/lib/settlement/periods'
import type { Profile, TransactionWithRefs } from '@/types/app'

const TYPE_LABEL: Record<string, string> = {
  household: 'Household',
  personal: 'Personal',
  partner: 'For partner',
}

export function TransactionRow({
  txn,
  members,
  meId,
}: {
  txn: TransactionWithRefs
  members: Profile[]
  meId: string
}) {
  const payer = members.find((m) => m.id === txn.payer_user_id)
  const beneficiary = members.find((m) => m.id === txn.beneficiary_user_id)
  const isRefund = txn.amount_paise < 0

  const title =
    txn.merchant?.trim() ||
    txn.category?.name ||
    (txn.txn_type === 'household' ? 'Household expense' : 'Expense')

  const detail: string[] = []
  if (txn.txn_type === 'partner' && beneficiary) {
    detail.push(txn.is_reimbursable ? `${beneficiary.display_name} owes this` : `Gift for ${beneficiary.display_name}`)
  } else {
    detail.push(TYPE_LABEL[txn.txn_type] ?? '')
  }
  if (txn.category?.name && txn.merchant) detail.push(txn.category.name)
  detail.push(payer?.id === meId ? 'You paid' : `${payer?.display_name ?? 'Someone'} paid`)
  if (txn.payment_method?.is_joint) detail.push('Joint')

  return (
    <Link
      href={`/transactions/${txn.id}`}
      className="flex items-center gap-3 px-4 py-3 transition active:bg-ink-200/60"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-ink-900">{title}</p>
          {txn.is_adjustment && (
            <span className="shrink-0 bg-ink-200 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
              Adjustment
            </span>
          )}
        </div>
        <p className="truncate text-sm text-ink-500">{detail.filter(Boolean).join(' · ')}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className={`tabular font-semibold ${isRefund ? 'text-owed-500' : 'text-ink-900'}`}>
          {isRefund ? '+' : ''}
          {formatPaise(Math.abs(txn.amount_paise))}
        </p>
        <p className="text-xs text-ink-400">{formatDayLabel(txn.occurred_on)}</p>
      </div>
    </Link>
  )
}

export default function TransactionList({
  transactions,
  members,
  meId,
  emptyMessage = 'Nothing logged yet.',
}: {
  transactions: TransactionWithRefs[]
  members: Profile[]
  meId: string
  emptyMessage?: string
}) {
  if (transactions.length === 0) {
    return <p className="px-4 py-8 text-center text-ink-400">{emptyMessage}</p>
  }

  return (
    <ul className="divide-y divide-ink-200">
      {transactions.map((t) => (
        <li key={t.id}>
          <TransactionRow txn={t} members={members} meId={meId} />
        </li>
      ))}
    </ul>
  )
}
