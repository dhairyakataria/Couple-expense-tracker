/**
 * Domain row types.
 *
 * Hand-written rather than generated so the app compiles before the database
 * exists. Once the project is linked you can run `npm run db:types` and
 * gradually replace these with the generated definitions.
 */

export type BeneficiaryKind = 'person' | 'household'
export type TransactionKind = 'expense' | 'refund'
export type TxnType = 'personal' | 'household' | 'partner'
export type ContributionModel = 'equal' | 'ratio' | 'fixed'
export type TransactionSource = 'manual' | 'sms' | 'notification' | 'email' | 'statement' | 'api'

export interface Profile {
  id: string
  display_name: string
  email: string | null
  avatar_url: string | null
}

export interface Household {
  id: string
  name: string
  currency: string
  timezone: string
  period_start_day: number
  created_by: string
}

export interface HouseholdMember {
  household_id: string
  user_id: string
  role: 'owner' | 'member'
  left_at: string | null
  profiles: Profile
}

export interface Category {
  id: string
  household_id: string
  name: string
  icon: string | null
  sort_order: number
  archived_at: string | null
}

export interface PaymentMethod {
  id: string
  household_id: string
  owner_user_id: string | null
  label: string
  is_joint: boolean
  archived_at: string | null
}

export interface SettlementPeriodRow {
  id: string
  household_id: string
  starts_on: string
  ends_on: string
  closed_at: string | null
  closed_by: string | null
  balance_snapshot: Record<string, number> | null
}

export interface TransactionRow {
  id: string
  household_id: string
  kind: TransactionKind
  occurred_on: string
  amount_paise: number
  payer_user_id: string
  beneficiary_kind: BeneficiaryKind
  beneficiary_user_id: string | null
  is_reimbursable: boolean
  category_id: string | null
  payment_method_id: string | null
  merchant: string | null
  notes: string | null
  source: TransactionSource
  refund_of_transaction_id: string | null
  settlement_period_id: string | null
  is_adjustment: boolean
  txn_type: TxnType
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface TransactionWithRefs extends TransactionRow {
  category: Pick<Category, 'id' | 'name'> | null
  payment_method: Pick<PaymentMethod, 'id' | 'label' | 'is_joint'> | null
}

export interface SettlementTransferRow {
  id: string
  household_id: string
  from_user_id: string
  to_user_id: string
  amount_paise: number
  occurred_on: string
  note: string | null
  deleted_at: string | null
}

export interface AuditEntry {
  id: number
  actor_user_id: string | null
  entity_type: string
  entity_id: string
  action: 'create' | 'update' | 'delete' | 'restore'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

/** Everything a screen needs about the signed-in user's household. */
export interface HouseholdContext {
  household: Household
  members: Profile[]
  me: Profile
  partner: Profile | null
  categories: Category[]
  paymentMethods: PaymentMethod[]
}
