import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { calculateSettlement } from '@/lib/settlement/engine'
import type {
  ContributionConfig,
  PeriodRef,
  SettlementResult,
  SettlementSplit,
  TransferRow,
} from '@/lib/settlement/types'
import type {
  Category,
  Household,
  HouseholdContext,
  PaymentMethod,
  Profile,
  SettlementPeriodRow,
  TransactionWithRefs,
} from '@/types/app'

/**
 * Wrapped in React's `cache()` so the layout and its page can both call this
 * (and requireHousehold below) without doubling the auth round trip — Next.js
 * only dedupes plain fetch() calls automatically, not arbitrary async
 * functions like these Supabase calls.
 *
 * Middleware already calls `supabase.auth.getUser()` for this exact request —
 * a real network round trip to the Auth server to verify the token — and
 * stashes the verified id/email on request headers. We trust that header
 * here instead of paying for a second identical round trip. If it is ever
 * missing (a code path that somehow bypassed middleware) we fall back to
 * verifying directly, so this is never less safe, just faster on the common
 * path.
 */
export const requireUser = cache(async (): Promise<{ id: string; email: string | null }> => {
  const h = await headers()
  const headerId = h.get('x-user-id')
  if (headerId) return { id: headerId, email: h.get('x-user-email') || null }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { id: user.id, email: user.email ?? null }
})

/**
 * Loads the signed-in user's household and everything the entry form needs.
 * Redirects to onboarding when the user has no household yet.
 */
export const requireHousehold = cache(async (): Promise<HouseholdContext> => {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id, households(*)')
    .eq('user_id', user.id)
    .is('left_at', null)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership) redirect('/onboarding')

  const household = (membership as unknown as { households: Household }).households
  const householdId = household.id

  const [membersRes, categoriesRes, methodsRes] = await Promise.all([
    supabase
      .from('household_members')
      .select('user_id, profiles(id, display_name, email, avatar_url)')
      .eq('household_id', householdId)
      .is('left_at', null),
    supabase
      .from('categories')
      .select('*')
      .eq('household_id', householdId)
      .is('archived_at', null)
      .order('sort_order'),
    supabase
      .from('payment_methods')
      .select('*')
      .eq('household_id', householdId)
      .is('archived_at', null)
      .order('created_at'),
  ])

  const members = ((membersRes.data ?? []) as unknown as { profiles: Profile }[])
    .map((r) => r.profiles)
    .filter(Boolean)

  const me = members.find((m) => m.id === user.id) ?? {
    id: user.id,
    display_name: user.email?.split('@')[0] ?? 'You',
    email: user.email ?? null,
    avatar_url: null,
  }

  return {
    household,
    members,
    me,
    partner: members.find((m) => m.id !== user.id) ?? null,
    categories: (categoriesRes.data ?? []) as Category[],
    paymentMethods: (methodsRes.data ?? []) as PaymentMethod[],
  }
})

/**
 * Pulls every settlement input for a household and runs the engine.
 *
 * For a two-person household this is a few thousand rows a year, so loading
 * the full history is cheaper and far simpler than incremental aggregation.
 * Revisit only if a household ever crosses ~50k transactions.
 */
