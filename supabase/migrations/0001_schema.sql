-- ============================================================================
-- 0001_schema.sql — Couple Finance Manager core schema
--
-- Design notes:
--   * All money is stored as integer paise (bigint). Never floats.
--   * Transaction "type" is DERIVED from payer + beneficiary, not stored.
--   * transaction_splits exists from day one, maintained by trigger.
--     MVP writes exactly one split per transaction; multi-split needs no migration.
--   * Everything is soft-deleted. Nothing is ever hard-deleted by the app.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type transaction_kind    as enum ('expense', 'refund');
create type beneficiary_kind    as enum ('person', 'household');
create type contribution_model  as enum ('equal', 'ratio', 'fixed');
create type transaction_source  as enum ('manual', 'sms', 'notification', 'email', 'statement', 'api');
create type audit_action        as enum ('create', 'update', 'delete', 'restore');

-- ---------------------------------------------------------------------------
-- Profiles (mirrors auth.users)
-- ---------------------------------------------------------------------------
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  email         text,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Households
--
-- period_start_day is constrained to 1..28 so that every month has that day.
-- This removes all "what happens on the 31st of February" ambiguity from
-- period maths, at the cost of households that get paid on the 29th-31st.
-- ---------------------------------------------------------------------------
create table households (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  currency          text not null default 'INR',
  timezone          text not null default 'Asia/Kolkata',
  period_start_day  smallint not null default 1 check (period_start_day between 1 and 28),
  created_by        uuid not null references profiles(id),
  created_at        timestamptz not null default now()
);

create table household_members (
  household_id  uuid not null references households(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner', 'member')),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  primary key (household_id, user_id)
);
create index household_members_user_idx on household_members(user_id) where left_at is null;

create table household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  email         text not null,
  token         text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  accepted_at   timestamptz,
  accepted_by   uuid references profiles(id)
);
create index household_invites_email_idx on household_invites(lower(email)) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Contribution configuration (effective-dated, never updated in place)
--
-- ratio_bp is basis points: 6000 = 60%. Using integers avoids float drift.
-- Income is deliberately NOT stored — only the resulting ratio.
-- ---------------------------------------------------------------------------
create table contribution_configs (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  model           contribution_model not null,
  effective_from  date not null,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  unique (household_id, effective_from)
);

