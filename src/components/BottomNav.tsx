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
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur">
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2">
        {ITEMS.map(({ href, label, icon: Icon, primary }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          if (primary) {
            return (
              <li key={href} className="flex items-center px-2 py-2">
                <Link
                  href={href}
                  aria-label="Add a transaction"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/25"
                >
                  <Icon className="h-6 w-6" strokeWidth={2.5} />
                </Link>
              </li>
            )
          }
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  active ? 'text-brand-600' : 'text-ink-400'
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
