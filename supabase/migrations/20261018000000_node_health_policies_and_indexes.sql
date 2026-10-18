-- Migration: 20261018000000_node_health_policies_and_indexes.sql
-- Description: Add SELECT RLS policies and performance indexes for Admin Node Health monitoring (node_status, sensor_readings_raw)
-- Safe to execute repeatedly (idempotent).

-- ============================================================================
-- 1. Performance Indexes for Bounded Range Queries
-- ============================================================================
create index if not exists idx_node_status_node_recorded 
  on public.node_status (node_id, recorded_at desc);

create index if not exists idx_sensor_readings_raw_node_recorded 
  on public.sensor_readings_raw (node_id, recorded_at desc);

-- ============================================================================
-- 2. Row Level Security (RLS) Enablement (safeguard)
-- ============================================================================
alter table public.node_status enable row level security;
alter table public.sensor_readings_raw enable row level security;

-- ============================================================================
-- 3. SELECT Policies for Approved Administrators
-- ============================================================================
-- NOTE ON EXISTING POLICIES:
-- The existing policies 'anon insert status' on node_status and 'anon insert raw' 
-- on sensor_readings_raw have WITH CHECK (true), which allows anyone holding the
-- Supabase anon key to write arbitrary rows. In accordance with project instructions,
-- these anon INSERT policies are left untouched in this branch.

drop policy if exists "Admins can view node_status" on public.node_status;
create policy "Admins can view node_status"
  on public.node_status
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.status = 'approved'
    )
  );

drop policy if exists "Admins can view sensor_readings_raw" on public.sensor_readings_raw;
create policy "Admins can view sensor_readings_raw"
  on public.sensor_readings_raw
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.status = 'approved'
    )
  );
