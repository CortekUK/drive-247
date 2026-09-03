-- Fleet Health -- two live defects.
--
-- REBASED ONTO THE LIVE DEFINITIONS, not the migration files. Production is
-- ahead of this repo for Fleet Health: check_rental_overlap already carries a
-- blocked_dates clause (errcode 23P02, scoped to maintenance/swap),
-- sync_vehicle_maintenance_status is already timezone-aware and per-row, and
-- blocked_dates_no_overlapping_maintenance already exists -- none of which
-- appear in any migration file. The bodies below are therefore
-- pg_get_functiondef() output with ONE change each, so replacing them cannot
-- clobber work that was applied through the MCP and never committed.
--
--   D1  schedule_vehicle_maintenance paused PAYG billing on rentals that do not
--       overlap the maintenance window. Live, and a silent revenue defect.
--   D2  evaluate_vehicle_health chose between competing rules with an
--       incomplete sort key, so a vehicle's status could change between two
--       runs with no data change. Live.

BEGIN;

-- ---------------------------------------------------------------------------
-- D1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_vehicle_maintenance(p_vehicle_id uuid, p_title text, p_start date, p_end date, p_reason_code text DEFAULT 'scheduled_service'::text, p_priority text DEFAULT 'medium'::text, p_category text DEFAULT NULL::text, p_service_type text DEFAULT NULL::text, p_vendor text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_rule_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v vehicles%ROWTYPE;
  v_actor uuid;
  v_block uuid;
  v_job uuid;
  v_conflicts integer;
  v_active integer;
  v_today date;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;

  IF NOT (COALESCE(is_super_admin(), false)
          OR COALESCE(get_user_tenant_id() = v.tenant_id, false)) THEN
    RAISE EXCEPTION 'Not authorized to modify this vehicle';
  END IF;

  IF COALESCE(v.is_disposed,false) THEN
    RAISE EXCEPTION 'Cannot schedule maintenance on a disposed vehicle';
  END IF;

  IF p_end < p_start THEN RAISE EXCEPTION 'End date must not precede start date'; END IF;

  SELECT (now() AT TIME ZONE COALESCE(NULLIF(t.timezone,''),'UTC'))::date INTO v_today
  FROM tenants t WHERE t.id = v.tenant_id;
  v_today := COALESCE(v_today, CURRENT_DATE);

  -- D8: v1 refuses to take an ACTIVELY RENTED vehicle off the road. There is no
  -- pause, pro-rata credit or substitution clause for the 72 fixed-term open
  -- rentals, and all three refund functions are cancellation-shaped. The operator
  -- must use swap_rental_vehicle instead, which reassigns the customer to a car.
  SELECT COUNT(*) INTO v_active FROM rentals r
  WHERE r.vehicle_id = p_vehicle_id AND r.status = 'Active'
    AND r.start_date <= p_end AND COALESCE(r.end_date,'9999-12-31'::date) >= p_start;

  IF v_active > 0 THEN
    RAISE EXCEPTION 'Vehicle has an active rental during this window. Swap the customer to another vehicle first.'
      USING ERRCODE = '23P03';
  END IF;

  SELECT COUNT(*) INTO v_conflicts FROM preview_maintenance_conflicts(p_vehicle_id, p_start, p_end);
  IF v_conflicts > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'This window conflicts with % existing booking(s). Resolve them or pass force.', v_conflicts
      USING ERRCODE = '23P04';
  END IF;

  SELECT id INTO v_actor FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  -- Structured reason only. blocked_dates is broadcast over realtime with RLS off,
  -- so the narrative stays on the job row.
  INSERT INTO blocked_dates (tenant_id, vehicle_id, start_date, end_date, reason, source_type, reason_code, created_by)
  VALUES (v.tenant_id, p_vehicle_id, p_start, p_end, 'Maintenance', 'maintenance', p_reason_code, auth.uid())
  RETURNING id INTO v_block;

  INSERT INTO vehicle_maintenance_jobs
    (tenant_id, vehicle_id, rule_id, title, category, priority, status, service_type,
     vendor_name, scheduled_start, scheduled_end, blocked_date_id, reported_by, notes)
  VALUES
    (v.tenant_id, p_vehicle_id, p_rule_id, p_title, p_category, p_priority, 'scheduled', p_service_type,
     p_vendor, p_start, p_end, v_block, v_actor, p_notes)
  RETURNING id INTO v_job;

  -- Only take it off the road if the window has actually started.
  IF p_start <= v_today AND p_end >= v_today THEN
    PERFORM set_vehicle_status(p_vehicle_id, 'Maintenance', 'Maintenance hold: ' || p_title,
                               ARRAY['Available','Rented'], 'app');
  END IF;

  -- The agreement's one maintenance promise: PAYG accrual pauses while the vehicle
  -- is being maintained.
  --
  -- Gated the same way the status transition above is (the window must cover
  -- today) and restricted to rentals that actually overlap the window. Without
  -- both, this paused every Active PAYG rental on the vehicle the moment a
  -- service was booked -- including one ending months before the work starts.
  -- sandbox-accrue-payg-charges filters on payg_paused = false, so accrual
  -- stopped that day, and the only unpause lives in
  -- complete_vehicle_maintenance_job -- gated on a job that had not begun.
  IF p_start <= v_today AND p_end >= v_today THEN
    UPDATE rentals SET payg_paused = true, payg_paused_at = now()
    WHERE vehicle_id = p_vehicle_id AND status = 'Active'
      AND is_pay_as_you_go = true AND payg_paused = false
      AND start_date <= p_end
      AND COALESCE(end_date, '9999-12-31'::date) >= p_start;
  END IF;

  PERFORM evaluate_vehicle_health(p_vehicle_id);

  RETURN json_build_object('job_id', v_job, 'blocked_date_id', v_block, 'conflicts', v_conflicts);
END;
$function$
;

-- ---------------------------------------------------------------------------
-- D2 -- add created_at DESC, id to the DISTINCT ON sort key. The
-- vehicle-specific-over-tenant-default preference was the ENTIRE key, so two
-- vehicle-specific rules sharing a service_type tied and DISTINCT ON kept
-- whichever row the plan emitted first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_vehicle_health(p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v          vehicles%ROWTYPE;
  v_today    date;
  v_burn     numeric;
  v_conf     text;
  v_reasons  jsonb := '[]'::jsonb;
  v_status   text := 'ok';
  v_any      boolean := false;
  v_unknown  boolean := false;
  v_next_dt  date;
  v_next_mi  integer;
  v_jobs     integer;
  rule       record;
  v_base_dt  date;
  v_base_mi  integer;
  v_due_dt   date;
  v_due_mi   integer;
  v_state    text;
  v_proj     date;
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF COALESCE(v.is_disposed, false) THEN
    DELETE FROM vehicle_health_cache WHERE vehicle_id = p_vehicle_id;
    RETURN;
  END IF;

  SELECT (now() AT TIME ZONE COALESCE(NULLIF(t.timezone, ''), 'UTC'))::date
    INTO v_today
  FROM tenants t WHERE t.id = v.tenant_id;
  v_today := COALESCE(v_today, CURRENT_DATE);

  SELECT COUNT(*) INTO v_jobs
  FROM vehicle_maintenance_jobs
  WHERE vehicle_id = p_vehicle_id AND status NOT IN ('completed','cancelled');

  v_burn := vehicle_daily_burn(p_vehicle_id);
  v_conf := 'observed';
  IF v_burn IS NULL THEN
    -- F9: set-based tenant fallback.
    --
    -- This branch used to call vehicle_daily_burn() once per sibling vehicle.
    -- Because a vehicle needs two readings to have a burn of its own and almost
    -- none do, nearly every vehicle fell in here — so a fleet pass was O(N^2):
    -- 242 vehicles meant ~58,000 evaluations, and a 242-row update measured
    -- 2479ms against 48ms without it.
    --
    -- Below is vehicle_daily_burn's own CASE applied to every one of the
    -- tenant's vehicles in ONE grouped pass over the readings table. Behaviour
    -- is identical: a vehicle with no readings produces no group, exactly as it
    -- previously returned NULL and was dropped by `WHERE b IS NOT NULL`.
    WITH per_vehicle AS (
      SELECT o.vehicle_id,
             MIN(o.reading)     AS lo,
             MAX(o.reading)     AS hi,
             MIN(o.observed_at) AS t0,
             MAX(o.observed_at) AS t1,
             COUNT(*)           AS n
      FROM vehicle_odometer_readings o
      JOIN vehicles v2 ON v2.id = o.vehicle_id
      WHERE v2.tenant_id = v.tenant_id
        AND COALESCE(v2.is_disposed, false) = false
        AND o.is_suspect = false
        AND o.observed_at >= now() - interval '180 days'
      GROUP BY o.vehicle_id
    ), burns AS (
      SELECT CASE
        WHEN n < 2 THEN NULL
        WHEN EXTRACT(epoch FROM (t1 - t0)) < 86400 THEN NULL
        WHEN hi <= lo THEN NULL
        ELSE ROUND((hi - lo)::numeric / (EXTRACT(epoch FROM (t1 - t0)) / 86400.0), 2)
      END AS b
      FROM per_vehicle
    )
    SELECT ROUND(AVG(b)::numeric, 2) INTO v_burn FROM burns WHERE b IS NOT NULL;
    v_conf := 'tenant_median';
  END IF;
  IF v_burn IS NULL OR v_burn <= 0 THEN
    v_burn := 166;
    v_conf := 'platform_median';
  END IF;

  IF v.mot_due_date IS NOT NULL THEN
    v_any := true;
    v_state := CASE WHEN v.mot_due_date < v_today THEN 'expired'
                    WHEN v.mot_due_date <= v_today + 30 THEN 'due_soon'
                    ELSE 'ok' END;
    IF v_state <> 'ok' THEN
      v_reasons := v_reasons || jsonb_build_object(
        'kind','compliance','label','Inspection / MOT','state',v_state,
        'due_date', v.mot_due_date, 'days', (v.mot_due_date - v_today));
      IF v_state = 'expired' THEN v_status := 'not_road_legal';
      ELSIF v_status = 'ok' THEN v_status := 'attention'; END IF;
    END IF;
    IF v_next_dt IS NULL OR v.mot_due_date < v_next_dt THEN v_next_dt := v.mot_due_date; END IF;
  END IF;

  IF v.tax_due_date IS NOT NULL THEN
    v_any := true;
    v_state := CASE WHEN v.tax_due_date < v_today THEN 'expired'
                    WHEN v.tax_due_date <= v_today + 30 THEN 'due_soon'
                    ELSE 'ok' END;
    IF v_state <> 'ok' THEN
      v_reasons := v_reasons || jsonb_build_object(
        'kind','compliance','label','Registration / tax','state',v_state,
        'due_date', v.tax_due_date, 'days', (v.tax_due_date - v_today));
      IF v_state = 'expired' THEN v_status := 'not_road_legal';
      ELSIF v_status = 'ok' THEN v_status := 'attention'; END IF;
    END IF;
    IF v_next_dt IS NULL OR v.tax_due_date < v_next_dt THEN v_next_dt := v.tax_due_date; END IF;
  END IF;

  FOR rule IN
    SELECT DISTINCT ON (COALESCE(r.service_type, r.name)) r.*
    FROM vehicle_maintenance_rules r
    WHERE r.tenant_id = v.tenant_id
      AND r.is_active
      AND (r.vehicle_id = p_vehicle_id OR r.vehicle_id IS NULL)
    ORDER BY COALESCE(r.service_type, r.name), (r.vehicle_id IS NULL), r.created_at DESC, r.id
  LOOP
    CONTINUE WHEN rule.is_excluded;

    SELECT sr.service_date, sr.mileage INTO v_base_dt, v_base_mi
    FROM service_records sr
    WHERE sr.vehicle_id = p_vehicle_id
      AND (rule.service_type IS NULL OR sr.service_type = rule.service_type)
    ORDER BY sr.service_date DESC, sr.created_at DESC
    LIMIT 1;

    v_due_dt := NULL; v_due_mi := NULL; v_state := NULL;

    IF rule.interval_months IS NOT NULL AND v_base_dt IS NOT NULL THEN
      v_due_dt := (v_base_dt + (rule.interval_months || ' months')::interval)::date;
    END IF;

    IF rule.interval_miles IS NOT NULL AND v_base_mi IS NOT NULL AND v.current_mileage IS NOT NULL THEN
      v_due_mi := v_base_mi + rule.interval_miles;
      v_proj := v_today + GREATEST(CEIL((v_due_mi - v.current_mileage)::numeric / v_burn), 0)::integer;
      IF v_due_dt IS NULL OR v_proj < v_due_dt THEN v_due_dt := v_proj; END IF;
    END IF;

    IF v_due_dt IS NULL AND v_due_mi IS NULL THEN
      v_unknown := true;
      v_reasons := v_reasons || jsonb_build_object(
        'kind','service','label',rule.name,'state','unknown',
        'rule_id', rule.id,
        'hint', CASE WHEN v_base_dt IS NULL THEN 'No service history for this item'
                     ELSE 'Needs an odometer reading' END);
      CONTINUE;
    END IF;

    v_any := true;

    IF (v_due_mi IS NOT NULL AND v.current_mileage IS NOT NULL AND v.current_mileage >= v_due_mi)
       OR (v_due_dt IS NOT NULL AND v_due_dt < v_today) THEN
      v_state := 'overdue';
    ELSIF (v_due_mi IS NOT NULL AND v.current_mileage IS NOT NULL
           AND v.current_mileage >= v_due_mi - rule.lead_miles)
       OR (v_due_dt IS NOT NULL AND v_due_dt <= v_today + rule.lead_days) THEN
      v_state := 'due_soon';
    ELSE
      v_state := 'ok';
    END IF;

    IF v_state <> 'ok' THEN
      v_reasons := v_reasons || jsonb_build_object(
        'kind','service','label',rule.name,'state',v_state,'rule_id',rule.id,
        'due_date', v_due_dt, 'due_miles', v_due_mi,
        'miles_remaining', CASE WHEN v_due_mi IS NOT NULL AND v.current_mileage IS NOT NULL
                                THEN v_due_mi - v.current_mileage END,
        'confidence', CASE WHEN v_due_mi IS NOT NULL THEN v_conf END);
      IF v_state = 'overdue' AND v_status <> 'not_road_legal' THEN v_status := 'overdue';
      ELSIF v_state = 'due_soon' AND v_status = 'ok' THEN v_status := 'attention'; END IF;
    END IF;

    IF v_due_dt IS NOT NULL AND (v_next_dt IS NULL OR v_due_dt < v_next_dt) THEN v_next_dt := v_due_dt; END IF;
    IF v_due_mi IS NOT NULL AND (v_next_mi IS NULL OR v_due_mi < v_next_mi) THEN v_next_mi := v_due_mi; END IF;
  END LOOP;

  IF v_jobs > 0 THEN
    v_reasons := v_reasons || jsonb_build_object(
      'kind','job','label', v_jobs || ' open maintenance job' || CASE WHEN v_jobs > 1 THEN 's' ELSE '' END,
      'state','open');
    IF v_status = 'ok' THEN v_status := 'attention'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM blocked_dates b
    WHERE b.vehicle_id = p_vehicle_id
      AND b.source_type IN ('maintenance','swap')
      AND b.start_date <= v_today AND b.end_date >= v_today
  ) THEN
    v_status := 'off_road';
    v_reasons := v_reasons || jsonb_build_object('kind','hold','label','Off road for maintenance','state','active');
  END IF;

  IF NOT v_any AND v_status = 'ok' THEN
    v_status := 'unknown';
  ELSIF v_unknown AND v_status = 'ok' THEN
    v_status := 'unknown';
  END IF;

  INSERT INTO vehicle_health_cache
    (vehicle_id, tenant_id, status, reasons, next_due_date, next_due_miles,
     confidence, daily_burn, open_job_count, computed_at)
  VALUES
    (p_vehicle_id, v.tenant_id, v_status, v_reasons, v_next_dt, v_next_mi,
     v_conf, v_burn, v_jobs, now())
  ON CONFLICT (vehicle_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id, status = EXCLUDED.status, reasons = EXCLUDED.reasons,
    next_due_date = EXCLUDED.next_due_date, next_due_miles = EXCLUDED.next_due_miles,
    confidence = EXCLUDED.confidence, daily_burn = EXCLUDED.daily_burn,
    open_job_count = EXCLUDED.open_job_count, computed_at = now();
END;
$function$
;

COMMIT;
