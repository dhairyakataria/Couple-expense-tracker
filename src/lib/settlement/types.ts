export type ContributionModelName = 'equal' | 'ratio' | 'fixed'
export type BeneficiaryKind = 'person' | 'household'
export type TxnType = 'personal' | 'household' | 'partner'

export interface MemberRef {
  userId: string
  displayName: string
}

export interface ContributionShare {
  userId: string
  /** Basis points. 6000 = 60%. Null for the fixed model. */
  ratioBp: number | null
  /** Paise. Null for equal and ratio models. */
  fixedAmountPaise: number | null
}

export interface ContributionConfig {
  id: string
  model: ContributionModelName
  /** ISO date, YYYY-MM-DD */
  effectiveFrom: string
  shares: ContributionShare[]
}

export interface PeriodRef {
  id: string
  startsOn: string
  endsOn: string
  closedAt: string | null
}

/**
 * One row of transaction_splits, denormalised with the parent transaction's
 * settlement-relevant fields. The engine deliberately knows nothing about
 * categories, merchants or notes.
 */
export interface SettlementSplit {
  transactionId: string
  settlementPeriodId: string | null
  occurredOn: string
  /** Signed paise. Refunds arrive here as negative numbers. */
  amountPaise: number
  payerUserId: string
  beneficiaryKind: BeneficiaryKind
  beneficiaryUserId: string | null
  isReimbursable: boolean
  /** True when paid from a payment method flagged is_joint. */
  paidFromJoint: boolean
}

export interface TransferRow {
  id: string
  fromUserId: string
  toUserId: string
  /** Always positive paise. */
  amountPaise: number
}

export interface SettlementInput {
  members: MemberRef[]
  periods: PeriodRef[]
  configs: ContributionConfig[]
  splits: SettlementSplit[]
  transfers: TransferRow[]
}

export interface MemberPeriodLine {
  userId: string
  expectedPaise: number
  actualPaidPaise: number
  /** actualPaid - expected. Positive means they carried more than their share. */
  deltaPaise: number
}

export interface PeriodSettlement {
  periodId: string
  startsOn: string
  endsOn: string
  closed: boolean
  configId: string | null
  model: ContributionModelName | null
  /** Everything spent on the household, including joint-account spending. */
  householdTotalPaise: number
  /** The portion paid from joint methods, excluded from settlement. */
  jointTotalPaise: number
  lines: MemberPeriodLine[]
}

export interface Headline {
  fromUserId: string
  toUserId: string
  amountPaise: number
}

export interface SettlementResult {
  /** Positive means this member is owed money. Always sums to zero. */
  balances: Record<string, number>
  periods: PeriodSettlement[]
  householdDeltas: Record<string, number>
  partnerDeltas: Record<string, number>
  transferDeltas: Record<string, number>
  /** Null when everything is square (within one rupee). */
  headline: Headline | null
}
