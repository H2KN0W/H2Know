-- Migration: 20261104000001_drop_reviewer_columns.sql
-- Description: Remove reviewer/resolver tracking columns from public.alerts.
--              Who reviewed or resolved an alert is no longer tracked.
--              resolved_at (the timestamp of auto-resolution) is kept.
--              Fully idempotent.

alter table public.alerts
  drop column if exists reviewed_by,
  drop column if exists reviewed_at,
  drop column if exists resolved_by,
  drop column if exists resolved_by_name;

-- Recreate the alert evaluation function without the dropped columns.
-- This is a full replacement so the trigger body stays in sync with the schema.
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
    return;
  end if;

  v_param_name := v_rule.param_name;
  v_param_unit := v_rule.param_unit;

  -- 2. Act ONLY if p_target_recorded_at is the latest reading for that node + parameter
  select max(recorded_at) into v_latest_recorded_at
  from public.sensor_readings
  where node_id = p_node_id and parameter_id = p_parameter_id;

  if v_latest_recorded_at is null or p_target_recorded_at < v_latest_recorded_at then
    return;
  end if;

  -- 3. Check for existing open alert for this node + parameter
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
      if (v_raw_flags & 32) != 0 then
        v_is_suspect := true;
      end if;
      if lower(v_param_name) = 'temperature' and ((v_raw_flags & 1) != 0) then
        v_is_suspect := true;
      elsif lower(v_param_name) = 'ph' and ((v_raw_flags & 2) != 0) then
        v_is_suspect := true;
      elsif lower(v_param_name) = 'turbidity' and ((v_raw_flags & 4) != 0) then
        v_is_suspect := true;
      elsif lower(v_param_name) = 'tds' and ((v_raw_flags & 8) != 0) then
        v_is_suspect := true;
      end if;
    end if;

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
          exit;
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
      v_warning_streak := v_warning_streak + 1;
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
          v_warning_streak := 0;
          v_critical_streak := 0;
        end if;
      end;
    end if;

  end loop;

  -- 5. Act on accumulated streaks

  -- (A) Auto-Clear
  if v_open_alert.id is not null and v_clear_streak >= v_rule.clear_n then
    update public.alerts
    set status = 'resolved',
        resolved_at = coalesce(v_confirming_recorded_at, v_latest_recorded_at, timezone('utc', now()))
    where id = v_open_alert.id;
    return;
  end if;

  -- (B) Critical breach confirmed
  if v_critical_streak >= v_rule.critical_n then
    if v_open_alert.id is not null then
      update public.alerts
      set threshold_id = coalesce(v_first_critical_threshold, v_open_alert.threshold_id),
          message = coalesce(v_first_critical_msg, message),
          reading_id = coalesce(v_confirming_reading_id, reading_id)
      where id = v_open_alert.id;
    else
      insert into public.alerts (
        node_id, parameter_id, threshold_id, reading_id,
        triggered_at, status, message
      ) values (
        p_node_id, p_parameter_id,
        v_first_critical_threshold, v_confirming_reading_id,
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
      insert into public.alerts (
        node_id, parameter_id, threshold_id, reading_id,
        triggered_at, status, message
      ) values (
        p_node_id, p_parameter_id,
        v_first_warning_threshold, v_confirming_reading_id,
        coalesce(v_confirming_recorded_at, v_latest_recorded_at),
        'active',
        coalesce(v_first_warning_msg, format('%s warning threshold breach', v_param_name))
      );
    end if;
    return;
  end if;

exception
  when others then
    raise warning 'evaluate_sensor_alert error for node %, param %: %', p_node_id, p_parameter_id, SQLERRM;
end;
$$;
