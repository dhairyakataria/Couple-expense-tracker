import { describe, expect, it } from 'vitest'
import { allocate, calculateSettlement, configForPeriod, expectedShares } from './engine'
import { formatPeriodLabel, periodEndFor, periodStartFor } from './periods'
import type { ContributionConfig, PeriodRef, SettlementInput, SettlementSplit } from './types'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'

const members = [
  { userId: A, displayName: 'Sweta' },
  { userId: B, displayName: 'Ankit' },
]

const P1: PeriodRef = {
  id: 'p1',
  startsOn: '2026-08-01',
  endsOn: '2026-08-31',
  closedAt: null,
}

const equalConfig: ContributionConfig = {
  id: 'c-equal',
  model: 'equal',
  effectiveFrom: '2026-01-01',
  shares: [
    { userId: A, ratioBp: 5000, fixedAmountPaise: null },
    { userId: B, ratioBp: 5000, fixedAmountPaise: null },
  ],
}

const ratio6040: ContributionConfig = {
  id: 'c-ratio',
  model: 'ratio',
  effectiveFrom: '2026-01-01',
  shares: [
    { userId: A, ratioBp: 6000, fixedAmountPaise: null },
    { userId: B, ratioBp: 4000, fixedAmountPaise: null },
  ],
}

let seq = 0
function householdSplit(over: Partial<SettlementSplit>): SettlementSplit {
  const base: SettlementSplit = {
    transactionId: `t-${++seq}`,
    settlementPeriodId: 'p1',
    occurredOn: '2026-08-10',
    amountPaise: 0,
    payerUserId: A,
    beneficiaryKind: 'household',
    beneficiaryUserId: null,
    isReimbursable: false,
    paidFromJoint: false,
  }
  return { ...base, ...over }
}

function run(over: Partial<SettlementInput> = {}) {
  return calculateSettlement({
    members,
    periods: [P1],
    configs: [equalConfig],
    splits: [],
    transfers: [],
    ...over,
  })
}

// ---------------------------------------------------------------------------

