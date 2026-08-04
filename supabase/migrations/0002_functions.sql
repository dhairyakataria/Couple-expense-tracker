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