export async function loadSettlement(
  householdId: string,
  members: Profile[],
): Promise<{ result: SettlementResult; periods: SettlementPeriodRow[] }> {
  const supabase = await createClient()

  const [periodsRes, configsRes, splitsRes, transfersRes] = await Promise.all([
    supabase
      .from('settlement_periods')
      .select('*')
      .eq('household_id', householdId)
      .order('starts_on'),
    supabase
      .from('contribution_configs')
      .select('id, model, effective_from, contribution_shares(user_id, ratio_bp, fixed_amount_paise)')
      .eq('household_id', householdId)
      .order('effective_from'),
    supabase
      .from('transactions')
      .select(
        'id, settlement_period_id, occurred_on, amount_paise, payer_user_id, beneficiary_kind, beneficiary_user_id, is_reimbursable, payment_methods(is_joint)',
      )
      .eq('household_id', householdId)
      .is('deleted_at', null),
    supabase
      .from('settlement_transfers')
      .select('id, from_user_id, to_user_id, amount_paise')
      .eq('household_id', householdId)
      .is('deleted_at', null),
  ])

  const periods = (periodsRes.data ?? []) as SettlementPeriodRow[]

  const periodRefs: PeriodRef[] = periods.map((p) => ({
    id: p.id,
    startsOn: p.starts_on,
    endsOn: p.ends_on,
    closedAt: p.closed_at,
  }))

  type RawConfig = {
    id: string
    model: ContributionConfig['model']
    effective_from: string
    contribution_shares: { user_id: string; ratio_bp: number | null; fixed_amount_paise: number | null }[]
  }

  const configs: ContributionConfig[] = ((configsRes.data ?? []) as unknown as RawConfig[]).map((c) => ({
    id: c.id,
    model: c.model,
    effectiveFrom: c.effective_from,
    shares: (c.contribution_shares ?? []).map((s) => ({
      userId: s.user_id,
      ratioBp: s.ratio_bp,
      fixedAmountPaise: s.fixed_amount_paise,
    })),
  }))

  type RawSplit = {
    id: string
    settlement_period_id: string | null
    occurred_on: string
    amount_paise: number
    payer_user_id: string
    beneficiary_kind: 'person' | 'household'
    beneficiary_user_id: string | null
    is_reimbursable: boolean
    payment_methods: { is_joint: boolean } | null
  }

  const splits: SettlementSplit[] = ((splitsRes.data ?? []) as unknown as RawSplit[]).map((t) => ({
    transactionId: t.id,
    settlementPeriodId: t.settlement_period_id,
    occurredOn: t.occurred_on,
    amountPaise: t.amount_paise,
    payerUserId: t.payer_user_id,
    beneficiaryKind: t.beneficiary_kind,
    beneficiaryUserId: t.beneficiary_user_id,
    isReimbursable: t.is_reimbursable,
    paidFromJoint: t.payment_methods?.is_joint ?? false,
  }))

  const transfers: TransferRow[] = ((transfersRes.data ?? []) as unknown as {
    id: string
    from_user_id: string
    to_user_id: string
    amount_paise: number
  }[]).map((t) => ({
    id: t.id,
    fromUserId: t.from_user_id,
    toUserId: t.to_user_id,
    amountPaise: t.amount_paise,
  }))

  const result = calculateSettlement({
    members: members.map((m) => ({ userId: m.id, displayName: m.display_name })),
    periods: periodRefs,
    configs,
    splits,
    transfers,
  })

  return { result, periods }
}

export const TRANSACTION_SELECT =
  '*, category:categories(id, name), payment_method:payment_methods(id, label, is_joint)'

export async function loadTransactions(
  householdId: string,
  opts: {
    limit?: number
    from?: string
    to?: string
    payerId?: string
    txnType?: string
    categoryId?: string
    search?: string
  } = {},
): Promise<TransactionWithRefs[]> {
  const supabase = await createClient()

  let query = supabase
    .from('transactions')
    .select(TRANSACTION_SELECT)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)

  if (opts.from) query = query.gte('occurred_on', opts.from)
  if (opts.to) query = query.lte('occurred_on', opts.to)
  if (opts.payerId) query = query.eq('payer_user_id', opts.payerId)
  if (opts.txnType) query = query.eq('txn_type', opts.txnType)
  if (opts.categoryId) query = query.eq('category_id', opts.categoryId)
  if (opts.search) {
    const term = `%${opts.search}%`
    query = query.or(`merchant.ilike.${term},notes.ilike.${term}`)
  }

  const { data } = await query
  return (data ?? []) as unknown as TransactionWithRefs[]
}

/**
 * The category each merchant was last tagged with.
 *
 * This is what makes categorisation feel automatic without ever forcing it:
 * type "DMart", the category fills in, and the user can ignore or change it.
 */
export async function loadMerchantHints(householdId: string): Promise<Record<string, string>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('transactions')
    .select('merchant, category_id, created_at')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .not('merchant', 'is', null)
    .not('category_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300)

  const hints: Record<string, string> = {}
  for (const row of (data ?? []) as { merchant: string; category_id: string }[]) {
    const key = row.merchant.trim().toLowerCase()
    if (key && !(key in hints)) hints[key] = row.category_id
  }
  return hints
}

/** Merchants the household actually uses, most recent first. Powers autocomplete. */
export async function loadRecentMerchants(householdId: string, limit = 40): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('transactions')
    .select('merchant')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .not('merchant', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300)

  const seen = new Set<string>()
  const ordered: string[] = []
  for (const row of (data ?? []) as { merchant: string }[]) {
    const name = row.merchant?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push(name)
    if (ordered.length >= limit) break
  }
  return ordered
}
