-- REMINDER: Before applying this migration in production, check the Supabase Dashboard
-- (under Database -> Triggers, Webhooks, and pg_cron) to verify whether any existing
-- trigger, webhook, or cron job is already attached to public.sensor_readings,
-- public.sensor_readings_raw, or public.alerts.
--
-- Migration: 20261104000000_server_side_alerts.sql
-- Description: Server-side alert triggering, data-quality gating, hysteresis auto-clearing,
--              and late-arriving raw quality flag reconciliation. Fully idempotent.

-- -----------------------------------------------------------------------------
-- 0. Schema alignment & cleanup on public.alerts
-- -----------------------------------------------------------------------------

-- Ensure core lifecycle columns exist
alter table public.alerts
  add column if not exists status text not null default 'active'
    check (status in ('active', 'reviewed', 'resolved')),
  add column if not exists resolved_at timestamptz;


-- Clean up any duplicate sensor_reading_id foreign key from earlier partial runs
-- and migrate any data to the canonical reading_id column
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'alerts' and column_name = 'sensor_reading_id'
  ) then
    -- Ensure reading_id column exists
    alter table public.alerts add column if not exists reading_id uuid references public.sensor_readings(id) on delete set null;

    -- Copy sensor_reading_id to reading_id where reading_id is null
    execute 'update public.alerts set reading_id = sensor_reading_id where reading_id is null and sensor_reading_id is not null';

    -- Drop the redundant sensor_reading_id column and foreign key constraint
    alter table public.alerts drop column if exists sensor_reading_id cascade;
  else
    -- Ensure canonical reading_id column exists
    alter table public.alerts add column if not exists reading_id uuid references public.sensor_readings(id) on delete set null;
  end if;
end $$;

-- Add nullable node_id and parameter_id to public.alerts
alter table public.alerts
  add column if not exists node_id uuid references public.nodes(id) on delete cascade,
  add column if not exists parameter_id uuid references public.parameters(id) on delete cascade;

-- Backfill node_id and parameter_id from sensor_readings via reading_id
update public.alerts a
set node_id = sr.node_id,
    parameter_id = sr.parameter_id
from public.sensor_readings sr
where a.reading_id = sr.id
  and (a.node_id is null or a.parameter_id is null);

-- If any alerts still have null parameter_id, attempt backfill from thresholds
update public.alerts a
set parameter_id = t.parameter_id
from public.thresholds t
where a.threshold_id = t.id
  and a.parameter_id is null;

-- Deduplicate existing open alerts for (node_id, parameter_id) before creating index:
-- Keep the newest active/reviewed alert, and mark older open duplicates as resolved.
with ranked_open_alerts as (
  select id,
         row_number() over (
           partition by node_id, parameter_id
           order by triggered_at desc, id desc
         ) as rn
  from public.alerts
  where status in ('active', 'reviewed')
    and node_id is not null
    and parameter_id is not null
)
update public.alerts
set status = 'resolved',
    resolved_at = coalesce(resolved_at, timezone('utc', now())),
where id in (
  select id from ranked_open_alerts where rn > 1
);

-- Partial unique index on (node_id, parameter_id) WHERE status in ('active', 'reviewed')
-- Ensures at most one open alert per node and parameter.
drop index if exists idx_alerts_node_param_active;
create unique index if not exists idx_alerts_node_param_open
  on public.alerts (node_id, parameter_id)
  where status in ('active', 'reviewed');

-- Index for fast lookup of previous readings by node and parameter
create index if not exists idx_sensor_readings_node_param_rec_desc
  on public.sensor_readings (node_id, parameter_id, recorded_at desc);

-- -----------------------------------------------------------------------------
-- 1. Table: alert_rules (per parameter_id)
-- -----------------------------------------------------------------------------
create table if not exists public.alert_rules (
  parameter_id uuid primary key references public.parameters(id) on delete cascade,
  warning_n integer not null default 2 check (warning_n >= 1),
  critical_n integer not null default 1 check (critical_n >= 1),
  clear_n integer not null default 2 check (clear_n >= 1),
  clear_margin numeric not null default 0.0 check (clear_margin >= 0),
  min_plausible numeric,
  max_plausible numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.alert_rules enable row level security;

-- Authenticated users (managers/admins) can view alert rules
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'alert_rules' and policyname = 'Authenticated users can view alert_rules'
  ) then
    create policy "Authenticated users can view alert_rules"
      on public.alert_rules for select
      to authenticated
      using (true);
  end if;
end $$;

