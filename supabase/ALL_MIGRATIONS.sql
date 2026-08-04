-- Combined migrations for couple-finance
-- Paste into Supabase SQL Editor and Run. Order matters.


-- ================================================================
-- supabase/migrations/0001_schema.sql
-- ================================================================

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


-- ================================================================
-- supabase/migrations/0002_functions.sql
-- ================================================================

-- ============================================================================
-- 0002_functions.sql — helpers, triggers and RPCs
-- ============================================================================

-- ---------------------------------------------------------------------------
-- New auth user -> profile row
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership helpers.
--
-- SECURITY DEFINER is load-bearing here: it bypasses RLS inside the function,
-- which is what stops household_members policies from recursing into
-- themselves. Do not change these to SECURITY INVOKER.
-- ---------------------------------------------------------------------------
create or replace function is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_members
    where household_id = p_household_id
      and user_id = auth.uid()
      and left_at is null
  );
$$;

create or replace function shares_household_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members mine
    join household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid()
      and mine.left_at is null
      and theirs.user_id = p_user_id
      and theirs.left_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- Period maths.
--
-- period_start_day is constrained to 1..28, so make_date always succeeds and
-- there is no month-length special casing anywhere in the system.
-- ---------------------------------------------------------------------------
create or replace function period_start_for(d date, s smallint)
returns date
language sql
immutable
as $$
  select case
    when extract(day from d)::int >= s
      then make_date(extract(year from d)::int, extract(month from d)::int, s)
    else (make_date(extract(year from d)::int, extract(month from d)::int, s)
          - interval '1 month')::date
  end;
$$;

create or replace function get_or_create_period(p_household_id uuid, d date)
returns settlement_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start_day smallint;
  v_start date;
  v_end date;
  v_period settlement_periods;
begin
  select period_start_day into v_start_day from households where id = p_household_id;
  if v_start_day is null then
    raise exception 'Household % not found', p_household_id;
  end if;

  v_start := period_start_for(d, v_start_day);
  v_end := (v_start + interval '1 month' - interval '1 day')::date;

  select * into v_period from settlement_periods
    where household_id = p_household_id and starts_on = v_start;

  if not found then
    insert into settlement_periods (household_id, starts_on, ends_on)
      values (p_household_id, v_start, v_end)
      on conflict (household_id, starts_on) do nothing;
    select * into v_period from settlement_periods
      where household_id = p_household_id and starts_on = v_start;
  end if;

  return v_period;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assign a transaction to a settlement period.
--
-- If the period containing occurred_on is already closed, the transaction is
-- accepted but lands in the current open period as an ADJUSTMENT. History is
-- never rewritten; the original date is preserved on the row.
-- ---------------------------------------------------------------------------
create or replace function assign_settlement_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target settlement_periods;
  v_current settlement_periods;
  v_probe date;
  v_guard int := 0;
begin
  -- PL/pgSQL does not guarantee short-circuit evaluation of AND, and OLD is
  -- unassigned during INSERT, so the OLD reference has to sit inside its own
  -- branch rather than alongside a tg_op test.
  if tg_op = 'UPDATE' then
    if new.occurred_on = old.occurred_on and new.settlement_period_id is not null then
      return new;
    end if;
  end if;

  v_target := get_or_create_period(new.household_id, new.occurred_on);

  if v_target.closed_at is null then
    new.settlement_period_id := v_target.id;
    new.is_adjustment := false;
    return new;
  end if;

  -- Walk forward from today until an open period is found.
  v_probe := current_date;
  loop
    v_current := get_or_create_period(new.household_id, v_probe);
    exit when v_current.closed_at is null or v_guard > 24;
    v_probe := (v_probe + interval '1 month')::date;
    v_guard := v_guard + 1;
  end loop;

  new.settlement_period_id := v_current.id;
  new.is_adjustment := true;
  return new;
end;
$$;

create trigger transactions_assign_period
  before insert or update of occurred_on on transactions
  for each row execute function assign_settlement_period();

-- ---------------------------------------------------------------------------
-- Closed periods are locked.
-- ---------------------------------------------------------------------------
create or replace function guard_closed_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed timestamptz;
begin
  -- NEW is unassigned during DELETE and OLD during INSERT, so every return
  -- path has to be explicit about which record it is handing back.
  if old.settlement_period_id is not null then
    select closed_at into v_closed
      from settlement_periods where id = old.settlement_period_id;

    if v_closed is not null then
      raise exception
        'This transaction is in a settled period. Reopen the period to change it.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger transactions_guard_closed
  before update or delete on transactions
  for each row execute function guard_closed_period();

