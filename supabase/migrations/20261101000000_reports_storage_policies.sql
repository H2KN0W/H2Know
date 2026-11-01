-- Migration: 20261101000000_reports_storage_policies.sql
-- Description: Add RLS SELECT and INSERT policies on storage.objects for the 'reports' bucket.
-- Ensures managers can only download their own reports, admins can download all reports,
-- and creators can upload their generated report files. Safe and idempotent.

-- 1. Helper function to check if the current user is an approved admin
create or replace function public.is_admin()
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
       and p.role = 'admin'
       and p.status = 'approved'
  );
$$;

-- 2. Storage RLS Policies for the 'reports' bucket
-- Note: objects in 'reports' bucket are stored with path: 'reports/<report_id>.<format>'

-- SELECT policy: Managers can only read their own reports; Admins can read all reports.
drop policy if exists "Users can read own reports or admin all" on storage.objects;
create policy "Users can read own reports or admin all"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'reports'
    and (
      public.is_admin()
      or exists (
        select 1
          from public.reports r
         where r.generated_by = auth.uid()
           and (
             storage.objects.name = ('reports/' || r.id::text || '.' || r.format)
             or storage.objects.name = (r.id::text || '.' || r.format)
           )
      )
    )
  );

-- INSERT policy: Authenticated users can upload files for reports they generated.
drop policy if exists "Users can upload own reports" on storage.objects;
create policy "Users can upload own reports"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'reports'
    and (
      public.is_admin()
      or exists (
        select 1
          from public.reports r
         where r.generated_by = auth.uid()
           and (
             storage.objects.name = ('reports/' || r.id::text || '.' || r.format)
             or storage.objects.name = (r.id::text || '.' || r.format)
           )
      )
    )
  );
