import { NextResponse, type NextRequest } from 'next/server'
import { loadTransactions, requireHousehold } from '@/lib/data'
import { paiseToRupeeString } from '@/lib/money'

/**
 * Full CSV export.
 *
 * Available to either partner at any time, for all household data. This is
 * both a feature and the honest answer to "what happens to this if we split
 * up" — nobody's financial history is trapped in someone else's account.
 */
export async function GET(request: NextRequest) {
  const { household, members } = await requireHousehold()
  const { searchParams } = request.nextUrl

  const transactions = await loadTransactions(household.id, {
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
    limit: 100000,
  })

  const nameOf = (id: string | null) =>
    id ? members.find((m) => m.id === id)?.display_name ?? '' : ''

  const header = [
    'Date',
    'Amount (INR)',
    'Type',
    'Paid by',
    'For',
    'Owed back',
    'Category',
    'Merchant',
    'Payment method',
    'Joint',
    'Notes',
    'Adjustment',
    'Entered by',
    'Entered at',
  ]

  const rows = transactions.map((t) => [
    t.occurred_on,
    paiseToRupeeString(t.amount_paise),
    t.txn_type,
    nameOf(t.payer_user_id),
    t.beneficiary_kind === 'household' ? 'Household' : nameOf(t.beneficiary_user_id),
    t.is_reimbursable ? 'yes' : 'no',
    t.category?.name ?? '',
    t.merchant ?? '',
    t.payment_method?.label ?? '',
    t.payment_method?.is_joint ? 'yes' : 'no',
    t.notes ?? '',
    t.is_adjustment ? 'yes' : 'no',
    nameOf(t.created_by),
    t.created_at,
  ])

  const csv = [header, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n')

  const range = searchParams.get('from') ? `-${searchParams.get('from')}` : ''
  const filename = `together-transactions${range}.csv`

  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function escapeCsv(value: string) {
  const s = String(value ?? '')
  // Guard against spreadsheet formula injection from a merchant or note field.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
