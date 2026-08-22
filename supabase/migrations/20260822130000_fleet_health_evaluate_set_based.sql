-- F9 — evaluate_vehicle_health: replace the O(N^2) tenant-burn fan-out
--
-- Apply AFTER 20260822120000. Body is the live definition with only the
-- tenant-fallback branch changed; everything else is byte-identical.

BEGIN;

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
    ORDER BY COALESCE(r.service_type, r.name), (r.vehicle_id IS NULL)
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
