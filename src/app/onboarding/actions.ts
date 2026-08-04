'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export interface OnboardingState {
  error?: string
}

const schema = z.object({
  name: z.string().trim().min(1, 'Give your household a name.').max(60),
  periodStartDay: z.coerce.number().int().min(1).max(28),
  model: z.enum(['equal', 'ratio']),
  myShareBp: z.coerce.number().int().min(0).max(10000),
})

export async function createHouseholdAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = schema.safeParse({
    name: formData.get('name'),
    periodStartDay: formData.get('period_start_day'),
    model: formData.get('model'),
    myShareBp: formData.get('my_share_bp'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // The split is passed into the RPC rather than patched afterwards: a config
  // whose effective_from has already arrived is immutable under RLS, so a
  // follow-up update would match zero rows and fail silently.
  const { data: householdId, error } = await supabase.rpc('create_household', {
    p_name: parsed.data.name,
    p_period_start_day: parsed.data.periodStartDay,
    p_model: parsed.data.model,
    p_my_ratio_bp: parsed.data.myShareBp,
  })

  if (error || !householdId) {
    return { error: error?.message ?? 'Could not create the household.' }
  }

  revalidatePath('/', 'layout')
  redirect('/onboarding/invite')
}
