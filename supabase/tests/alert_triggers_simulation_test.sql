-- =============================================================================
-- Verification & Simulation Test Script for Server-Side Alert Triggers
-- Run this in the Supabase SQL Editor or psql to test the trigger behavior.
-- Everything runs inside a transaction and ends with ROLLBACK, leaving zero residue.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PREFLIGHT: Verify assumed columns exist before running tests.
-- Raises an exception immediately (outside the main transaction) if the schema
-- is wrong, so no DML runs against a broken schema.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text := '';
  chk record;
begin
  for chk in (
    select tbl, col from (values
      ('sensor_readings',     'node_id'),
      ('sensor_readings',     'parameter_id'),
      ('sensor_readings',     'value'),
      ('sensor_readings',     'recorded_at'),
      ('sensor_readings',     'source'),
      ('sensor_readings_raw', 'node_id'),
      ('sensor_readings_raw', 'recorded_at'),
      ('sensor_readings_raw', 'quality_flags'),
      ('parameters',          'id'),
      ('parameters',          'name'),
      ('parameters',          'unit'),
      ('thresholds',          'parameter_id'),
      ('thresholds',          'min_value'),
      ('thresholds',          'max_value'),
      ('thresholds',          'severity_label'),
      ('nodes',               'id'),
      ('nodes',               'device_key'),
      ('nodes',               'device_label'),
      ('alerts',              'node_id'),
      ('alerts',              'parameter_id'),
      ('alerts',              'reading_id'),
      ('alerts',              'status'),
      ('alert_rules',         'parameter_id'),
      ('alert_rules',         'warning_n'),
      ('alert_rules',         'critical_n'),
      ('alert_rules',         'clear_n'),
      ('alert_rules',         'clear_margin'),
      ('alert_rules',         'min_plausible'),
      ('alert_rules',         'max_plausible')
    ) as t(tbl, col)
    where not exists (
      select 1 from information_schema.columns ic
      where ic.table_schema = 'public'
        and ic.table_name   = t.tbl
        and ic.column_name  = t.col
    )
  ) loop
    missing := missing || chk.tbl || '.' || chk.col || ', ';
  end loop;

  if missing <> '' then
    raise exception 'PREFLIGHT FAILED — missing columns: %. Fix schema (apply migration 20261104000000_server_side_alerts.sql) before running tests.',
      rtrim(missing, ', ');
  end if;

  raise notice 'PREFLIGHT OK — all expected columns present.';

  -- Show the allowed source values from the DB check constraint (informational)
  declare
    v_src_constraint text;
  begin
    select pg_get_constraintdef(oid) into v_src_constraint
    from pg_constraint
    where conrelid = 'public.sensor_readings'::regclass
      and conname = 'sensor_readings_source_check';
    if v_src_constraint is not null then
      raise notice 'PREFLIGHT INFO — sensor_readings_source_check: %', v_src_constraint;
    end if;
  end;
end $$;

begin;

do $$
declare
  v_test_node_id uuid := gen_random_uuid();
  v_ph_param_id uuid;
  v_tds_param_id uuid;
  v_base_time timestamptz := '2026-11-04 10:00:00+08';
  v_alert_count integer;
  v_alert_status text;
  v_alert_sev text;
  v_reading_id uuid;
