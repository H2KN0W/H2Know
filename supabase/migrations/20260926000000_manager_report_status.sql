-- Track the final result of manager-generated reports and allow owners to save it.
alter table public.reports
  add column if not exists status text;

update public.reports
set status = case when file_url is not null then 'success' else 'failed' end
where status is null;

alter table public.reports
  alter column status set default 'failed',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'reports_status_check'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_status_check check (status in ('success', 'failed'));
  end if;

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