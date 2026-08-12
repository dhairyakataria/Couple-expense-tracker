'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, List, Plus, PieChart, Settings } from 'lucide-react'

const ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/transactions', label: 'History', icon: List },
  { href: '/add', label: 'Add', icon: Plus, primary: true },
  { href: '/reports', label: 'Reports', icon: PieChart },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-ink-50/92 backdrop-blur">
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
        {ITEMS.map(({ href, label, icon: Icon, primary }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          if (primary) {
            return (
              <li key={href} className="flex items-center px-2 py-2">
                <Link
                  href={href}
                  aria-label="Add a transaction"
                  className="-mt-3.5 flex h-11 w-11 items-center justify-center bg-brand-500 text-ink-50"
                >
                  <Icon className="h-5 w-5" strokeWidth={2.5} />
                </Link>
              </li>
            )
          }
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 py-2.5 text-[10.5px] font-semibold transition ${
                  active ? 'text-brand-700' : 'text-ink-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
