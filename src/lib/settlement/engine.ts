/**
 * The settlement engine.
 *
 * A pure function. No I/O, no dates from the clock, no database. Everything it
 * needs arrives in SettlementInput, which makes the whole thing exhaustively
 * testable — see engine.test.ts.
 *
 * The model is "rolling balance with optional close":
 *
 *   balance(X) = Σ household delta across ALL periods
 *              + reimbursable partner expenses X paid for others
 *              - reimbursable partner expenses others paid for X
 *              + settlement transfers X sent
 *              - settlement transfers X received
 *
 * Closing a period does NOT zero the balance — only a real transfer of money
 * does. Closing exists to lock a period against edits.
 */

import type {
  ContributionConfig,
  Headline,
  MemberPeriodLine,
  MemberRef,
  PeriodRef,
  PeriodSettlement,
  SettlementInput,
  SettlementResult,
  SettlementSplit,
} from './types'

const RUPEE = 100

/** Balances closer than one rupee are treated as square. */
export const SETTLED_THRESHOLD_PAISE = RUPEE

interface Weight {
  userId: string
  bp: number
}

/**
 * Split `total` across weighted members so the parts sum to `total` EXACTLY.
 *
 * Each part is rounded to a whole rupee; the remainder goes to the member with
 * the largest weight. Rounding at the period level rather than per transaction
 * is what stops a year of half-rupee errors accumulating into a visible
 * discrepancy the couple cannot reconcile by hand.
 */
