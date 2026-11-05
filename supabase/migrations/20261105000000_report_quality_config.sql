-- ============================================================================
-- H2KNOW · Report Quality Configuration Table
-- Applied by: feat/report-quality-config branch
-- Date: 2026-11-05
-- ============================================================================
--
-- Stores the four telemetry-sufficiency settings that govern when a report
-- period has enough data to issue a compliance verdict. Previously these
-- were hardcoded constants in reportQualityConfig.js; this migration makes
-- them live-configurable per deployment without a code redeploy.
--
-- Keys (all numeric, stored as text for flexibility):
--   min_valid_readings  — minimum unflagged readings required   (default: 20)
--   min_coverage_hours  — minimum time spread in hours          (default: 12)
--   max_gap_minutes     — maximum gap between readings (minutes) (default: 180)
--   stale_threshold_hours — age limit before telemetry is stale (default: 48)
--
-- Access:
--   • Managers and admins can SELECT (read the config in report generation).
--   • Only admins can INSERT / UPDATE / DELETE.
-- ============================================================================

create table if not exists public.report_quality_config (
  key         text        primary key,
  value       numeric     not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- Seed defaults (identical to the old hardcoded constants so existing reports
-- are unaffected by the migration). Use ON CONFLICT DO NOTHING so a re-run
-- of this migration never overwrites values an admin has already customised.
insert into public.report_quality_config (key, value, description) values
  ('min_valid_readings',   20,  'Minimum number of QC-valid (unflagged) readings required to issue a compliance verdict'),
  ('min_coverage_hours',   12,  'Minimum time span in hours between first and last reading required for a valid report period'),
  ('max_gap_minutes',     180,  'Maximum allowable gap in minutes between consecutive readings before coverage is considered insufficient'),
  ('stale_threshold_hours', 48, 'Readings older than this many hours relative to now are flagged as stale telemetry')
on conflict (key) do nothing;

-- RLS
alter table public.report_quality_config enable row level security;
alter table public.report_quality_config force row level security;

-- Managers and admins may read config
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename  = 'report_quality_config'
       and policyname = 'authenticated_select_report_quality_config'
  ) then
    execute $policy$
      create policy "authenticated_select_report_quality_config"
        on public.report_quality_config
        for select
        to authenticated
        using (true)
    $policy$;
  end if;
end $$;

-- Only admins may modify config
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename  = 'report_quality_config'
       and policyname = 'admin_write_report_quality_config'
  ) then
    execute $policy$
      create policy "admin_write_report_quality_config"
        on public.report_quality_config
        for all
        to authenticated
        using (
          exists (
            select 1 from public.profiles p
             where p.id     = auth.uid()
               and p.role   = 'admin'
               and p.status = 'approved'
          )
        )
        with check (
          exists (
            select 1 from public.profiles p
             where p.id     = auth.uid()
               and p.role   = 'admin'
               and p.status = 'approved'
          )
        )
    $policy$;
  end if;
end $$;
