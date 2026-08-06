-- ============================================================================
-- 0004_single_active_household.sql
--
-- Bug: accept_invite() and create_household() never checked whether the
-- caller already had an active household. Two people who invited each other
-- both ended up as members of TWO different households at once, and each
-- app query that picks "the" household (order by joined_at limit 1) resolved
-- to a different one for each of them — so nothing ever synced.
--
-- Fix: enforce "at most one active household per user" at the database
-- level (belt), and raise a friendly error from the RPCs before that
-- constraint would ever fire (suspenders).
-- ============================================================================

-- A user may have many historical (left_at is not null) rows, but at most
-- one row where left_at is null.
create unique index if not exists household_members_one_active_per_user
  on household_members (user_id)
  where left_at is null;

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

  -- Refuse to double-enrol: if the caller is already active in a DIFFERENT
  -- household, they must leave it first. Re-accepting an invite to a
  -- household they're already in (or previously left) is still fine.
  if exists (
    select 1 from household_members
    where user_id = v_uid
      and left_at is null
      and household_id <> v_invite.household_id
  ) then
    raise exception 'You are already part of a household. Leave it in Settings before joining another.';
  end if;

  insert into household_members (household_id, user_id, role)
    values (v_invite.household_id, v_uid, 'member')
    on conflict (household_id, user_id) do update set left_at = null;

  update household_invites
    set accepted_at = now(), accepted_by = v_uid
    where id = v_invite.id;

  insert into payment_methods (household_id, owner_user_id, label)
    values (v_invite.household_id, v_uid, 'Cash')
    on conflict do nothing;

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

      update contribution_shares
        set ratio_bp = ratio_bp + (10000 - (10000 / v_member_count) * v_member_count)
        where config_id = v_config_id and user_id = v_uid;

    elsif v_model = 'ratio' then
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

  if exists (select 1 from household_members where user_id = v_uid and left_at is null) then
    raise exception 'You are already part of a household.';
  end if;

  insert into households (name, period_start_day, created_by)
    values (p_name, p_period_start_day, v_uid)
    returning id into v_household_id;

  insert into household_members (household_id, user_id, role)
    values (v_household_id, v_uid, 'owner');

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
-- Leaving a household.
--
-- household_members_update_self (0003_rls.sql) already lets a member update
-- their own row, which is how the app sets left_at from the client. This RPC
-- exists only so "leave" is one call instead of the client having to know
-- its own household_id first, and so a household is never left with zero
-- active owners left holding nothing (last member out just leaves; the
-- household row itself is harmless to leave behind, same as any other
-- abandoned household).
-- ---------------------------------------------------------------------------
create or replace function leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update household_members
  set left_at = now()
  where user_id = v_uid and left_at is null;
end;
$$;

grant execute on function leave_household() to authenticated;
