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
