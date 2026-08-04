'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { loadSettlement, requireHousehold } from '@/lib/data'
import { todayIso } from '@/lib/settlement/periods'

const settleSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(200).nullable().optional(),
})

/**
 * Records money actually moving between partners.
 *
 * This is the only thing that clears a balance. Closing a period does not.
 */
export interface ActionResult {
  error?: string
}

export async function settleUp(input: z.infer<typeof settleSchema>): Promise<ActionResult> {
  const parsed = settleSchema.safeParse(input)
  if (!parsed.success) return { error: 'Check the amount and try again.' }
  if (parsed.data.fromUserId === parsed.data.toUserId) {
    return { error: 'Pick two different people.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle()

  if (!membership) redirect('/onboarding')

  const { error } = await supabase.from('settlement_transfers').insert({
    household_id: (membership as { household_id: string }).household_id,
    from_user_id: parsed.data.fromUserId,
    to_user_id: parsed.data.toUserId,
    amount_paise: parsed.data.amountPaise,
    occurred_on: parsed.data.occurredOn,
    note: parsed.data.note || null,
    created_by: user.id,
  })

  if (error) return { error: 'Could not record that payment.' }

  revalidatePath('/', 'layout')
  return {}
}

export async function undoSettlement(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('settlement_transfers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Could not undo that payment.' }
  revalidatePath('/', 'layout')
  return {}
}

/**
 * Closes a period: snapshots the numbers and locks its transactions.
 *
 * The snapshot is what makes an old month explainable a year later, even
 * after the contribution ratio has changed twice.
 */
export async function closePeriod(periodId: string): Promise<ActionResult> {
  const { household, members } = await requireHousehold()
  const { result } = await loadSettlement(household.id, members)

  const period = result.periods.find((p) => p.periodId === periodId)
  if (!period) return { error: 'That period no longer exists.' }
  if (period.closed) return { error: 'That period is already settled.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('settlement_periods')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: user?.id ?? null,
      balance_snapshot: {
        householdTotalPaise: period.householdTotalPaise,
        jointTotalPaise: period.jointTotalPaise,
        lines: period.lines,
        balancesAtClose: result.balances,
      },
      config_snapshot: { configId: period.configId, model: period.model },
    })
    .eq('id', periodId)

  if (error) return { error: 'Could not close that period.' }

  revalidatePath('/', 'layout')
  return {}
}

export async function reopenPeriod(periodId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase
    .from('settlement_periods')
    .update({
      closed_at: null,
      closed_by: null,
      reopened_at: new Date().toISOString(),
      reopened_by: user?.id ?? null,
    })
    .eq('id', periodId)

  if (error) return { error: 'Could not reopen that period.' }
  revalidatePath('/', 'layout')
  return {}
}

/** Convenience wrapper used by the dashboard's one-tap "Settle up" button. */
export async function settleOutstanding(): Promise<ActionResult> {
  const { household, members } = await requireHousehold()
  const { result } = await loadSettlement(household.id, members)

  if (!result.headline) return { error: 'Nothing to settle — you are square.' }

  return settleUp({
    fromUserId: result.headline.fromUserId,
    toUserId: result.headline.toUserId,
    amountPaise: result.headline.amountPaise,
    occurredOn: todayIso(household.timezone),
    note: 'Settled up',
  })
}