-- ---------------------------------------------------------------------------
-- Keep updated_at / updated_by honest
-- ---------------------------------------------------------------------------
create or replace function touch_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger transactions_touch_updated
  before update on transactions
  for each row execute function touch_updated();

-- ---------------------------------------------------------------------------
-- Mirror every transaction into transaction_splits.
--
-- The MVP writes exactly one auto split. When the UI grows partial splits it
-- will write is_auto = false rows and this trigger leaves them alone.
-- ---------------------------------------------------------------------------
create or replace function sync_transaction_split()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from transaction_splits
    where transaction_id = new.id and is_auto = false
  ) then
    return new;
  end if;

  delete from transaction_splits where transaction_id = new.id and is_auto;

  if new.deleted_at is null then
    insert into transaction_splits
      (transaction_id, beneficiary_kind, beneficiary_user_id, amount_paise, is_auto)
    values
      (new.id, new.beneficiary_kind, new.beneficiary_user_id, new.amount_paise, true);
  end if;

  return new;
end;
$$;

create trigger transactions_sync_split
  after insert or update of amount_paise, beneficiary_kind, beneficiary_user_id, deleted_at
  on transactions
  for each row execute function sync_transaction_split();

-- ---------------------------------------------------------------------------
-- Generic audit trigger. Attach with the entity name as the first argument.
-- ---------------------------------------------------------------------------
create or replace function write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action audit_action;
  v_household uuid;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  -- OLD is unassigned on INSERT and NEW on DELETE. Touching the wrong one
  -- raises "record is not assigned yet", so each branch is kept separate.
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_before := null;
    v_after := to_jsonb(new);
    v_household := new.household_id;
    v_id := new.id;

  elsif tg_op = 'DELETE' then
    v_action := 'delete';
    v_before := to_jsonb(old);
    v_after := null;
    v_household := old.household_id;
    v_id := old.id;

  else
    if new.deleted_at is not null and old.deleted_at is null then
      v_action := 'delete';
    elsif new.deleted_at is null and old.deleted_at is not null then
      v_action := 'restore';
    else
      v_action := 'update';
    end if;
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_household := new.household_id;
    v_id := new.id;
  end if;

  insert into audit_log (household_id, actor_user_id, entity_type, entity_id, action, before, after)
  values (v_household, auth.uid(), tg_argv[0], v_id, v_action, v_before, v_after);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger transactions_audit
  after insert or update or delete on transactions
  for each row execute function write_audit('transaction');

create trigger settlement_transfers_audit
  after insert or update or delete on settlement_transfers
  for each row execute function write_audit('settlement_transfer');

create trigger settlement_periods_audit
  after insert or update or delete on settlement_periods
  for each row execute function write_audit('settlement_period');