export function allocate(total: number, weights: Weight[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (weights.length === 0) return out

  const totalBp = weights.reduce((sum, w) => sum + w.bp, 0)
  if (totalBp <= 0) {
    // Degenerate config: fall back to an even split rather than silently
    // assigning everything to one person.
    const even = weights.map((w) => ({ userId: w.userId, bp: Math.floor(10000 / weights.length) }))
    return allocate(total, even.map((w, i) => (i === 0 ? { ...w, bp: w.bp + 1 } : w)))
  }

  const ordered = [...weights].sort((a, b) => b.bp - a.bp || (a.userId < b.userId ? -1 : 1))

  let assigned = 0
  for (let i = 1; i < ordered.length; i++) {
    const raw = (total * ordered[i].bp) / totalBp
    const rounded = Math.round(raw / RUPEE) * RUPEE
    out[ordered[i].userId] = rounded
    assigned += rounded
  }
  out[ordered[0].userId] = total - assigned
  return out
}

/**
 * The config in force for a period.
 *
 * Contribution changes take effect from the START of the next period, so the
 * correct config is the latest one whose effective_from is on or before the
 * period start. A single period is therefore never split across two configs.
 */
export function configForPeriod(
  period: PeriodRef,
  configs: ContributionConfig[],
): ContributionConfig | null {
  const eligible = configs
    .filter((c) => c.effectiveFrom <= period.startsOn)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
  return eligible.length ? eligible[eligible.length - 1] : null
}

function weightsFor(config: ContributionConfig | null, members: MemberRef[]): Weight[] {
  if (!config || config.model === 'equal') {
    return members.map((m) => ({ userId: m.userId, bp: 10000 }))
  }

  if (config.model === 'ratio') {
    return members.map((m) => ({
      userId: m.userId,
      bp: config.shares.find((s) => s.userId === m.userId)?.ratioBp ?? 0,
    }))
  }

  // fixed: weight by the committed amounts
  return members.map((m) => ({
    userId: m.userId,
    bp: config.shares.find((s) => s.userId === m.userId)?.fixedAmountPaise ?? 0,
  }))
}

/**
 * Expected household contribution per member for one period.
 *
 * equal / ratio: straightforward weighted split of the period total.
 *
 * fixed: each member is expected to cover their committed amount. Anything the
 * household spends BEYOND the committed total is split equally — "we each put
 * in our number, and whatever it runs over we split down the middle". If the
 * household underspends, the committed amounts are scaled down proportionally,
 * because there is no shared pot in this product for a surplus to sit in.
 */
export function expectedShares(
  total: number,
  config: ContributionConfig | null,
  members: MemberRef[],
): Record<string, number> {
  if (config?.model === 'fixed') {
    const fixed = members.map((m) => ({
      userId: m.userId,
      amount: config.shares.find((s) => s.userId === m.userId)?.fixedAmountPaise ?? 0,
    }))
    const committed = fixed.reduce((sum, f) => sum + f.amount, 0)

    if (committed <= 0) {
      return allocate(total, members.map((m) => ({ userId: m.userId, bp: 10000 })))
    }

    if (total <= committed) {
      return allocate(total, fixed.map((f) => ({ userId: f.userId, bp: f.amount })))
    }

    const excess = allocate(
      total - committed,
      members.map((m) => ({ userId: m.userId, bp: 10000 })),
    )
    const out: Record<string, number> = {}
    for (const f of fixed) out[f.userId] = f.amount + (excess[f.userId] ?? 0)
    return out
  }

  return allocate(total, weightsFor(config, members))
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  const { members, periods, configs, splits, transfers } = input

  const zeroed = (): Record<string, number> =>
    Object.fromEntries(members.map((m) => [m.userId, 0]))

  const householdDeltas = zeroed()
  const partnerDeltas = zeroed()
  const transferDeltas = zeroed()

  const byPeriod = new Map<string, SettlementSplit[]>()
  for (const s of splits) {
    if (s.beneficiaryKind !== 'household') continue
    const key = s.settlementPeriodId ?? '__unassigned__'
    const bucket = byPeriod.get(key)
    if (bucket) bucket.push(s)
    else byPeriod.set(key, [s])
  }

  const periodResults: PeriodSettlement[] = []

  for (const period of [...periods].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))) {
    const rows = byPeriod.get(period.id) ?? []
    const config = configForPeriod(period, configs)

    // Joint-account spending is pre-split by construction. Removing it from
    // both sides of the equation makes it net to exactly zero rather than
    // "approximately zero, give or take rounding".
    const joint = rows.filter((r) => r.paidFromJoint)
    const individual = rows.filter((r) => !r.paidFromJoint)

    const jointTotal = joint.reduce((sum, r) => sum + r.amountPaise, 0)
    const settleableTotal = individual.reduce((sum, r) => sum + r.amountPaise, 0)

    const expected = expectedShares(settleableTotal, config, members)

    const actual = zeroed()
    for (const r of individual) {
      if (r.payerUserId in actual) actual[r.payerUserId] += r.amountPaise
    }

    const lines: MemberPeriodLine[] = members.map((m) => {
      const exp = expected[m.userId] ?? 0
      const act = actual[m.userId] ?? 0
      const delta = act - exp
      householdDeltas[m.userId] += delta
      return { userId: m.userId, expectedPaise: exp, actualPaidPaise: act, deltaPaise: delta }
    })

    periodResults.push({
      periodId: period.id,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      closed: period.closedAt !== null,
      configId: config?.id ?? null,
      model: config?.model ?? null,
      householdTotalPaise: settleableTotal + jointTotal,
      jointTotalPaise: jointTotal,
      lines,
    })
  }

  // Partner expenses: only the reimbursable ones move money. A gift is simply
  // the buyer's personal spending and is invisible here.
  for (const s of splits) {
    if (s.beneficiaryKind !== 'person') continue
    if (!s.isReimbursable) continue
    if (!s.beneficiaryUserId || s.beneficiaryUserId === s.payerUserId) continue
    if (!(s.payerUserId in partnerDeltas)) continue
    if (!(s.beneficiaryUserId in partnerDeltas)) continue
    partnerDeltas[s.payerUserId] += s.amountPaise
    partnerDeltas[s.beneficiaryUserId] -= s.amountPaise
  }

  for (const t of transfers) {
    if (t.fromUserId in transferDeltas) transferDeltas[t.fromUserId] += t.amountPaise
    if (t.toUserId in transferDeltas) transferDeltas[t.toUserId] -= t.amountPaise
  }

  const balances: Record<string, number> = {}
  for (const m of members) {
    balances[m.userId] =
      householdDeltas[m.userId] + partnerDeltas[m.userId] + transferDeltas[m.userId]
  }

  return {
    balances,
    periods: periodResults,
    householdDeltas,
    partnerDeltas,
    transferDeltas,
    headline: headlineFor(balances),
  }
}

/**
 * Reduce the balance map to a single "A owes B ₹X" statement.
 *
 * For two members this is exact. For three or more it reports the largest
 * single debt, which is the honest simplification until multi-member
 * settlement lands.
 */
export function headlineFor(balances: Record<string, number>): Headline | null {
  const entries = Object.entries(balances)
  if (entries.length < 2) return null

  let creditor = entries[0]
  let debtor = entries[0]
  for (const e of entries) {
    if (e[1] > creditor[1]) creditor = e
    if (e[1] < debtor[1]) debtor = e
  }

  const amount = Math.min(creditor[1], -debtor[1])
  if (amount < SETTLED_THRESHOLD_PAISE) return null

  return { fromUserId: debtor[0], toUserId: creditor[0], amountPaise: amount }
}
