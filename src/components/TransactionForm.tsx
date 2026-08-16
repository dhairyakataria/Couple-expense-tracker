'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Keypad from '@/components/Keypad'
import { parseRupeesToPaise } from '@/lib/money'
import { addDays, formatDayLabel } from '@/lib/settlement/periods'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type EntryType,
} from '@/app/actions/transactions'
import type { Category, PaymentMethod, Profile } from '@/types/app'

export interface TransactionFormValues {
  amount: string
  entryType: EntryType
  occurredOn: string
  payerUserId: string
  categoryId: string | null
  paymentMethodId: string | null
  merchant: string
  notes: string
  isRefund: boolean
}

export default function TransactionForm({
  members,
  me,
  partner,
  categories,
  paymentMethods,
  merchants,
  today,
  initial,
  transactionId,
  merchantCategoryHints,
}: {
  members: Profile[]
  me: Profile
  partner: Profile | null
  categories: Category[]
  paymentMethods: PaymentMethod[]
  merchants: string[]
  today: string
  initial?: Partial<TransactionFormValues>
  transactionId?: string
  merchantCategoryHints?: Record<string, string>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(Boolean(transactionId))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [v, setV] = useState<TransactionFormValues>({
    amount: initial?.amount ?? '',
    entryType: initial?.entryType ?? 'household',
    occurredOn: initial?.occurredOn ?? today,
    payerUserId: initial?.payerUserId ?? me.id,
    categoryId: initial?.categoryId ?? null,
    paymentMethodId: initial?.paymentMethodId ?? null,
    merchant: initial?.merchant ?? '',
    notes: initial?.notes ?? '',
    isRefund: initial?.isRefund ?? false,
  })

  const set = <K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }))

  const paise = parseRupeesToPaise(v.amount) ?? 0
  const canSave = paise > 0 && !pending

  const chips = useMemo(() => {
    const base: { value: EntryType; label: string; sub?: string }[] = [
      { value: 'household', label: 'Household' },
      { value: 'personal', label: 'Personal' },
    ]
    if (partner) {
      base.push(
        { value: 'partner_gift', label: `For ${partner.display_name}`, sub: 'gift' },
        { value: 'partner_owed', label: `For ${partner.display_name}`, sub: 'owes me' },
      )
    }
    return base
  }, [partner])

  /** Pre-fills the category from what this merchant was tagged as last time. */
  const pickMerchant = (name: string) => {
    set('merchant', name)
    const hinted = merchantCategoryHints?.[name.toLowerCase()]
    if (hinted && !v.categoryId) set('categoryId', hinted)
  }

  const save = () => {
    if (paise <= 0) {
      setError('Enter an amount greater than ₹0.')
      return
    }
    start(async () => {
      setError(null)
      const payload = {
        amountPaise: paise,
        occurredOn: v.occurredOn,
        entryType: v.entryType,
        payerUserId: v.payerUserId,
        partnerUserId: partner?.id ?? null,
        categoryId: v.categoryId,
        paymentMethodId: v.paymentMethodId,
        merchant: v.merchant.trim() || null,
        notes: v.notes.trim() || null,
        isRefund: v.isRefund,
      }

      const result = transactionId
        ? await updateTransaction(transactionId, payload)
        : await createTransaction(payload)

      if (result.error) {
        setError(result.error)
        return
      }

      if (!transactionId && result.isAdjustment) {
        setError(null)
        router.push('/transactions?adjusted=1')
        return
      }

      router.push(transactionId ? `/transactions/${transactionId}` : '/')
    })
  }

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col">
      <div className="px-4 pt-6">
        {/* Tapping the amount brings the keypad back when details are open,
            so the number is never stranded behind a disclosure. */}
        <button
          type="button"
          onClick={() => setShowDetails(false)}
          className="flex w-full items-baseline justify-center gap-1"
          aria-label="Edit amount"
        >
          <span className="text-3xl font-extrabold text-brand-700">₹</span>
          <span className="tabular text-5xl font-extrabold tracking-tight text-ink-900">
            {v.amount || '0'}
          </span>
        </button>
        {v.isRefund && (
          <p className="mt-1 text-center text-sm font-medium text-owed-500">Recording a refund</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          {chips.map((chip) => {
            const active = v.entryType === chip.value
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => set('entryType', chip.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  active ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-ink-100'
                }`}
              >
                <span className="block truncate text-sm font-medium text-ink-900">{chip.label}</span>
                {chip.sub && (
                  <span
                    className={`block text-xs ${
                      chip.value === 'partner_owed' ? 'text-owing-500' : 'text-ink-500'
                    }`}
                  >
                    {chip.sub}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <DateChip label="Today" active={v.occurredOn === today} onClick={() => set('occurredOn', today)} />
          <DateChip
            label="Yesterday"
            active={v.occurredOn === addDays(today, -1)}
            onClick={() => set('occurredOn', addDays(today, -1))}
          />
          <label className="shrink-0 border border-ink-200 bg-ink-100 px-3 py-1.5 text-sm text-ink-700">
            {v.occurredOn !== today && v.occurredOn !== addDays(today, -1)
              ? formatDayLabel(v.occurredOn, today)
              : 'Pick a date'}
            <input
              type="date"
              value={v.occurredOn}
              max={today}
              onChange={(e) => e.target.value && set('occurredOn', e.target.value)}
              className="sr-only"
            />
          </label>
        </div>

        {merchants.length > 0 && !showDetails && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {merchants.slice(0, 8).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickMerchant(m)}
                className={`shrink-0 border px-3 py-1.5 text-sm transition ${
                  v.merchant.toLowerCase() === m.toLowerCase()
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-ink-200 bg-ink-100 text-ink-700'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowDetails((s) => !s)}
          className="mt-3 flex w-full items-center justify-center gap-1 py-2 text-sm font-medium text-ink-500"
        >
          {showDetails ? 'Hide details' : 'Add details'}
          {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showDetails && (
          <div className="space-y-3 pb-4">
            <Field label="Merchant">
              <input
                value={v.merchant}
                onChange={(e) => set('merchant', e.target.value)}
                onBlur={(e) => pickMerchant(e.target.value)}
                list="merchant-options"
                placeholder="e.g. DMart"
                className="w-full rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
              />
              <datalist id="merchant-options">
                {merchants.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>

            <Field label="Category">
              <select
                value={v.categoryId ?? ''}
                onChange={(e) => set('categoryId', e.target.value || null)}
                className="w-full rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Paid with">
              <select
                value={v.paymentMethodId ?? ''}
                onChange={(e) => set('paymentMethodId', e.target.value || null)}
                className="w-full rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
              >
                <option value="">Not recorded</option>
                {paymentMethods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.is_joint ? ' (joint)' : ''}
                  </option>
                ))}
              </select>
            </Field>

            {members.length > 1 && (
              <Field label="Paid by">
                <div className="flex gap-2">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => set('payerUserId', m.id)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                        v.payerUserId === m.id
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-ink-200 bg-ink-100 text-ink-700'
                      }`}
                    >
                      {m.id === me.id ? 'You' : m.display_name}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Notes">
              <textarea
                value={v.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={2}
                placeholder="Anything worth remembering"
                className="w-full resize-none rounded-xl border border-ink-200 bg-ink-100 px-3 py-2.5 outline-none focus:border-brand-500"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={v.isRefund}
                onChange={(e) => set('isRefund', e.target.checked)}
                className="h-4 w-4 rounded border-ink-300"
              />
              This is money coming back (refund or cashback)
            </label>
          </div>
        )}
      </div>

      <div className="mt-auto space-y-3 px-4 pb-4">
        {error && <p className="text-center text-sm text-owing-500">{error}</p>}

        {!showDetails && <Keypad value={v.amount} onChange={(next) => set('amount', next)} />}

        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="w-full bg-brand-500 px-4 py-3.5 text-lg font-semibold text-ink-50 transition disabled:opacity-40"
        >
          {pending ? 'Saving…' : transactionId ? 'Save changes' : 'Add'}
        </button>

        {transactionId &&
          (confirmDelete ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  start(async () => {
                    const result = await deleteTransaction(transactionId)
                    if (result?.error) setError(result.error)
                    else router.push('/transactions')
                  })
                }
                className="flex-1 rounded-xl bg-owing-500 px-4 py-3 font-medium text-white"
              >
                Delete for good
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-xl border border-ink-200 bg-ink-100 px-4 py-3 font-medium text-ink-700"
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full py-2 text-sm font-medium text-owing-500"
            >
              Delete this transaction
            </button>
          ))}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-ink-600">{label}</label>
      {children}
    </div>
  )
}

function DateChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 border px-3 py-1.5 text-sm transition ${
        active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 bg-ink-100 text-ink-700'
      }`}
    >
      {label}
    </button>
  )
}