describe('allocate', () => {
  it('splits exactly, with no paise lost', () => {
    const out = allocate(100_001, [
      { userId: A, bp: 5000 },
      { userId: B, bp: 5000 },
    ])
    expect(out[A] + out[B]).toBe(100_001)
  })

  it('gives the rounding remainder to the larger share', () => {
    const out = allocate(100_001, [
      { userId: A, bp: 6000 },
      { userId: B, bp: 4000 },
    ])
    expect(out[A] + out[B]).toBe(100_001)
    expect(out[B] % 100).toBe(0) // smaller share lands on a whole rupee
  })

  it('never loses money across many awkward totals', () => {
    for (let total = 1; total < 5000; total += 7) {
      const out = allocate(total, [
        { userId: A, bp: 7300 },
        { userId: B, bp: 2700 },
      ])
      expect(out[A] + out[B]).toBe(total)
    }
  })

  it('handles negative totals (a refund-heavy period)', () => {
    const out = allocate(-100_001, [
      { userId: A, bp: 6000 },
      { userId: B, bp: 4000 },
    ])
    expect(out[A] + out[B]).toBe(-100_001)
  })

  it('falls back to an even split rather than favouring one person', () => {
    const out = allocate(1000, [
      { userId: A, bp: 0 },
      { userId: B, bp: 0 },
    ])
    expect(out[A] + out[B]).toBe(1000)
    expect(Math.abs(out[A] - out[B])).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------

describe('household settlement', () => {
  it('is square when nobody has spent anything', () => {
    expect(run().headline).toBeNull()
  })

  it('splits equally when one partner pays everything', () => {
    const r = run({ splits: [householdSplit({ amountPaise: 50_000_00, payerUserId: A })] })
    expect(r.balances[A]).toBe(25_000_00)
    expect(r.balances[B]).toBe(-25_000_00)
    expect(r.headline).toEqual({ fromUserId: B, toUserId: A, amountPaise: 25_000_00 })
  })

  it('honours a 60:40 ratio', () => {
    const r = run({
      configs: [ratio6040],
      splits: [householdSplit({ amountPaise: 50_000_00, payerUserId: A })],
    })
    expect(r.periods[0].lines.find((l) => l.userId === A)!.expectedPaise).toBe(30_000_00)
    expect(r.periods[0].lines.find((l) => l.userId === B)!.expectedPaise).toBe(20_000_00)
    expect(r.balances[A]).toBe(20_000_00)
  })

  it('reports nothing owed when both pay exactly their ratio share', () => {
    const r = run({
      configs: [ratio6040],
      splits: [
        householdSplit({ amountPaise: 30_000_00, payerUserId: A }),
        householdSplit({ amountPaise: 20_000_00, payerUserId: B }),
      ],
    })
    expect(r.headline).toBeNull()
  })

  it('always has balances that sum to zero', () => {
    const r = run({
      configs: [ratio6040],
      splits: [
        householdSplit({ amountPaise: 12_345_67, payerUserId: A }),
        householdSplit({ amountPaise: 7_654_33, payerUserId: B }),
      ],
    })
    expect(r.balances[A] + r.balances[B]).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('joint payment methods', () => {
  it('produces no settlement delta at all', () => {
    const r = run({
      configs: [ratio6040],
      splits: [householdSplit({ amountPaise: 40_000_00, payerUserId: A, paidFromJoint: true })],
    })
    expect(r.balances[A]).toBe(0)
    expect(r.balances[B]).toBe(0)
    expect(r.periods[0].jointTotalPaise).toBe(40_000_00)
  })

  it('still counts as household spending in the totals', () => {
    const r = run({
      splits: [
        householdSplit({ amountPaise: 40_000_00, payerUserId: A, paidFromJoint: true }),
        householdSplit({ amountPaise: 10_000_00, payerUserId: B }),
      ],
    })
    expect(r.periods[0].householdTotalPaise).toBe(50_000_00)
  })
})

// ---------------------------------------------------------------------------

describe('partner expenses', () => {
  const shoes = (isReimbursable: boolean): SettlementSplit => ({
    transactionId: 't-shoes',
    settlementPeriodId: 'p1',
    occurredOn: '2026-08-12',
    amountPaise: 4_000_00,
    payerUserId: A,
    beneficiaryKind: 'person',
    beneficiaryUserId: B,
    isReimbursable,
    paidFromJoint: false,
  })

  it('a gift moves no money', () => {
    const r = run({ splits: [shoes(false)] })
    expect(r.headline).toBeNull()
    expect(r.balances[A]).toBe(0)
  })

  it('a reimbursable purchase is owed back in full', () => {
    const r = run({ splits: [shoes(true)] })
    expect(r.headline).toEqual({ fromUserId: B, toUserId: A, amountPaise: 4_000_00 })
  })

  it('does not affect household period totals either way', () => {
    const r = run({ splits: [shoes(true)] })
    expect(r.periods[0].householdTotalPaise).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('personal expenses', () => {
  it('are invisible to settlement', () => {
    const r = run({
      splits: [
        {
          transactionId: 't-personal',
          settlementPeriodId: 'p1',
          occurredOn: '2026-08-03',
          amountPaise: 15_000_00,
          payerUserId: A,
          beneficiaryKind: 'person',
          beneficiaryUserId: A,
          isReimbursable: false,
          paidFromJoint: false,
        },
      ],
    })
    expect(r.headline).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('refunds', () => {
  it('reduce the household total and the balance symmetrically', () => {
    const r = run({
      splits: [
        householdSplit({ amountPaise: 10_000_00, payerUserId: A }),
        householdSplit({ amountPaise: -2_000_00, payerUserId: A }),
      ],
    })
    expect(r.periods[0].householdTotalPaise).toBe(8_000_00)
    expect(r.balances[A]).toBe(4_000_00)
  })

  it('cancel the original completely when fully refunded', () => {
    const r = run({
      splits: [
        householdSplit({ amountPaise: 10_000_00, payerUserId: A }),
        householdSplit({ amountPaise: -10_000_00, payerUserId: A }),
      ],
    })
    expect(r.headline).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('settlement transfers', () => {
  it('square the balance when the exact amount is paid', () => {
    const r = run({
      splits: [householdSplit({ amountPaise: 50_000_00, payerUserId: A })],
      transfers: [{ id: 'x1', fromUserId: B, toUserId: A, amountPaise: 25_000_00 }],
    })
    expect(r.headline).toBeNull()
    expect(r.balances[A]).toBe(0)
  })

  it('leave a remainder when underpaid', () => {
    const r = run({
      splits: [householdSplit({ amountPaise: 50_000_00, payerUserId: A })],
      transfers: [{ id: 'x1', fromUserId: B, toUserId: A, amountPaise: 20_000_00 }],
    })
    expect(r.headline).toEqual({ fromUserId: B, toUserId: A, amountPaise: 5_000_00 })
  })

  it('flip the direction when overpaid', () => {
    const r = run({
      splits: [householdSplit({ amountPaise: 50_000_00, payerUserId: A })],
      transfers: [{ id: 'x1', fromUserId: B, toUserId: A, amountPaise: 30_000_00 }],
    })
    expect(r.headline).toEqual({ fromUserId: A, toUserId: B, amountPaise: 5_000_00 })
  })
})

// ---------------------------------------------------------------------------

describe('balances roll forward across periods', () => {
  const P2: PeriodRef = { id: 'p2', startsOn: '2026-09-01', endsOn: '2026-09-30', closedAt: null }

  it('accumulates unsettled months instead of resetting', () => {
    const r = calculateSettlement({
      members,
      periods: [P1, P2],
      configs: [equalConfig],
      transfers: [],
      splits: [
        householdSplit({ amountPaise: 10_000_00, payerUserId: A }),
        householdSplit({ amountPaise: 10_000_00, payerUserId: A, settlementPeriodId: 'p2' }),
      ],
    })
    expect(r.balances[A]).toBe(10_000_00)
  })

  it('keeps counting a closed period until money actually moves', () => {
    const r = calculateSettlement({
      members,
      periods: [{ ...P1, closedAt: '2026-09-01T00:00:00Z' }],
      configs: [equalConfig],
      transfers: [],
      splits: [householdSplit({ amountPaise: 10_000_00, payerUserId: A })],
    })
    expect(r.balances[A]).toBe(5_000_00)
    expect(r.periods[0].closed).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('effective-dated configuration', () => {
  const august: PeriodRef = { id: 'p-aug', startsOn: '2026-08-01', endsOn: '2026-08-31', closedAt: null }
  const september: PeriodRef = { id: 'p-sep', startsOn: '2026-09-01', endsOn: '2026-09-30', closedAt: null }
  const configs = [equalConfig, { ...ratio6040, effectiveFrom: '2026-09-01' }]

  it('uses the config in force at the start of each period', () => {
    expect(configForPeriod(august, configs)!.model).toBe('equal')
    expect(configForPeriod(september, configs)!.model).toBe('ratio')
  })

  it('applies old and new ratios to their own periods', () => {
    const r = calculateSettlement({
      members,
      periods: [august, september],
      configs,
      transfers: [],
      splits: [
        householdSplit({ amountPaise: 10_000_00, payerUserId: A, settlementPeriodId: 'p-aug' }),
        householdSplit({ amountPaise: 10_000_00, payerUserId: A, settlementPeriodId: 'p-sep' }),
      ],
    })
    const aug = r.periods.find((p) => p.periodId === 'p-aug')!
    const sep = r.periods.find((p) => p.periodId === 'p-sep')!
    expect(aug.lines.find((l) => l.userId === A)!.expectedPaise).toBe(5_000_00)
    expect(sep.lines.find((l) => l.userId === A)!.expectedPaise).toBe(6_000_00)
  })

  it('falls back to an equal split when no config predates the period', () => {
    const r = calculateSettlement({
      members,
      periods: [august],
      configs: [{ ...ratio6040, effectiveFrom: '2027-01-01' }],
      transfers: [],
      splits: [householdSplit({ amountPaise: 10_000_00, payerUserId: A, settlementPeriodId: 'p-aug' })],
    })
    expect(r.balances[A]).toBe(5_000_00)
  })
})

// ---------------------------------------------------------------------------

describe('fixed contribution model', () => {
  const fixed: ContributionConfig = {
    id: 'c-fixed',
    model: 'fixed',
    effectiveFrom: '2026-01-01',
    shares: [
      { userId: A, ratioBp: null, fixedAmountPaise: 30_000_00 },
      { userId: B, ratioBp: null, fixedAmountPaise: 20_000_00 },
    ],
  }

  it('expects exactly the committed amounts when spending matches', () => {
    const out = expectedShares(50_000_00, fixed, members)
    expect(out[A]).toBe(30_000_00)
    expect(out[B]).toBe(20_000_00)
  })

  it('splits overspend equally on top of the commitments', () => {
    const out = expectedShares(60_000_00, fixed, members)
    expect(out[A]).toBe(35_000_00)
    expect(out[B]).toBe(25_000_00)
  })

  it('scales commitments down proportionally when the household underspends', () => {
    const out = expectedShares(25_000_00, fixed, members)
    expect(out[A]).toBe(15_000_00)
    expect(out[B]).toBe(10_000_00)
    expect(out[A] + out[B]).toBe(25_000_00)
  })
})

// ---------------------------------------------------------------------------

describe('period maths', () => {
  it('handles calendar-month households', () => {
    expect(periodStartFor('2026-08-17', 1)).toBe('2026-08-01')
    expect(periodEndFor('2026-08-01')).toBe('2026-08-31')
  })

  it('handles salary-cycle households', () => {
    expect(periodStartFor('2026-08-17', 28)).toBe('2026-07-28')
    expect(periodStartFor('2026-08-28', 28)).toBe('2026-08-28')
    expect(periodEndFor('2026-07-28')).toBe('2026-08-27')
  })

  it('crosses a year boundary correctly', () => {
    expect(periodStartFor('2026-01-05', 15)).toBe('2025-12-15')
    expect(periodEndFor('2025-12-15')).toBe('2026-01-14')
  })

  it('survives February', () => {
    expect(periodStartFor('2028-03-03', 28)).toBe('2028-02-28')
    expect(periodEndFor('2028-01-28')).toBe('2028-02-27')
  })

  it('labels calendar months plainly and cycles explicitly', () => {
    expect(formatPeriodLabel('2026-08-01', '2026-08-31')).toBe('August 2026')
    expect(formatPeriodLabel('2026-07-28', '2026-08-27')).toBe('28 Jul – 27 Aug 2026')
  })
})
