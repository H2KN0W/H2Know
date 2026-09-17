-- Manager portal RLS policies.
--
-- This is a SEPARATE migration from 20260809000000_manager_portal.sql so the
-- schema changes are not coupled to a specific RLS policy naming scheme, and so
-- RLS policy creation can be reviewed/applied independently.
--
-- These policies are ADDITIVE ONLY: they only CREATE policies and never alter or
-- drop existing policies, so existing admin/authenticated alert and report
-- policies are NOT weakened in any way.
--
-- A user is treated as a manager when their `profiles` row has role = 'manager'
-- AND status = 'approved' (mirrors the authorization check in ProtectedRoute.jsx).
--
-- Requires PostgreSQL 15+ (uses SECURITY DEFINER and the pg_policies view).
--
-- NOTE: PostgreSQL's CREATE POLICY has no "IF NOT EXISTS" option, so each policy
-- is guarded explicitly by checking pg_policies before creating it. That keeps
-- this migration safe to re-run without raising "already exists" errors.
--
-- The tables (alerts, reports, sensor_readings, parameters, thresholds, nodes,
-- monitoring_sites, profiles) are created/managed outside this set of migrations
-- (via the app's schema/seed setup), so every policy is also guarded by a
-- table-existence check to keep this migration safe to apply even before those
-- tables exist.

-- Small helper used by the guarded DO blocks below: returns true when a
-- public-schema table with the given name exists.
create or replace function public.__manager_table_exists(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = p_name
       and c.relkind = 'r'
  );
$$;

-- Returns true when a policy with the given name already exists on the table.
-- Used instead of CREATE POLICY IF NOT EXISTS (which PostgreSQL does not support).
create or replace function public.__manager_policy_exists(p_schema text, p_table text, p_policy text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from pg_catalog.pg_policies pol
     where pol.schemaname = p_schema
       and pol.tablename = p_table
       and pol.policyname = p_policy
  );
$$;

-- Reusable authorization predicate. SECURITY DEFINER lets it read profiles
-- regardless of RLS on that table, avoiding recursive policy evaluation.
create or replace function public.manager_can_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role = 'manager'
       and p.status = 'approved'
  );
$$;

-- 1) alerts: managers may VIEW alerts and REVIEW/RESOLVE them (update the
--    lifecycle columns introduced by the manager portal migration: status,
--    reviewed_at, reviewed_by).
do $$
begin
  if public.__manager_table_exists('alerts') then
    if not public.__manager_policy_exists('public', 'alerts', 'manager_select_alerts') then
      execute 'create policy "manager_select_alerts"
        on public.alerts for select to authenticated
        using ( public.manager_can_access() )';
    end if;

    if not public.__manager_policy_exists('public', 'alerts', 'manager_update_alerts') then
      execute 'create policy "manager_update_alerts"
        on public.alerts for update to authenticated
        using ( public.manager_can_access() )';
    end if;
  end if;
end $$;

-- 2) reports: managers may VIEW existing report records and REQUEST new ones.
do $$
begin
  if public.__manager_table_exists('reports') then
    if not public.__manager_policy_exists('public', 'reports', 'manager_select_reports') then
      execute 'create policy "manager_select_reports"
        on public.reports for select to authenticated
        using ( public.manager_can_access() )';
    end if;

    if not public.__manager_policy_exists('public', 'reports', 'manager_insert_reports') then
      execute 'create policy "manager_insert_reports"
        on public.reports for insert to authenticated
        with check ( public.manager_can_access() )';
    end if;
  end if;
end $$;

-- 3) monitoring data: managers may READ the live sensor metrics used by the
--    dashboard, analytics, catchment map and alert views.
do $$
declare
  t text;
begin
  foreach t in array
    array['sensor_readings', 'parameters', 'thresholds', 'nodes', 'monitoring_sites']
  loop
    if public.__manager_table_exists(t)
       and not public.__manager_policy_exists('public', t, format('manager_select_%s', t)) then
      execute format(
        'create policy "manager_select_%s"
           on public.%I for select to authenticated
           using ( public.manager_can_access() )',
        t, t
      );
    end if;
  end loop;
end $$;

-- 4) profiles: managers need to read names/roles (e.g. the reporter shown on a
--    report record, and their own name in the sidebar). The manager_can_access()
--    predicate is SECURITY DEFINER so it reads profiles even with this policy.
do $$
begin
  if public.__manager_table_exists('profiles')
     and not public.__manager_policy_exists('public', 'profiles', 'manager_select_profiles') then
    execute 'create policy "manager_select_profiles"
      on public.profiles for select to authenticated
      using ( public.manager_can_access() )';
  end if;
end $$;

-- 5) Realtime: the manager dashboard subscribes to postgres_changes on
--    sensor_readings and alerts. Ensure those tables are published to the
--    Realtime publication (guarded in case it is not yet enabled).
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime'
  ) then
    if public.__manager_table_exists('sensor_readings') then
      execute 'alter publication supabase_realtime add table public.sensor_readings';
    end if;
    if public.__manager_table_exists('alerts') then
      execute 'alter publication supabase_realtime add table public.alerts';
    end if;
  end if;
end $$;