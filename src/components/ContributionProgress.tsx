import { formatPaise } from '@/lib/money'
import type { MemberPeriodLine } from '@/lib/settlement/types'
import type { Profile } from '@/types/app'

/**
 * Actual paid against expected share, per person.
 *
 * Deliberately says "₹4,200 more than your share" rather than "variance" —
 * the app never uses accounting vocabulary at the user.
 */
// A circle with r=15.9155 in a 42x42 viewBox has circumference ≈ 100, so
// stroke-dasharray can be given directly as a 0–100 percentage.
const RING_R = 15.9155
const RING_CIRCUMFERENCE = 100

export default function ContributionProgress({
  lines,
  members,
  meId,
}: {
  lines: MemberPeriodLine[]
  members: Profile[]
  meId: string
}) {
  return (
    <div className="space-y-4 bg-ink-100 p-5">
      <h2 className="font-extrabold text-ink-900">Who has paid what</h2>

      <div className="flex gap-4">
        {lines.map((line) => {
          const member = members.find((m) => m.id === line.userId)
          const isMe = line.userId === meId
          const ahead = line.deltaPaise >= 0
          const pct = Math.max(
            0,
            Math.min(100, (line.actualPaidPaise / Math.max(line.expectedPaise, 1)) * 100),
          )

          return (
            <div key={line.userId} className="flex flex-1 flex-col items-center gap-1 text-center">
              <svg width="72" height="72" viewBox="0 0 42 42">
                <circle
                  cx="21"
                  cy="21"
                  r={RING_R}
                  fill="none"
                  stroke="var(--color-ink-200)"
                  strokeWidth="5"
                />
                <circle
                  cx="21"
                  cy="21"
                  r={RING_R}
                  fill="none"
                  stroke={ahead ? 'var(--color-brand-700)' : 'var(--color-ink-500)'}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${pct} ${RING_CIRCUMFERENCE - pct}`}
                  strokeDashoffset="25"
                  style={{ transition: 'stroke-dasharray 1s ease' }}
                />
              </svg>
              <p className="text-sm font-semibold text-ink-900">
                {isMe ? 'You' : member?.display_name ?? 'Partner'}
              </p>
              <p className="tabular text-[11px] text-ink-500">
                {formatPaise(line.actualPaidPaise)} of {formatPaise(line.expectedPaise)}
              </p>
              {Math.abs(line.deltaPaise) >= 100 && (
                <p className="text-[11px] font-medium text-brand-700">
                  {formatPaise(Math.abs(line.deltaPaise))} {ahead ? 'ahead' : 'short'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
