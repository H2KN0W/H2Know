-- Manager portal support. Apply with `supabase db push` or in the Supabase SQL editor.
-- Existing alerts had no lifecycle state; all existing rows begin as active.
alter table public.alerts
  add column if not exists status text not null default 'active'
    check (status in ('active', 'reviewed', 'resolved')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id);

alter table public.reports
  add column if not exists report_name text,
  add column if not exists parameters text[] not null default '{}',
  add column if not exists format text not null default 'pdf'
    check (format in ('pdf', 'csv'));

-- Managers need read access to monitoring data and report records, and may update
-- alert lifecycle fields / create their own report requests. Adjust policies to match
-- your existing RLS policy naming if these tables already have broader policies.
-- The application relies on these permissions; enforce them through your normal RLS setup.
