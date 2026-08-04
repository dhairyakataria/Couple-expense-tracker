import { formatPaise } from '@/lib/money'
import type { AuditEntry, Profile } from '@/types/app'

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  create: 'added this',
  update: 'edited this',
  delete: 'deleted this',
  restore: 'restored this',
}

/**
 * Plain-language history of who changed what.
 *
 * This exists to end "I definitely entered that" without either partner
 * needing to be right from memory. It is deliberately readable rather than
 * complete — the full before/after JSON stays in the database.
 */
export default function AuditTrail({
  entries,
  members,
  meId,
}: {
  entries: AuditEntry[]
  members: Profile[]
  meId: string
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-400">No changes recorded.</p>
  }

  const name = (id: string | null) => {
    if (!id) return 'Someone'
    if (id === meId) return 'You'
    return members.find((m) => m.id === id)?.display_name ?? 'Your partner'
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const changes = describeChanges(entry)
        return (
          <li key={entry.id} className="text-sm">
            <p className="text-ink-800">
              <span className="font-medium">{name(entry.actor_user_id)}</span>{' '}
              {ACTION_LABEL[entry.action]}
            </p>
            <p className="text-xs text-ink-400">
              {new Date(entry.created_at).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}

const WATCHED: { key: string; label: string; money?: boolean }[] = [
  { key: 'amount_paise', label: 'Amount', money: true },
  { key: 'occurred_on', label: 'Date' },
  { key: 'merchant', label: 'Merchant' },
  { key: 'notes', label: 'Notes' },
  { key: 'txn_type', label: 'Type' },
  { key: 'is_reimbursable', label: 'Owed back' },
]

function describeChanges(entry: AuditEntry): string[] {
  if (entry.action !== 'update' || !entry.before || !entry.after) return []

  const out: string[] = []
  for (const field of WATCHED) {
    const before = entry.before[field.key]
    const after = entry.after[field.key]
    if (before === after) continue
    if (before == null && after == null) continue

    const fmt = (v: unknown) => {
      if (v == null || v === '') return 'nothing'
      if (field.money) return formatPaise(Math.abs(Number(v)))
      if (typeof v === 'boolean') return v ? 'yes' : 'no'
      return String(v)
    }

    out.push(`${field.label}: ${fmt(before)} → ${fmt(after)}`)
  }
  return out
}
