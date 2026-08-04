'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export interface AuthState {
  error?: string
  notice?: string
}

const credentials = z.object({
  email: z.string().email('That does not look like an email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
})

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: 'Those details did not match. Check your email and password.' }
  }

  revalidatePath('/', 'layout')
  redirect(String(formData.get('next') || '/'))
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const name = String(formData.get('display_name') || '').trim()
  if (name.length < 1) return { error: 'What should your partner see you called?' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      data: { full_name: name },
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  // With email confirmation on, there is no session yet.
  if (!data.session) {
    return { notice: 'Check your email to confirm your address, then sign in.' }
  }

  revalidatePath('/', 'layout')
  redirect(String(formData.get('next') || '/'))
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient()
  const next = String(formData.get('next') || '/')

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error || !data.url) {
    redirect('/login?error=google')
  }

  redirect(data.url)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
