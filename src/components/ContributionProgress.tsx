import { formatPaise } from '@/lib/money'
import type { MemberPeriodLine } from '@/lib/settlement/types'
import type { Profile } from '@/types/app'

/**
 * Actual paid against expected share, per person.
 *
 * Deliberately says "₹4,200 more than your share" rather than "variance" —
 * the app never uses accounting vocabulary at the user.
 */
export default function ContributionProgress({
  lines,
  members,
  meId,
}: {
  lines: MemberPeriodLine[]
  members: Profile[]
  meId: string
}) {
  const max = Math.max(...lines.flatMap((l) => [l.expectedPaise, l.actualPaidPaise]), 1)

  return (
    <div className="space-y-4 bg-ink-100 p-5">
      <h2 className="font-extrabold text-ink-900">Who has paid what</h2>

      {lines.map((line) => {
        const member = members.find((m) => m.id === line.userId)
        const isMe = line.userId === meId
        const pct = Math.max(0, Math.min(100, (line.actualPaidPaise / max) * 100))
        const expectedPct = Math.max(0, Math.min(100, (line.expectedPaise / max) * 100))
        const ahead = line.deltaPaise > 0

        return (
          <div key={line.userId} className="space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold text-ink-800">
                {isMe ? 'You' : member?.display_name ?? 'Partner'}
              </span>
              <span className="tabular text-ink-500">
                {formatPaise(line.actualPaidPaise)} of {formatPaise(line.expectedPaise)}
              </span>
            </div>

            <div className="relative h-2 overflow-hidden bg-ink-200">
              <div
                className={`absolute inset-y-0 left-0 ${ahead ? 'bg-brand-700' : 'bg-ink-500'}`}
                style={{ width: `${pct}%` }}
              />
              <div
                className="absolute inset-y-0 w-px bg-ink-900"
                style={{ left: `${expectedPct}%` }}
                aria-hidden
              />
            </div>

            {Math.abs(line.deltaPaise) >= 100 && (
              <p className="text-xs text-ink-500">
                {formatPaise(Math.abs(line.deltaPaise))}{' '}
                {ahead ? 'more than' : 'short of'} {isMe ? 'your' : 'their'} share
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
