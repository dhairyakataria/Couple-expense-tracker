'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Refreshes server data when the partner changes something, or when the app
 * comes back to the foreground.
 *
 * This is change notification, not collaborative editing. Two people almost
 * never edit the same transaction at the same moment, so a router refresh is
 * the right amount of machinery.
 */
export default function RealtimeRefresher({ householdId }: { householdId: string }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`household:${householdId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'settlement_transfers',
          filter: `household_id=eq.${householdId}`,
        },
        () => router.refresh(),
      )
      .subscribe()

    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [householdId, router])

  return null
}
