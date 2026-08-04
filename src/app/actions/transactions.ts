'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

/**
 * The four chips a user actually taps. Everything downstream is derived from
 * this one choice, so the stored payer/beneficiary can never disagree with
 * what the user saw on screen.
 */
export const ENTRY_TYPES = ['personal', 'household', 'partner_gift', 'partner_owed'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

const schema = z.object({
  amountPaise: z.number().int().positive('Enter an amount.'),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  entryType: z.enum(ENTRY_TYPES),
  payerUserId: z.string().uuid(),
  partnerUserId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  paymentMethodId: z.string().uuid().nullable().optional(),
  merchant: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  isRefund: z.boolean().optional(),
  refundOfTransactionId: z.string().uuid().nullable().optional(),
})

export type TransactionInput = z.infer<typeof schema>

function beneficiaryFor(input: TransactionInput) {
  switch (input.entryType) {
    case 'household':
      return { beneficiary_kind: 'household' as const, beneficiary_user_id: null, is_reimbursable: false }
    case 'personal':
      return {
        beneficiary_kind: 'person' as const,
        beneficiary_user_id: input.payerUserId,
        is_reimbursable: false,
      }
    case 'partner_gift':
      return {
        beneficiary_kind: 'person' as const,
        beneficiary_user_id: input.partnerUserId ?? null,
        is_reimbursable: false,
      }
    case 'partner_owed':
      return {
        beneficiary_kind: 'person' as const,
        beneficiary_user_id: input.partnerUserId ?? null,
        is_reimbursable: true,
      }
  }
}

async function context() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle()

  if (!data) redirect('/onboarding')
  return { supabase, userId: user.id, householdId: (data as { household_id: string }).household_id }
}

/**
 * Every action returns the same shape. A discriminated union reads nicer in
 * isolation but forces `'error' in result` narrowing at every call site, which
 * is noise the components do not need.
 */
export interface ActionResult {
  error?: string
  id?: string
  isAdjustment?: boolean
}

export async function createTransaction(input: TransactionInput): Promise<ActionResult> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const value = parsed.data
  const beneficiary = beneficiaryFor(value)

  if (beneficiary.beneficiary_kind === 'person' && !beneficiary.beneficiary_user_id) {
    return { error: 'Invite your partner before logging an expense for them.' }
  }

  const { supabase, userId, householdId } = await context()

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      household_id: householdId,
      kind: value.isRefund ? 'refund' : 'expense',
      occurred_on: value.occurredOn,
      amount_paise: value.isRefund ? -value.amountPaise : value.amountPaise,
      payer_user_id: value.payerUserId,
      ...beneficiary,
      category_id: value.categoryId ?? null,
      payment_method_id: value.paymentMethodId ?? null,
      merchant: value.merchant || null,
      notes: value.notes || null,
      refund_of_transaction_id: value.refundOfTransactionId ?? null,
      source: 'manual',
      created_by: userId,
    })
    .select('id, is_adjustment')
    .single()

  if (error) return { error: friendlyError(error.message) }

  revalidatePath('/', 'layout')
  return {
    id: (data as { id: string }).id,
    isAdjustment: (data as { is_adjustment: boolean }).is_adjustment,
  }
}

export async function updateTransaction(
  id: string,
  input: TransactionInput,
): Promise<ActionResult> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const value = parsed.data
  const beneficiary = beneficiaryFor(value)
  const { supabase } = await context()

  const { error } = await supabase
    .from('transactions')
    .update({
      kind: value.isRefund ? 'refund' : 'expense',
      occurred_on: value.occurredOn,
      amount_paise: value.isRefund ? -value.amountPaise : value.amountPaise,
      payer_user_id: value.payerUserId,
      ...beneficiary,
      category_id: value.categoryId ?? null,
      payment_method_id: value.paymentMethodId ?? null,
      merchant: value.merchant || null,
      notes: value.notes || null,
    })
    .eq('id', id)

  if (error) return { error: friendlyError(error.message) }

  revalidatePath('/', 'layout')
  return {}
}

/** Always a soft delete. Nothing in this app is ever truly removed. */
export async function deleteTransaction(id: string): Promise<ActionResult> {
  const { supabase } = await context()
  const { error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: friendlyError(error.message) }
  revalidatePath('/', 'layout')
  return {}
}

export async function restoreTransaction(id: string): Promise<ActionResult> {
  const { supabase } = await context()
  const { error } = await supabase.from('transactions').update({ deleted_at: null }).eq('id', id)
  if (error) return { error: friendlyError(error.message) }
  revalidatePath('/', 'layout')
  return {}
}

/**
 * Logs a refund against an existing transaction, mirroring its type and payer.
 * A partial refund is just a smaller amount.
 */
export async function refundTransaction(
  id: string,
  amountPaise: number,
  occurredOn: string,
): Promise<ActionResult> {
  const { supabase, userId, householdId } = await context()

  const { data: original } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .single()

  if (!original) return { error: 'That transaction no longer exists.' }
  const o = original as {
    amount_paise: number
    payer_user_id: string
    beneficiary_kind: 'person' | 'household'
    beneficiary_user_id: string | null
    is_reimbursable: boolean
    category_id: string | null
    payment_method_id: string | null
    merchant: string | null
  }

  if (amountPaise <= 0 || amountPaise > o.amount_paise) {
    return { error: 'A refund cannot be more than the original amount.' }
  }

  const { error } = await supabase.from('transactions').insert({
    household_id: householdId,
    kind: 'refund',
    occurred_on: occurredOn,
    amount_paise: -amountPaise,
    payer_user_id: o.payer_user_id,
    beneficiary_kind: o.beneficiary_kind,
    beneficiary_user_id: o.beneficiary_user_id,
    is_reimbursable: o.is_reimbursable,
    category_id: o.category_id,
    payment_method_id: o.payment_method_id,
    merchant: o.merchant,
    notes: 'Refund',
    refund_of_transaction_id: id,
    source: 'manual',
    created_by: userId,
  })

  if (error) return { error: friendlyError(error.message) }
  revalidatePath('/', 'layout')
  return {}
}

function friendlyError(message: string) {
  if (message.includes('settled period')) {
    return 'That month is settled. Reopen it from Settings to make changes.'
  }
  if (message.includes('reimbursable_only_on_partner')) {
    return 'Only something bought for your partner can be marked as owed back.'
  }
  return 'Could not save that. Please try again.'
}