begin
  raise notice '>>> Starting Alert Trigger Verification Test Suite...';

  -- 1. Setup test parameters and thresholds if needed
  select id into v_ph_param_id from public.parameters where lower(trim(name)) = 'ph' limit 1;
  select id into v_tds_param_id from public.parameters where lower(trim(name)) = 'tds' limit 1;

  if v_ph_param_id is null or v_tds_param_id is null then
    raise notice 'Required parameters pH or TDS not found. Inserting temporary test parameters...';
    if v_ph_param_id is null then
      insert into public.parameters (id, name, unit) values (gen_random_uuid(), 'pH', 'pH') returning id into v_ph_param_id;
    end if;
    if v_tds_param_id is null then
      insert into public.parameters (id, name, unit) values (gen_random_uuid(), 'TDS', 'ppm') returning id into v_tds_param_id;
    end if;
  end if;

  -- Ensure alert_rules exist for test parameters
  insert into public.alert_rules (parameter_id, warning_n, critical_n, clear_n, clear_margin, min_plausible, max_plausible)
  values (v_ph_param_id, 2, 1, 2, 0.2, 0.0, 14.0)
  on conflict (parameter_id) do nothing;

  insert into public.alert_rules (parameter_id, warning_n, critical_n, clear_n, clear_margin, min_plausible, max_plausible)
  values (v_tds_param_id, 2, 1, 2, 20.0, 0.001, 2000.0)
  on conflict (parameter_id) do nothing;

  -- Ensure threshold bands exist
  delete from public.thresholds where parameter_id in (v_ph_param_id, v_tds_param_id);
  
  -- pH: Safe: 6.5 - 8.5, Warning: 6.0 - 6.49 or 8.51 - 9.0, Critical: < 6.0 or > 9.0
  insert into public.thresholds (parameter_id, min_value, max_value, severity_label) values
    (v_ph_param_id, 6.5, 8.5, 'safe'),
    (v_ph_param_id, 6.0, 6.49, 'warning'),
    (v_ph_param_id, 0.0, 5.99, 'critical');

  -- Create temporary test node.
  -- nodes has a NOT NULL device_key column (unique hardware key).
  -- We use the UUID cast to text as a safe throwaway value.
  insert into public.nodes (id, device_key, device_label)
  values (v_test_node_id, v_test_node_id::text, 'Test-Node-Sim')
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------------------
  -- TEST 1: Single Warning Spike (Should NOT trigger alert, warning_n = 2)
  -- ---------------------------------------------------------------------------
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 6.3, v_base_time, 'live');

  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');

  assert v_alert_count = 0, 'Test 1 Failed: Single spike generated alert';
  raise notice 'Test 1 Passed: Single warning spike did not trigger alert';

  -- ---------------------------------------------------------------------------
  -- TEST 2: Second Consecutive Warning Breach (Should Trigger Alert)
  -- ---------------------------------------------------------------------------
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 6.2, v_base_time + interval '30 minutes', 'live');

  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');

  assert v_alert_count = 1, 'Test 2 Failed: Second warning breach did not generate alert';
  raise notice 'Test 2 Passed: 2 consecutive warning breaches generated active alert';

  -- ---------------------------------------------------------------------------
  -- TEST 3: Continued Breach (Should NOT create duplicate alert row)
  -- ---------------------------------------------------------------------------
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 6.1, v_base_time + interval '60 minutes', 'live');

  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');

  assert v_alert_count = 1, 'Test 3 Failed: Duplicate active alert row created';
  raise notice 'Test 3 Passed: Continued breach did not create duplicate row';

  -- ---------------------------------------------------------------------------
  -- TEST 4: Escalation to Critical on First Reading (warning -> critical)
  -- ---------------------------------------------------------------------------
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 5.5, v_base_time + interval '90 minutes', 'live');

  select count(*), max(message) into v_alert_count, v_alert_sev
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');

  assert v_alert_count = 1, 'Test 4 Failed: Alert row count changed during escalation';
  assert v_alert_sev like '%critical%', 'Test 4 Failed: Open alert was not escalated to critical';
  raise notice 'Test 4 Passed: Open alert successfully escalated to critical';

  -- ---------------------------------------------------------------------------
  -- TEST 5: Hovering in Hysteresis Band (Safe is 6.5, margin is 0.2 -> clear requires >= 6.7)
  -- Reading of 6.55 is safe, but inside hysteresis band (< 6.7). Should NOT clear.
  -- ---------------------------------------------------------------------------
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 6.55, v_base_time + interval '120 minutes', 'live');

  select status into v_alert_status
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id;

  assert v_alert_status in ('active', 'reviewed'), 'Test 5 Failed: Alert cleared inside hysteresis band';
  raise notice 'Test 5 Passed: Reading hovering in hysteresis band did not clear alert';

  -- ---------------------------------------------------------------------------
  -- TEST 6: Auto-Clear with 2 Consecutive Clean Readings (>= 6.7)
  -- ---------------------------------------------------------------------------
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 7.0, v_base_time + interval '150 minutes', 'live');
  -- Still active after 1 safe reading (clear_n = 2)
  select status into v_alert_status
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id;
  assert v_alert_status in ('active', 'reviewed'), 'Test 6a Failed: Alert cleared after only 1 safe reading';

  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 7.1, v_base_time + interval '180 minutes', 'live');
  -- Now resolved
  select status into v_alert_status
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id;
  assert v_alert_status = 'resolved', 'Test 6b Failed: Alert did not auto-clear after 2 safe readings';
  raise notice 'Test 6 Passed: Auto-clear resolved alert after 2 clean readings outside margin';

  -- ---------------------------------------------------------------------------
  -- TEST 7: TDS = 0 (Unplausible) and Quality Flags (Suspect)
  -- ---------------------------------------------------------------------------
  -- TDS = 0 reading is physically implausible (dry/disconnected sensor)
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_tds_param_id, 0.0, v_base_time, 'live');

  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_tds_param_id and status in ('active', 'reviewed');
  assert v_alert_count = 0, 'Test 7 Failed: TDS = 0 triggered false alert';
  raise notice 'Test 7 Passed: TDS <= 0 was gated out as invalid and generated no alert';

  -- ---------------------------------------------------------------------------
  -- TEST 8: Out-of-order Backlog Insert (Ignored for live alerting)
  -- ---------------------------------------------------------------------------
  -- Insert an old breaching reading (recorded before latest 180 min).
  -- Source 'live' is used; the trigger ignores it because recorded_at is older
  -- than the current latest reading, which is the actual skip condition.
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 5.0, v_base_time + interval '15 minutes', 'live');

  -- Active count must still be 0 (no new active alert created by backlog insert)
  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');
  assert v_alert_count = 0, 'Test 8 Failed: Backfilled out-of-order reading triggered live alert';
  raise notice 'Test 8 Passed: Historical backlog insertion was safely ignored';

  -- ---------------------------------------------------------------------------
  -- TEST 9: Late-arriving Raw Quality Flag Reconciliation
  -- ---------------------------------------------------------------------------
  -- Post critical pH reading without raw row yet
  insert into public.sensor_readings (node_id, parameter_id, value, recorded_at, source)
  values (v_test_node_id, v_ph_param_id, 5.2, v_base_time + interval '210 minutes', 'live')
  returning id into v_reading_id;

  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');
  assert v_alert_count = 1, 'Test 9 Setup Failed: Critical reading did not trigger';

  -- Late arrival of sensor_readings_raw with FLAG_PH_SUSPECT (0x02)
  insert into public.sensor_readings_raw (node_id, recorded_at, quality_flags)
  values (v_test_node_id, v_base_time + interval '210 minutes', 2);

  -- Re-evaluation triggered by sensor_readings_raw should suppress the alert
  -- Since previous readings were safe (7.1 at 180 min), the invalid 5.2 is ignored, returning to resolved/no active
  select count(*) into v_alert_count
  from public.alerts
  where node_id = v_test_node_id and parameter_id = v_ph_param_id and status in ('active', 'reviewed');
  assert v_alert_count = 0, 'Test 9 Failed: Late-arriving suspect quality flag did not reconcile alert';
  raise notice 'Test 9 Passed: Late-arriving raw quality flag reconciled and suppressed false alert';

  raise notice '>>> ALL 9 ALERT TRIGGER SIMULATION TESTS COMPLETED SUCCESSFULLY! <<<';
end $$;

rollback;