-- Seed rules for the 4 monitored water quality parameters (excluding Water Level)
insert into public.alert_rules (
  parameter_id,
  warning_n,
  critical_n,
  clear_n,
  clear_margin,
  min_plausible,
  max_plausible
)
select
  p.id,
  case when p.name = 'Turbidity' then 2 else 2 end as warning_n,
  1 as critical_n,
  2 as clear_n,
  case
    when p.name = 'pH' then 0.2
    when p.name = 'Temperature' then 1.0
    when p.name = 'TDS' then 20.0
    when p.name = 'Turbidity' then 5.0
    else 0.0
  end as clear_margin,
  case
    when p.name = 'pH' then 0.0
    when p.name = 'Temperature' then -10.0
    when p.name = 'TDS' then 0.001 -- strictly > 0, TDS <= 0 is invalid
    when p.name = 'Turbidity' then 0.0
    else null
  end as min_plausible,
  case
    when p.name = 'pH' then 14.0
    when p.name = 'Temperature' then 60.0
    when p.name = 'TDS' then 2000.0
    when p.name = 'Turbidity' then 3000.0
    else null
  end as max_plausible
from public.parameters p
where lower(trim(p.name)) in ('ph', 'temperature', 'tds', 'turbidity')
on conflict (parameter_id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Core Alert Evaluation Function
-- -----------------------------------------------------------------------------
create or replace function public.evaluate_sensor_alert(
  p_node_id uuid,
  p_parameter_id uuid,
  p_target_recorded_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule record;
  v_latest_recorded_at timestamptz;
  v_max_eval_count integer;
  v_open_alert record;
  
  -- Streak trackers
  v_warning_streak integer := 0;
  v_critical_streak integer := 0;
  v_clear_streak integer := 0;
  
  v_first_warning_threshold uuid := null;
  v_first_critical_threshold uuid := null;
  v_first_warning_msg text := null;
  v_first_critical_msg text := null;
  v_confirming_reading_id uuid := null;
  v_confirming_recorded_at timestamptz := null;
  v_confirming_value numeric := null;
  
  -- Iteration cursor
  r record;
  v_raw_flags integer;
  v_param_name text;
  v_param_unit text;
  v_is_suspect boolean;
  v_is_plausible boolean;
  
  -- Threshold evaluation vars
  v_safe_min numeric := null;
  v_safe_max numeric := null;
  v_matches_safe boolean := false;
  v_matches_warning boolean := false;
  v_matches_critical boolean := false;
  v_matched_threshold_id uuid := null;
  v_matched_severity text := null;
  v_matched_min numeric := null;
  v_matched_max numeric := null;
  
  t_row record;
begin
  -- 1. Fetch parameter metadata & alert rule
  select ar.*, p.name as param_name, coalesce(p.unit, '') as param_unit
  into v_rule
  from public.alert_rules ar
  join public.parameters p on p.id = ar.parameter_id
  where ar.parameter_id = p_parameter_id;

  if not found then
    -- Parameter not governed by alert rules (e.g. Water Level or unconfigured)
    return;
  end if;

  v_param_name := v_rule.param_name;
  v_param_unit := v_rule.param_unit;

  -- 2. Act ONLY if p_target_recorded_at is the latest reading for that node + parameter
  select max(recorded_at) into v_latest_recorded_at
  from public.sensor_readings
  where node_id = p_node_id and parameter_id = p_parameter_id;

  if v_latest_recorded_at is null or p_target_recorded_at < v_latest_recorded_at then
    -- Older/backfilled reading inserted during backlog flush; skip to avoid false live alerts
    return;
  end if;

  -- 3. Check for existing open alert for this node + parameter
  -- Both 'active' and 'reviewed' are treated as open alerts
  select * into v_open_alert
  from public.alerts
  where node_id = p_node_id
    and parameter_id = p_parameter_id
    and status in ('active', 'reviewed')
  order by triggered_at desc
  limit 1;

  -- Determine Safe band boundaries for hysteresis auto-clearing
  for t_row in (
    select min_value, max_value
    from public.thresholds
    where parameter_id = p_parameter_id and lower(trim(severity_label)) = 'safe'
  ) loop
    v_safe_min := t_row.min_value;
    v_safe_max := t_row.max_value;
  end loop;

  -- 4. Iterate over recent readings in chronological order (oldest to newest)
  -- Filter to the last 20 readings descending, then order ascending for streak computation
  for r in (
    select sr.id, sr.value, sr.recorded_at, raw.quality_flags
    from (
      select id, value, recorded_at, node_id
      from public.sensor_readings
      where node_id = p_node_id and parameter_id = p_parameter_id
      order by recorded_at desc
      limit 20
    ) sr
    left join public.sensor_readings_raw raw
      on raw.node_id = sr.node_id and raw.recorded_at = sr.recorded_at
    order by sr.recorded_at asc
  ) loop

    -- Plausibility check
    v_is_plausible := true;
    if v_rule.min_plausible is not null and r.value < v_rule.min_plausible then
      v_is_plausible := false;
    end if;
    if v_rule.max_plausible is not null and r.value > v_rule.max_plausible then
      v_is_plausible := false;
    end if;

    -- Quality flags check from sensor_readings_raw (if available)
    v_is_suspect := false;
    v_raw_flags := r.quality_flags;
    if v_raw_flags is not null then
      -- 0x20: Noisy (sample spread > 60 counts)
      if (v_raw_flags & 32) != 0 then
        v_is_suspect := true;
      end if;
      -- Parameter-specific suspect flags
      if lower(v_param_name) = 'temperature' and ((v_raw_flags & 1) != 0) then
        v_is_suspect := true; -- FLAG_TEMP_BAD
      elsif lower(v_param_name) = 'ph' and ((v_raw_flags & 2) != 0) then
        v_is_suspect := true; -- FLAG_PH_SUSPECT
      elsif lower(v_param_name) = 'turbidity' and ((v_raw_flags & 4) != 0) then
        v_is_suspect := true; -- FLAG_TURB_SUSPECT
      elsif lower(v_param_name) = 'tds' and ((v_raw_flags & 8) != 0) then
        v_is_suspect := true; -- FLAG_TDS_SUSPECT
      end if;
    end if;

    -- Data-Quality Gate: if suspect or outside plausible range, ignore completely
    -- Neither breaches nor clears; streak is preserved
    if not v_is_plausible or v_is_suspect then
      continue;
    end if;

    -- Classify reading against configured thresholds
    v_matches_safe := false;
    v_matches_warning := false;
    v_matches_critical := false;
    v_matched_threshold_id := null;
    v_matched_severity := null;
    v_matched_min := null;
    v_matched_max := null;

    for t_row in (
      select id, min_value, max_value, lower(trim(severity_label)) as sev
      from public.thresholds
      where parameter_id = p_parameter_id
      order by case
        when lower(trim(severity_label)) = 'critical' then 1
        when lower(trim(severity_label)) = 'warning' then 2
        else 3
      end
    ) loop
      if (t_row.min_value is null or r.value >= t_row.min_value) and
         (t_row.max_value is null or r.value <= t_row.max_value) then
        if t_row.sev = 'critical' and not v_matches_critical then
          v_matches_critical := true;
          v_matched_threshold_id := t_row.id;
          v_matched_severity := 'critical';
          v_matched_min := t_row.min_value;
          v_matched_max := t_row.max_value;
          exit; -- Critical takes precedence
        elsif t_row.sev = 'warning' and not v_matches_warning and not v_matches_critical then
          v_matches_warning := true;
          v_matched_threshold_id := t_row.id;
          v_matched_severity := 'warning';
          v_matched_min := t_row.min_value;
          v_matched_max := t_row.max_value;
        elsif t_row.sev = 'safe' and not v_matches_warning and not v_matches_critical then
          v_matches_safe := true;
        end if;
      end if;
    end loop;

    -- Update streaks based on classification
    if v_matches_critical then
      v_critical_streak := v_critical_streak + 1;
      v_warning_streak := v_warning_streak + 1; -- Critical also satisfies general breach
      v_clear_streak := 0;
      v_first_critical_threshold := v_matched_threshold_id;
      v_first_critical_msg := format('%s critical threshold breach: %s %s (limit: %s - %s %s)',
        v_param_name, r.value, v_param_unit, coalesce(v_matched_min::text, '—'), coalesce(v_matched_max::text, '—'), v_param_unit);
      v_confirming_reading_id := r.id;
      v_confirming_recorded_at := r.recorded_at;
      v_confirming_value := r.value;

    elsif v_matches_warning then
      v_warning_streak := v_warning_streak + 1;
      v_critical_streak := 0;
      v_clear_streak := 0;
      v_first_warning_threshold := v_matched_threshold_id;
      v_first_warning_msg := format('%s warning threshold breach: %s %s (limit: %s - %s %s)',
        v_param_name, r.value, v_param_unit, coalesce(v_matched_min::text, '—'), coalesce(v_matched_max::text, '—'), v_param_unit);
      v_confirming_reading_id := r.id;
      v_confirming_recorded_at := r.recorded_at;
      v_confirming_value := r.value;

    else
      -- Reading is outside breach bands. Check if it falls inside safe band WITH HYSTERESIS MARGIN
      declare
        v_in_hysteresis boolean := true;
      begin
        if v_safe_min is not null and r.value < (v_safe_min + v_rule.clear_margin) then
          v_in_hysteresis := false;
        end if;
        if v_safe_max is not null and r.value > (v_safe_max - v_rule.clear_margin) then
          v_in_hysteresis := false;
        end if;

        if v_in_hysteresis then
          v_clear_streak := v_clear_streak + 1;
          v_warning_streak := 0;
          v_critical_streak := 0;
        else
          -- Reading is hovering in the hysteresis band: breaks breach streak but does not increment clear streak
          v_warning_streak := 0;
          v_critical_streak := 0;
        end if;
      end;
    end if;

  end loop;

  -- 5. Act on accumulated streaks

  -- (A) Auto-Clear: if an alert is open and we have clear_n consecutive safe readings outside margin
  if v_open_alert.id is not null and v_clear_streak >= v_rule.clear_n then
    update public.alerts
    set status = 'resolved',
        resolved_at = coalesce(v_confirming_recorded_at, v_latest_recorded_at, timezone('utc', now())),
    where id = v_open_alert.id;
    return;
  end if;

  -- (B) Critical breach confirmed
  if v_critical_streak >= v_rule.critical_n then
    if v_open_alert.id is not null then
      -- Escalation: update open alert severity/threshold/message if it was a warning
      update public.alerts
      set threshold_id = coalesce(v_first_critical_threshold, v_open_alert.threshold_id),
          message = coalesce(v_first_critical_msg, message),
          reading_id = coalesce(v_confirming_reading_id, reading_id)
      where id = v_open_alert.id;
    else
      -- Create new active alert
      insert into public.alerts (
        node_id,
        parameter_id,
        threshold_id,
        reading_id,
        triggered_at,
        status,
        message
      ) values (
        p_node_id,
        p_parameter_id,
        v_first_critical_threshold,
        v_confirming_reading_id,
        coalesce(v_confirming_recorded_at, v_latest_recorded_at),
        'active',
        coalesce(v_first_critical_msg, format('%s critical threshold breach', v_param_name))
      );
    end if;
    return;
  end if;

  -- (C) Warning breach confirmed
  if v_warning_streak >= v_rule.warning_n then
    if v_open_alert.id is null then
      -- Create new active warning alert
      insert into public.alerts (
        node_id,
        parameter_id,
        threshold_id,
        reading_id,
        triggered_at,
        status,
        message
      ) values (
        p_node_id,
        p_parameter_id,
        v_first_warning_threshold,
        v_confirming_reading_id,
        coalesce(v_confirming_recorded_at, v_latest_recorded_at),
        'active',
        coalesce(v_first_warning_msg, format('%s warning threshold breach', v_param_name))
      );
    end if;
    return;
  end if;

exception
  when others then
    -- Alert logic must NEVER block ingestion of sensor readings
    raise warning 'evaluate_sensor_alert error for node %, param %: %', p_node_id, p_parameter_id, SQLERRM;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Trigger on public.sensor_readings
-- -----------------------------------------------------------------------------
create or replace function public.trg_fn_sensor_readings_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.node_id is not null and NEW.parameter_id is not null and NEW.recorded_at is not null then
    perform public.evaluate_sensor_alert(NEW.node_id, NEW.parameter_id, NEW.recorded_at);
  end if;
  return NEW;
exception
  when others then
    raise warning 'trg_fn_sensor_readings_alert suppressed error: %', SQLERRM;
    return NEW;
end;
$$;

drop trigger if exists trg_sensor_readings_alert on public.sensor_readings;
create trigger trg_sensor_readings_alert
  after insert or update on public.sensor_readings
  for each row
  execute function public.trg_fn_sensor_readings_alert();

-- -----------------------------------------------------------------------------
-- 4. Race Fix: Trigger on public.sensor_readings_raw
-- -----------------------------------------------------------------------------
-- When a raw frame arrives late or is updated with suspect flags, re-evaluate
-- all parameters associated with that node and recorded_at timestamp.
create or replace function public.trg_fn_sensor_readings_raw_alert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r_param record;
begin
  if NEW.node_id is not null and NEW.recorded_at is not null then
    for r_param in (
      select distinct parameter_id
      from public.sensor_readings
      where node_id = NEW.node_id and recorded_at = NEW.recorded_at
    ) loop
      perform public.evaluate_sensor_alert(NEW.node_id, r_param.parameter_id, NEW.recorded_at);
    end loop;
  end if;
  return NEW;
exception
  when others then
    raise warning 'trg_fn_sensor_readings_raw_alert suppressed error: %', SQLERRM;
    return NEW;
end;
$$;

drop trigger if exists trg_sensor_readings_raw_alert on public.sensor_readings_raw;
create trigger trg_sensor_readings_raw_alert
  after insert or update on public.sensor_readings_raw
  for each row
  execute function public.trg_fn_sensor_readings_raw_alert();