create table contribution_shares (
  config_id           uuid not null references contribution_configs(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete cascade,
  ratio_bp            integer check (ratio_bp between 0 and 10000),
  fixed_amount_paise  bigint  check (fixed_amount_paise >= 0),
  primary key (config_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Categories — seeded per household so both partners can rename/delete freely
-- ---------------------------------------------------------------------------
create table categories (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  icon          text,
  sort_order    smallint not null default 100,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index categories_household_name_idx
  on categories(household_id, lower(name)) where archived_at is null;

-- ---------------------------------------------------------------------------
-- Payment methods
--
-- A joint method has no single owner; a personal method must have one.
-- Joint transactions are pre-split by the active ratio and net to zero in
-- settlement — see docs/ARCHITECTURE.md §Settlement.
-- ---------------------------------------------------------------------------
create table payment_methods (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  owner_user_id  uuid references profiles(id) on delete cascade,
  label          text not null,
  is_joint       boolean not null default false,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint joint_has_no_owner check (is_joint = (owner_user_id is null))
);

-- ---------------------------------------------------------------------------
-- Settlement periods
--
-- Closing a period LOCKS its transactions against edit. It does not zero the
-- balance — only a settlement_transfer does that. This is the "rolling balance
-- with optional close" model.
-- ---------------------------------------------------------------------------
create table settlement_periods (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  starts_on         date not null,
  ends_on           date not null,
  closed_at         timestamptz,
  closed_by         uuid references profiles(id),
  balance_snapshot  jsonb,
  config_snapshot   jsonb,
  reopened_at       timestamptz,
  reopened_by       uuid references profiles(id),
  created_at        timestamptz not null default now(),
  unique (household_id, starts_on),
  check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table transactions (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references households(id) on delete cascade,
  kind                      transaction_kind not null default 'expense',
  occurred_on               date not null,
  amount_paise              bigint not null,
  payer_user_id             uuid not null references profiles(id),
  beneficiary_kind          beneficiary_kind not null,
  beneficiary_user_id       uuid references profiles(id),
  is_reimbursable           boolean not null default false,
  category_id               uuid references categories(id) on delete set null,
  payment_method_id         uuid references payment_methods(id) on delete set null,
  merchant                  text,
  notes                     text,
  attachment_path           text,                      -- reserved, unused in MVP
  source                    transaction_source not null default 'manual',
  external_ref              text,                      -- dedupe key for future importers
  refund_of_transaction_id  uuid references transactions(id) on delete set null,
  settlement_period_id      uuid references settlement_periods(id),
  is_adjustment             boolean not null default false,
  created_by                uuid not null references profiles(id),
  created_at                timestamptz not null default now(),
  updated_by                uuid references profiles(id),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,

  -- Derived transaction type. Users see these three labels; the app never
  -- stores them, so payer/beneficiary can never disagree with the label.
  txn_type text generated always as (
    case
      when beneficiary_kind = 'household' then 'household'
      when beneficiary_user_id = payer_user_id then 'personal'
      else 'partner'
    end
  ) stored,

  constraint beneficiary_consistency check (
    (beneficiary_kind = 'household' and beneficiary_user_id is null)
    or (beneficiary_kind = 'person' and beneficiary_user_id is not null)
  ),
  -- Refunds are negative expenses. This makes every SUM() correct for free.
  constraint amount_sign check (
    (kind = 'expense' and amount_paise > 0)
    or (kind = 'refund' and amount_paise < 0)
  ),
  -- Only a partner expense can be reimbursable. A personal or household
  -- expense being "owed back" is meaningless.
  constraint reimbursable_only_on_partner check (
    is_reimbursable = false
    or (beneficiary_kind = 'person' and beneficiary_user_id <> payer_user_id)
  ),
  constraint external_ref_unique unique (household_id, source, external_ref)
);

create index transactions_household_date_idx
  on transactions(household_id, occurred_on desc) where deleted_at is null;
create index transactions_period_idx
  on transactions(settlement_period_id) where deleted_at is null;
create index transactions_payer_idx
  on transactions(household_id, payer_user_id) where deleted_at is null;
create index transactions_merchant_idx
  on transactions(household_id, lower(merchant)) where deleted_at is null;
create index transactions_type_idx
  on transactions(household_id, txn_type) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Transaction splits
--
-- Maintained by trigger. The MVP always writes exactly one row mirroring the
-- parent transaction. When partial splits ship, the UI writes multiple rows
-- and the trigger steps aside — no schema change, no backfill.
-- ---------------------------------------------------------------------------
create table transaction_splits (
  id                   uuid primary key default gen_random_uuid(),
  transaction_id       uuid not null references transactions(id) on delete cascade,
  beneficiary_kind     beneficiary_kind not null,
  beneficiary_user_id  uuid references profiles(id),
  amount_paise         bigint not null,
  is_auto              boolean not null default true,
  created_at           timestamptz not null default now(),
  constraint split_beneficiary_consistency check (
    (beneficiary_kind = 'household' and beneficiary_user_id is null)
    or (beneficiary_kind = 'person' and beneficiary_user_id is not null)
  )
);
create index transaction_splits_txn_idx on transaction_splits(transaction_id);

-- ---------------------------------------------------------------------------
-- Settlement transfers — money actually moving between partners.
-- Never counted as spending anywhere.
-- ---------------------------------------------------------------------------
create table settlement_transfers (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references households(id) on delete cascade,
  from_user_id          uuid not null references profiles(id),
  to_user_id            uuid not null references profiles(id),
  amount_paise          bigint not null check (amount_paise > 0),
  occurred_on           date not null,
  note                  text,
  settlement_period_id  uuid references settlement_periods(id),
  created_by            uuid not null references profiles(id),
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check (from_user_id <> to_user_id)
);
create index settlement_transfers_household_idx
  on settlement_transfers(household_id, occurred_on desc) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Audit log — a relationship feature, not an engineering one.
-- Answers "I definitely entered that" without either partner needing to
-- be right from memory.
-- ---------------------------------------------------------------------------
create table audit_log (
  id              bigserial primary key,
  household_id    uuid not null references households(id) on delete cascade,
  actor_user_id   uuid references profiles(id),
  entity_type     text not null,
  entity_id       uuid not null,
  action          audit_action not null,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_household_idx on audit_log(household_id, created_at desc);
create index audit_log_entity_idx on audit_log(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Recurring templates — schema only. No generator runs in the MVP.
-- ---------------------------------------------------------------------------
create table recurring_templates (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households(id) on delete cascade,
  label                text not null,
  amount_paise         bigint,
  payer_user_id        uuid references profiles(id),
  beneficiary_kind     beneficiary_kind not null default 'household',
  beneficiary_user_id  uuid references profiles(id),
  category_id          uuid references categories(id) on delete set null,
  payment_method_id    uuid references payment_methods(id) on delete set null,
  merchant             text,
  rrule                text,          -- iCal RRULE, e.g. FREQ=MONTHLY;BYMONTHDAY=5
  next_run_on          date,
  is_active            boolean not null default false,
  created_by           uuid not null references profiles(id),
  created_at           timestamptz not null default now()
);
