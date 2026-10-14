-- ============================================================================
-- H2KNOW · Security hardening migration
-- Applied by: audit/security-hardening branch
-- Date: 2026-10-14
-- ============================================================================
--
-- 1. Force-enable RLS on every critical table so a future SECURITY DEFINER
--    call or superuser bypass cannot silently skip row-level checks.
--
-- 2. Add the missing activity_logs RLS policies:
--    • Only the admin role may SELECT rows (prevents any authenticated user
--      from reading other users' activity history via a direct API call).
--    • INSERT is granted only through the log-activity Edge Function, which
--      uses SERVICE_ROLE; no direct client insert is permitted.
--
-- 3. Rate-limit helper: a lightweight per-user+action window table backed by
--    a Postgres function. This acts as a server-side guard complementing any
--    client-side or Supabase API Gateway limits.
--
-- NOTE: "CREATE POLICY IF NOT EXISTS" is not supported by PostgreSQL;
--       each policy is guarded with a pg_policies existence check.

-- ── SEC-3: Force-enable RLS everywhere ───────────────────────────────────────
-- "ALTER TABLE … FORCE ROW LEVEL SECURITY" prevents table owners (superusers
-- are still exempt from RLS unless this is set) from bypassing policies.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'alerts', 'reports', 'sensor_readings',
    'parameters', 'thresholds', 'nodes', 'monitoring_sites', 'activity_logs'
  ]
  loop
    if exists (
      select 1 from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
    end if;
  end loop;
end $$;

-- ── SEC-3: activity_logs RLS policies ────────────────────────────────────────
-- The log-activity Edge Function uses SERVICE_ROLE key, which bypasses RLS.
-- The policies below govern any *direct* client API access.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'activity_logs' and c.relkind = 'r'
  ) then

    -- Admin-only SELECT: only approved admins may read logs directly.
    if not exists (
      select 1 from pg_catalog.pg_policies
       where schemaname = 'public'
         and tablename  = 'activity_logs'
         and policyname = 'admin_select_activity_logs'
    ) then
      execute $policy$
        create policy "admin_select_activity_logs"
          on public.activity_logs
          for select
          to authenticated
          using (
            exists (
              select 1 from public.profiles p
               where p.id = auth.uid()
                 and p.role   = 'admin'
                 and p.status = 'approved'
            )
          )
      $policy$;
    end if;

    -- Block direct client INSERTs: all writes must go through the Edge Function
    -- (which uses SERVICE_ROLE and validates the JWT server-side).
    if not exists (
      select 1 from pg_catalog.pg_policies
       where schemaname = 'public'
         and tablename  = 'activity_logs'
         and policyname = 'deny_direct_client_insert_activity_logs'
    ) then
      execute $policy$
        create policy "deny_direct_client_insert_activity_logs"
          on public.activity_logs
          for insert
          to authenticated
          with check (false)
      $policy$;
    end if;

  end if;
end $$;

-- ── SEC-6: Server-side rate-limit table ──────────────────────────────────────
-- Tracks recent calls per (user_id, action) in a 1-minute sliding window.
-- The Edge Functions call check_rate_limit() before processing sensitive actions.

create table if not exists public.rate_limit_log (
  id          bigserial     primary key,
  user_id     uuid          not null,
  action      text          not null,
  created_at  timestamptz   not null default now()
);

-- Index supporting the window look-back query
create index if not exists idx_rll_user_action_time
  on public.rate_limit_log (user_id, action, created_at desc);

-- RLS: this table is written only by Edge Functions (SERVICE_ROLE), never by clients.
alter table public.rate_limit_log enable row level security;
alter table public.rate_limit_log force row level security;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename  = 'rate_limit_log'
       and policyname = 'no_client_access_rate_limit_log'
  ) then
    execute $policy$
      create policy "no_client_access_rate_limit_log"
        on public.rate_limit_log
        for all
        to authenticated
        using (false)
    $policy$;
  end if;
end $$;

-- Helper function called by Edge Functions to enforce rate limits.
-- Returns TRUE when the caller is within the allowed budget.
-- SECURITY DEFINER so it can read the table despite the deny-all RLS policy above.
create or replace function public.check_rate_limit(
  p_user_id  uuid,
  p_action   text,
  p_max_calls int     default 10,
  p_window_s  int     default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Prune old entries first (keep table small)
  delete from public.rate_limit_log
   where user_id = p_user_id
     and action  = p_action
     and created_at < now() - (p_window_s || ' seconds')::interval;

  select count(*) into v_count
    from public.rate_limit_log
   where user_id = p_user_id
     and action  = p_action
     and created_at >= now() - (p_window_s || ' seconds')::interval;

  if v_count >= p_max_calls then
    return false; -- rate limit exceeded
  end if;

  insert into public.rate_limit_log (user_id, action) values (p_user_id, p_action);
  return true;
end;
$$;
