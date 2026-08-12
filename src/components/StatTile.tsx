import Link from 'next/link'
import { formatPaise } from '@/lib/money'

export default function StatTile({
  label,
  paise,
  hint,
  tone = 'default',
  href,
}: {
  label: string
  paise: number
  hint?: string
  tone?: 'default' | 'muted'
  href?: string
}) {
  const content = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`tabular mt-1 text-xl font-extrabold ${
          tone === 'muted' ? 'text-ink-700 opacity-75' : 'text-ink-900'
        }`}
      >
        {formatPaise(paise)}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </>
  )

  if (href) {
    return (
      <Link href={href} className="block bg-ink-100 p-3.5 transition active:opacity-70">
        {content}
      </Link>
    )
  }

  return <div className="bg-ink-100 p-3.5">{content}</div>
}
