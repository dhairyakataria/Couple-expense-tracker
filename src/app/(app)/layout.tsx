import { requireHousehold } from '@/lib/data'
import BottomNav from '@/components/BottomNav'
import RealtimeRefresher from '@/components/RealtimeRefresher'
import ServiceWorker from '@/components/ServiceWorker'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { household } = await requireHousehold()

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      <RealtimeRefresher householdId={household.id} />
      <ServiceWorker />
      {children}
      <BottomNav />
    </div>
  )
}