-- ---------------------------------------------------------------------------
-- RPC: create a household, seed it, and make the caller its owner.
-- Runs as one transaction so a half-built household can never exist.
-- ---------------------------------------------------------------------------
-- The contribution config is seeded HERE rather than being patched afterwards
-- by the client. A config whose effective_from has already arrived is locked
-- by RLS (see contribution_configs_update_future), so a follow-up update from
-- onboarding would silently match zero rows.
create or replace function create_household(
  p_name text,
  p_period_start_day smallint default 1,
  p_model contribution_model default 'equal',
  p_my_ratio_bp integer default 5000
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household_id uuid;
  v_config_id uuid;
  v_cat text;
  v_order smallint := 10;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into households (name, period_start_day, created_by)
    values (p_name, p_period_start_day, v_uid)
    returning id into v_household_id;

  insert into household_members (household_id, user_id, role)
    values (v_household_id, v_uid, 'owner');

  -- Default categories. Editable and deletable — nothing here is sacred.
  foreach v_cat in array array[
    'Groceries', 'Rent', 'Fuel', 'Dining', 'Utilities', 'Shopping',
    'Travel', 'Healthcare', 'Entertainment', 'Subscription', 'Education'
  ] loop
    insert into categories (household_id, name, sort_order)
      values (v_household_id, v_cat, v_order);
    v_order := v_order + 10;
  end loop;

  insert into payment_methods (household_id, owner_user_id, label)
    values (v_household_id, v_uid, 'Cash');

  insert into contribution_configs (household_id, model, effective_from, created_by)
    values (
      v_household_id,
      p_model,
      period_start_for(current_date, p_period_start_day),
      v_uid
    )
    returning id into v_config_id;

  -- For 'equal' the share value is ignored by the engine; for 'ratio' the
  -- partner receives the remainder when they accept the invitation.
  insert into contribution_shares (config_id, user_id, ratio_bp)
    values (
      v_config_id,
      v_uid,
      case when p_model = 'ratio' then greatest(least(p_my_ratio_bp, 10000), 0) else 10000 end
    );

  perform get_or_create_period(v_household_id, current_date);

  return v_household_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: accept an invite.
--
-- Also rebalances the active equal-split config so a brand new member is not
-- left with a 0% share, which would silently make every settlement wrong.
-- ---------------------------------------------------------------------------
create or replace function accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite household_invites;
  v_config_id uuid;
  v_model contribution_model;
  v_member_count int;
  v_remainder_bp int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invite from household_invites where token = p_token;

  if not found then
    raise exception 'This invitation link is not valid.';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invitation has already been used.';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invitation has expired. Ask your partner to send a new one.';
  end if;

  insert into household_members (household_id, user_id, role)
    values (v_invite.household_id, v_uid, 'member')
    on conflict (household_id, user_id) do update set left_at = null;

  update household_invites
    set accepted_at = now(), accepted_by = v_uid
    where id = v_invite.id;

  insert into payment_methods (household_id, owner_user_id, label)
    values (v_invite.household_id, v_uid, 'Cash');

  select id, model into v_config_id, v_model from contribution_configs
    where household_id = v_invite.household_id
    order by effective_from desc, created_at desc
    limit 1;

  select count(*) into v_member_count from household_members
    where household_id = v_invite.household_id and left_at is null;

  if v_config_id is not null and v_member_count > 0 then
    if v_model = 'equal' then
      insert into contribution_shares (config_id, user_id, ratio_bp)
        values (v_config_id, v_uid, 0)
        on conflict (config_id, user_id) do nothing;

      update contribution_shares
        set ratio_bp = 10000 / v_member_count
        where config_id = v_config_id;

      -- Remainder to the joining member so shares always total exactly 10000.
      update contribution_shares
        set ratio_bp = ratio_bp + (10000 - (10000 / v_member_count) * v_member_count)
        where config_id = v_config_id and user_id = v_uid;

    elsif v_model = 'ratio' then
      -- The inviter already chose their percentage during onboarding.
      -- Give the joining member whatever is left, so the two always total 100%.
      select 10000 - coalesce(sum(ratio_bp), 0) into v_remainder_bp
        from contribution_shares where config_id = v_config_id;

      insert into contribution_shares (config_id, user_id, ratio_bp)
        values (v_config_id, v_uid, greatest(v_remainder_bp, 0))
        on conflict (config_id, user_id) do update set ratio_bp = greatest(v_remainder_bp, 0);

    else -- fixed
      insert into contribution_shares (config_id, user_id, fixed_amount_paise)
        values (v_config_id, v_uid, 0)
        on conflict (config_id, user_id) do nothing;
    end if;
  end if;

  return v_invite.household_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: read an invite by token before the user is a member of anything.
-- ---------------------------------------------------------------------------
create or replace function peek_invite(p_token text)
returns table (household_name text, invited_by_name text, expires_at timestamptz, already_used boolean)
language sql
stable
security definer
set search_path = public
as $$
  select h.name, p.display_name, i.expires_at, i.accepted_at is not null
  from household_invites i
  join households h on h.id = i.household_id
  join profiles p on p.id = i.invited_by
  where i.token = p_token;
$$;


-- ================================================================
-- supabase/migrations/0003_rls.sql
-- ================================================================

-- ============================================================================
-- 0003_rls.sql — Row Level Security
--
-- Model: a row is visible to you if you are an active member of its household.
-- Both partners can read and edit everything. Permission walls between
-- spouses create friction and solve nothing; the audit log is the safeguard.
-- ============================================================================

-- Lookup helpers, SECURITY DEFINER so that policy subqueries do not re-enter
-- RLS on the referenced table.
create or replace function config_household(p_config_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from contribution_configs where id = p_config_id;
$$;

create or replace function transaction_household(p_transaction_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from transactions where id = p_transaction_id;
$$;

alter table profiles              enable row level security;
alter table households            enable row level security;
alter table household_members     enable row level security;
alter table household_invites     enable row level security;
alter table contribution_configs  enable row level security;
alter table contribution_shares   enable row level security;
alter table categories            enable row level security;
alter table payment_methods       enable row level security;
alter table settlement_periods    enable row level security;
alter table transactions          enable row level security;
alter table transaction_splits    enable row level security;
alter table settlement_transfers  enable row level security;
alter table audit_log             enable row level security;
alter table recurring_templates   enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or shares_household_with(id));

create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_own on profiles for insert to authenticated
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create policy households_select on households for select to authenticated
  using (is_household_member(id));

create policy households_insert on households for insert to authenticated
  with check (created_by = auth.uid());

create policy households_update on households for update to authenticated
  using (is_household_member(id)) with check (is_household_member(id));

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------
create policy household_members_select on household_members for select to authenticated
  using (is_household_member(household_id));

-- Joining happens only through create_household / accept_invite (definer RPCs).
-- A member may update their own row, which is how leaving works.
create policy household_members_update_self on household_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- household_invites
--
-- The invitee is not a member yet, so they cannot select their own invite.
-- They read it through peek_invite() and redeem it through accept_invite().
-- ---------------------------------------------------------------------------
create policy household_invites_select on household_invites for select to authenticated
  using (is_household_member(household_id));

create policy household_invites_insert on household_invites for insert to authenticated
  with check (is_household_member(household_id) and invited_by = auth.uid());

create policy household_invites_delete on household_invites for delete to authenticated
  using (is_household_member(household_id) and accepted_at is null);

-- ---------------------------------------------------------------------------
-- contribution config
-- ---------------------------------------------------------------------------
create policy contribution_configs_select on contribution_configs for select to authenticated
  using (is_household_member(household_id));

create policy contribution_configs_insert on contribution_configs for insert to authenticated
  with check (is_household_member(household_id) and created_by = auth.uid());

-- Configs are effective-dated history. A future-dated one may be corrected or
-- withdrawn; a config that has already taken effect may not.
create policy contribution_configs_update_future on contribution_configs for update to authenticated
  using (is_household_member(household_id) and effective_from > current_date)
  with check (is_household_member(household_id) and effective_from > current_date);

create policy contribution_configs_delete_future on contribution_configs for delete to authenticated
  using (is_household_member(household_id) and effective_from > current_date);

create policy contribution_shares_all on contribution_shares for all to authenticated
  using (is_household_member(config_household(config_id)))
  with check (is_household_member(config_household(config_id)));

-- ---------------------------------------------------------------------------
-- categories / payment methods
-- ---------------------------------------------------------------------------
create policy categories_all on categories for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy payment_methods_all on payment_methods for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- settlement periods
-- ---------------------------------------------------------------------------
create policy settlement_periods_select on settlement_periods for select to authenticated
  using (is_household_member(household_id));

create policy settlement_periods_insert on settlement_periods for insert to authenticated
  with check (is_household_member(household_id));

create policy settlement_periods_update on settlement_periods for update to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- transactions
--
-- No DELETE policy: deletion is always a soft delete (an UPDATE setting
-- deleted_at). Hard deletes are impossible from the client by construction.
-- ---------------------------------------------------------------------------
create policy transactions_select on transactions for select to authenticated
  using (is_household_member(household_id));

create policy transactions_insert on transactions for insert to authenticated
  with check (is_household_member(household_id) and created_by = auth.uid());

create policy transactions_update on transactions for update to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy transaction_splits_select on transaction_splits for select to authenticated
  using (is_household_member(transaction_household(transaction_id)));

create policy transaction_splits_write on transaction_splits for all to authenticated
  using (is_household_member(transaction_household(transaction_id)))
  with check (is_household_member(transaction_household(transaction_id)));

-- ---------------------------------------------------------------------------
-- settlement transfers
-- ---------------------------------------------------------------------------
create policy settlement_transfers_select on settlement_transfers for select to authenticated
  using (is_household_member(household_id));

create policy settlement_transfers_insert on settlement_transfers for insert to authenticated
  with check (is_household_member(household_id) and created_by = auth.uid());

create policy settlement_transfers_update on settlement_transfers for update to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- audit log — readable by the household, writable only by the definer trigger
-- ---------------------------------------------------------------------------
create policy audit_log_select on audit_log for select to authenticated
  using (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- recurring templates
-- ---------------------------------------------------------------------------
create policy recurring_templates_all on recurring_templates for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function is_household_member(uuid)       to authenticated;
grant execute on function shares_household_with(uuid)     to authenticated;
grant execute on function config_household(uuid)          to authenticated;
grant execute on function transaction_household(uuid)     to authenticated;
grant execute on function period_start_for(date, smallint) to authenticated;
grant execute on function get_or_create_period(uuid, date) to authenticated;
grant execute on function create_household(text, smallint, contribution_model, integer) to authenticated;
grant execute on function accept_invite(text)             to authenticated;
grant execute on function peek_invite(text)               to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: the partner's phone should light up when a transaction lands.
-- This is change notification, not collaborative editing.
-- ---------------------------------------------------------------------------
-- Guarded, so re-running the migration is safe and so it does not fail on a
-- project where the publication was created FOR ALL TABLES.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and puballtables) then
    return;
  end if;

  foreach t in array array['transactions', 'settlement_transfers', 'settlement_periods'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

