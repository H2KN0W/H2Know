-- ============================================================================
-- H2KNOW · Reports pending status migration
-- Date: 2026-10-17
-- Allows report requests to start in 'pending' state before manual download.
-- ============================================================================

-- 1. Drop existing check constraint and replace with one that includes 'pending'
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('pending', 'success', 'failed'));

-- 2. Update column default to 'pending'
alter table public.reports alter column status set default 'pending';

-- 3. Confirm manager_update_own_reports policy exists
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'reports'
      and policyname = 'manager_update_own_reports'
  ) then
    create policy "manager_update_own_reports"
      on public.reports for update to authenticated
      using (public.manager_can_access() and generated_by = auth.uid())
      with check (public.manager_can_access() and generated_by = auth.uid());
  end if;
end $$;
