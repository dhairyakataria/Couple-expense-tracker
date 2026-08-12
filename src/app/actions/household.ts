'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/data'
import { periodStartFor, todayIso, addMonths } from '@/lib/settlement/periods'

export interface ActionResult {
  error?: string
  effectiveFrom?: string
}

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

async function currentHouseholdId() {
  const supabase = await createClient()
  // Middleware already verified this request's token; requireUser() reads
  // that instead of hitting the Auth server a second time per action call.
  const user = await requireUser()

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
 * Creates a shareable invite link.
 *
 * No SMTP is involved on purpose: the link is meant to be sent over WhatsApp,
 * which is how a couple in India will actually do this.
 */
export async function createInvite(
  _prev: { link?: string; error?: string },
  formData: FormData,
): Promise<{ link?: string; error?: string }> {
  const email = z
    .string()
    .email()
    .safeParse(String(formData.get('email') ?? '').trim())

  if (!email.success) return { error: 'Enter your partner’s email address.' }

  const { supabase, userId, householdId } = await currentHouseholdId()

  const { data, error } = await supabase
    .from('household_invites')
    .insert({ household_id: householdId, email: email.data, invited_by: userId })
    .select('token')
    .single()

  if (error || !data) return { error: error?.message ?? 'Could not create the invitation.' }

  revalidatePath('/settings')
  return { link: `${await siteUrl()}/invite/${(data as { token: string }).token}` }
}

export async function acceptInvite(token: string): Promise<ActionResult> {
  const supabase = await createClient()
  const h = await headers()
  if (!h.get('x-user-id')) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)

  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/')
}

const contributionSchema = z.object({
  model: z.enum(['equal', 'ratio', 'fixed']),
  shares: z
    .array(
      z.object({
        userId: z.string().uuid(),
        ratioBp: z.number().int().min(0).max(10000).nullable(),
        fixedAmountPaise: z.number().int().min(0).nullable(),
      }),
    )
    .min(1),
})

/**
 * Records a new contribution configuration.
 *
 * Always effective from the START of the next period. Changing the split
 * halfway through a month would mean a single period computed under two
 * different rules, which neither partner could verify by hand.
 */
export async function updateContribution(
  input: z.infer<typeof contributionSchema>,
): Promise<ActionResult> {
  const parsed = contributionSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  if (parsed.data.model === 'ratio') {
    const total = parsed.data.shares.reduce((sum, s) => sum + (s.ratioBp ?? 0), 0)
    if (total !== 10000) return { error: 'The two shares need to add up to 100%.' }
  }

  const { supabase, userId, householdId } = await currentHouseholdId()

  const { data: household } = await supabase
    .from('households')
    .select('period_start_day')
    .eq('id', householdId)
    .single()

  const startDay = (household as { period_start_day: number } | null)?.period_start_day ?? 1
  const currentStart = periodStartFor(todayIso(), startDay)
  const effectiveFrom = addMonths(currentStart, 1)

  const { data: config, error } = await supabase
    .from('contribution_configs')
    .upsert(
      {
        household_id: householdId,
        model: parsed.data.model,
        effective_from: effectiveFrom,
        created_by: userId,
      },
      { onConflict: 'household_id,effective_from' },
    )
    .select('id')
    .single()

  if (error || !config) return { error: error?.message ?? 'Could not save the split.' }

  const configId = (config as { id: string }).id
  await supabase.from('contribution_shares').delete().eq('config_id', configId)
  await supabase.from('contribution_shares').insert(
    parsed.data.shares.map((s) => ({
      config_id: configId,
      user_id: s.userId,
      ratio_bp: s.ratioBp,
      fixed_amount_paise: s.fixedAmountPaise,
    })),
  )

  revalidatePath('/', 'layout')
  return { effectiveFrom }
}

export async function updateHouseholdName(name: string): Promise<ActionResult> {
  const { supabase, householdId } = await currentHouseholdId()
  const trimmed = name.trim().slice(0, 60)
  if (!trimmed) return { error: 'Name cannot be empty.' }
  await supabase.from('households').update({ name: trimmed }).eq('id', householdId)
  revalidatePath('/', 'layout')
  return {}
}

export async function updateDisplayName(name: string): Promise<ActionResult> {
  const supabase = await createClient()
  const user = await requireUser()
  const trimmed = name.trim().slice(0, 60)
  if (!trimmed) return { error: 'Name cannot be empty.' }
  await supabase.from('profiles').update({ display_name: trimmed }).eq('id', user.id)
  revalidatePath('/', 'layout')
  return {}
}

/** Ensures the current period row exists, so the dashboard is never empty. */
export async function ensureCurrentPeriod() {
  const { supabase, householdId } = await currentHouseholdId()
  await supabase.rpc('get_or_create_period', { p_household_id: householdId, d: todayIso() })
}

export async function addCategory(name: string): Promise<ActionResult> {
  const { supabase, householdId } = await currentHouseholdId()
  const trimmed = name.trim().slice(0, 40)
  if (!trimmed) return { error: 'Give the category a name.' }
  const { error } = await supabase
    .from('categories')
    .insert({ household_id: householdId, name: trimmed, sort_order: 500 })
  if (error) return { error: 'That category already exists.' }
  revalidatePath('/', 'layout')
  return {}
}

export async function archiveCategory(id: string) {
  const { supabase } = await currentHouseholdId()
  await supabase.from('categories').update({ archived_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/', 'layout')
}

export async function addPaymentMethod(label: string, isJoint: boolean): Promise<ActionResult> {
  const { supabase, userId, householdId } = await currentHouseholdId()
  const trimmed = label.trim().slice(0, 40)
  if (!trimmed) return { error: 'Give the payment method a name.' }
  await supabase.from('payment_methods').insert({
    household_id: householdId,
    owner_user_id: isJoint ? null : userId,
    label: trimmed,
    is_joint: isJoint,
  })
  revalidatePath('/', 'layout')
  return {}
}

export async function archivePaymentMethod(id: string) {
  const { supabase } = await currentHouseholdId()
  await supabase
    .from('payment_methods')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  revalidatePath('/', 'layout')
}

/**
 * Leaves the current household. This is the only intentional way to
 * disconnect from a partner — once you leave, `requireHousehold` sends you
 * back to onboarding, where you can start a fresh household or accept a new
 * invite. Nothing you logged is deleted; it just stops being visible to you.
 */
export async function leaveHousehold(): Promise<ActionResult> {
  const { supabase } = await currentHouseholdId()
  const { error } = await supabase.rpc('leave_household')
  if (error) return { error: 'Could not leave the household. Please try again.' }
  revalidatePath('/', 'layout')
  redirect('/onboarding')
}
