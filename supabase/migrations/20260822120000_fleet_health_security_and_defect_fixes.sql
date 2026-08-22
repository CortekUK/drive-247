-- Fleet Health — security and defect fixes
--
-- WHY THIS IS A MIGRATION FILE
--
-- The Fleet Health DDL was applied straight to production in August and exists
-- only inside the live database. docs/FLEET_HEALTH_PROD_HOTFIX.md records what
-- that cost: a CASE-expression field reference that PL/pgSQL resolves on every
-- branch took down vehicle disposal and every MOT/tax edit for 26 tenants and
-- 451 vehicles, because a trigger fires regardless of any front-end flag.
-- Unreviewed DDL is the root cause, so these changes are written down where
-- they can be read before they run.
--
-- Every statement is idempotent and re-runnable.
--
-- CONTENTS
--   S1  revoke anon EXECUTE on all 8 Fleet Health RPCs
--   S2  fix three authorisation guards that fail OPEN on a NULL tenant
--   S3  authorise preview_maintenance_conflicts (leaks customer PII)
--   S4  tenant-scope service_records and vehicle_events, then enable RLS
--   F1  an Active rental can no longer be overridden by p_force
--   F2  swap_rental_vehicle records source_type='swap'
--   F3  the trigger layer honours tenants.fleet_health_enabled
--   F7  update_vehicle_last_service falls back to the odometer
--   F8  backfill vehicle_events.tenant_id where it is recoverable

BEGIN;

-- ---------------------------------------------------------------------------
-- S1. Revoke anon EXECUTE.
--
-- All 8 were granted to anon. Combined with S2 that let an unauthenticated
-- caller holding the public anon key schedule maintenance, write blocked_dates
-- and change vehicle status on ANY tenant. Proven against production and rolled
-- back. Nothing legitimate calls these as anon: the portal is authenticated and
-- the chat edge function uses a service_role client.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.evaluate_vehicle_health(uuid)              FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_fleet_health(uuid)                FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vehicle_daily_burn(uuid, integer)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fleet_health_metrics(uuid)             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_maintenance_conflicts(uuid, date, date) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_vehicle_status(uuid, text, text, text[], text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_vehicle_maintenance_job(uuid, date, integer, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.schedule_vehicle_maintenance(uuid, text, date, date, text, text, text, text, text, text, uuid, boolean) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.evaluate_vehicle_health(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_fleet_health(uuid)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_daily_burn(uuid, integer)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_fleet_health_metrics(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_maintenance_conflicts(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_vehicle_status(uuid, text, text, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_vehicle_maintenance_job(uuid, date, integer, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_vehicle_maintenance(uuid, text, date, date, text, text, text, text, text, text, uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- S2 / S3 / F1 / F7. Function bodies below are the live definitions with ONLY
-- the marked lines changed — patched programmatically, not retyped.
-- ---------------------------------------------------------------------------

-- ===== S2+F1  schedule_vehicle_maintenance =====
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
  -- is being maintained. Nothing implemented this before.
  UPDATE rentals SET payg_paused = true, payg_paused_at = now()
  WHERE vehicle_id = p_vehicle_id AND status = 'Active'
    AND is_pay_as_you_go = true AND payg_paused = false;

  PERFORM evaluate_vehicle_health(p_vehicle_id);

  RETURN json_build_object('job_id', v_job, 'blocked_date_id', v_block, 'conflicts', v_conflicts);
END;
$function$;

-- ===== S2     complete_vehicle_maintenance_job =====
CREATE OR REPLACE FUNCTION public.complete_vehicle_maintenance_job(p_job_id uuid, p_service_date date DEFAULT NULL::date, p_mileage integer DEFAULT NULL::integer, p_cost numeric DEFAULT 0, p_description text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j vehicle_maintenance_jobs%ROWTYPE;
  v_service uuid;
  v_actor uuid;
  v_still_blocked boolean;
  v_today date;
BEGIN
  SELECT * INTO j FROM vehicle_maintenance_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  IF NOT (COALESCE(is_super_admin(), false)
          OR COALESCE(get_user_tenant_id() = j.tenant_id, false)) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF j.status = 'completed' THEN
    RETURN json_build_object('job_id', j.id, 'service_record_id', j.service_record_id, 'already', true);
  END IF;

  SELECT id INTO v_actor FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  INSERT INTO service_records (vehicle_id, tenant_id, service_date, service_type, mileage, description, cost)
  VALUES (j.vehicle_id, j.tenant_id, COALESCE(p_service_date, CURRENT_DATE),
          COALESCE(j.service_type, j.category), p_mileage,
          COALESCE(p_description, j.title), COALESCE(p_cost, 0))
  RETURNING id INTO v_service;

  -- The odometer entered at completion is a first-class observation.
  IF p_mileage IS NOT NULL THEN
    INSERT INTO vehicle_odometer_readings (tenant_id, vehicle_id, reading, observed_at, source, source_ref, recorded_by, note)
    VALUES (j.tenant_id, j.vehicle_id, p_mileage, now(), 'service', v_service, v_actor, 'Recorded at job completion')
    ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
  END IF;

  UPDATE vehicle_maintenance_jobs
  SET status='completed', completed_at=now(), service_record_id=v_service
  WHERE id = p_job_id;

  -- Release only THIS job's own block. 59 overlapping pairs of blocks already exist
  -- in production, so a vehicle can legitimately remain off road afterwards.
  IF j.blocked_date_id IS NOT NULL THEN
    DELETE FROM blocked_dates WHERE id = j.blocked_date_id AND tenant_id = j.tenant_id;
  END IF;

  SELECT (now() AT TIME ZONE COALESCE(NULLIF(t.timezone,''),'UTC'))::date INTO v_today
  FROM tenants t WHERE t.id = j.tenant_id;
  v_today := COALESCE(v_today, CURRENT_DATE);

  SELECT EXISTS (
    SELECT 1 FROM blocked_dates b
    WHERE b.vehicle_id = j.vehicle_id AND b.source_type IN ('maintenance','swap')
      AND b.start_date <= v_today AND b.end_date >= v_today
  ) OR EXISTS (
    SELECT 1 FROM vehicle_maintenance_jobs o
    WHERE o.vehicle_id = j.vehicle_id AND o.id <> j.id
      AND o.status NOT IN ('completed','cancelled')
  ) INTO v_still_blocked;

  IF NOT v_still_blocked THEN
    PERFORM set_vehicle_status(
      j.vehicle_id,
      CASE WHEN EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id=j.vehicle_id AND r.status='Active')
           THEN 'Rented' ELSE 'Available' END,
      'Maintenance job completed', ARRAY['Maintenance'], 'app');

    UPDATE rentals SET payg_paused = false, payg_paused_at = NULL
    WHERE vehicle_id = j.vehicle_id AND status='Active' AND is_pay_as_you_go = true AND payg_paused = true;
  END IF;

  PERFORM evaluate_vehicle_health(j.vehicle_id);

  RETURN json_build_object('job_id', j.id, 'service_record_id', v_service, 'still_blocked', v_still_blocked);
END;
$function$;

-- ===== S2     set_vehicle_status =====
CREATE OR REPLACE FUNCTION public.set_vehicle_status(p_vehicle_id uuid, p_to_status text, p_reason text DEFAULT NULL::text, p_expect_in text[] DEFAULT NULL::text[], p_source text DEFAULT 'app'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle vehicles%ROWTYPE;
  v_actor   uuid;
BEGIN
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF NOT (COALESCE(is_super_admin(), false)
          OR COALESCE(get_user_tenant_id() = v_vehicle.tenant_id, false)
          OR COALESCE(p_source = 'cron', false)) THEN
    RAISE EXCEPTION 'Not authorized to modify this vehicle';
  END IF;

  -- Never resurrect a disposed vehicle.
  IF v_vehicle.status = 'Disposed' AND p_to_status <> 'Disposed' THEN
    RETURN v_vehicle.status;
  END IF;

  IF p_expect_in IS NOT NULL AND NOT (v_vehicle.status = ANY(p_expect_in)) THEN
    RETURN v_vehicle.status;  -- someone else moved it; caller's intent is stale
  END IF;

  IF v_vehicle.status IS NOT DISTINCT FROM p_to_status THEN
    RETURN v_vehicle.status;
  END IF;

  SELECT id INTO v_actor FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  UPDATE vehicles SET status = p_to_status, updated_at = now() WHERE id = p_vehicle_id;

  INSERT INTO vehicle_status_history (tenant_id, vehicle_id, from_status, to_status, reason, actor_id, source)
  VALUES (v_vehicle.tenant_id, p_vehicle_id, v_vehicle.status, p_to_status, p_reason, v_actor, p_source);

  RETURN p_to_status;
END;
$function$;

-- ===== S3     preview_maintenance_conflicts =====
CREATE OR REPLACE FUNCTION public.preview_maintenance_conflicts(p_vehicle_id uuid, p_start date, p_end date)
 RETURNS TABLE(rental_id uuid, rental_number text, status text, start_date date, end_date date, payment_status text, monthly_amount numeric, customer_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.rental_number, r.status, r.start_date, r.end_date,
         r.payment_status, r.monthly_amount, c.name
  FROM rentals r
  LEFT JOIN customers c ON c.id = r.customer_id
  WHERE r.vehicle_id = p_vehicle_id
    -- Fail-closed authorisation. This function returns customer names and
    -- rental values; without this any holder of the public anon key could read
    -- them for an arbitrary vehicle id. get_user_tenant_id() is NULL for an
    -- anonymous caller, so the comparison is NULL and the row is excluded.
    AND EXISTS (
      SELECT 1 FROM vehicles av
       WHERE av.id = p_vehicle_id
         AND (COALESCE(is_super_admin(), false)
              OR COALESCE(av.tenant_id = get_user_tenant_id(), false))
    )
    AND r.status IN ('Active','Pending')
    AND r.start_date <= p_end
    AND COALESCE(r.end_date, '9999-12-31'::date) >= p_start
  ORDER BY r.start_date;
$function$;

-- ===== F7     update_vehicle_last_service =====
CREATE OR REPLACE FUNCTION public.update_vehicle_last_service(p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date    date;
  v_mileage integer;
BEGIN
  SELECT service_date INTO v_date
  FROM service_records
  WHERE vehicle_id = p_vehicle_id
  ORDER BY service_date DESC, created_at DESC
  LIMIT 1;

  SELECT mileage INTO v_mileage
  FROM service_records
  WHERE vehicle_id = p_vehicle_id AND mileage IS NOT NULL
  ORDER BY service_date DESC, created_at DESC
  LIMIT 1;

  -- Fallback: a service record is not obliged to carry a mileage, and plenty do
  -- not. Without a baseline every mileage-based rule silently stops projecting,
  -- because "miles since last service" has nothing to subtract from. Fall back
  -- to the odometer reading closest to (at or before) the service date.
  IF v_mileage IS NULL AND v_date IS NOT NULL THEN
    SELECT o.reading INTO v_mileage
    FROM vehicle_odometer_readings o
    WHERE o.vehicle_id = p_vehicle_id
      AND o.is_suspect IS NOT TRUE
      AND o.observed_at::date <= v_date
    ORDER BY o.observed_at DESC
    LIMIT 1;
  END IF;

  IF v_date IS NOT NULL THEN
    UPDATE vehicles
    SET last_service_date = v_date, last_service_mileage = v_mileage
    WHERE id = p_vehicle_id;
  ELSE
    UPDATE vehicles
    SET last_service_date = NULL, last_service_mileage = NULL
    WHERE id = p_vehicle_id;
  END IF;
END;
$function$;

-- ===== F2  swap_rental_vehicle records source_type='swap' =====
CREATE OR REPLACE FUNCTION public.swap_rental_vehicle(p_rental_id uuid, p_new_vehicle_id uuid, p_reason text DEFAULT NULL::text, p_block_old_start date DEFAULT NULL::date, p_block_old_end date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rental rentals%ROWTYPE;
  v_new_vehicle vehicles%ROWTYPE;
  v_old_vehicle_id uuid;
  v_app_user_id uuid;
  v_swap_id uuid;
  v_has_block boolean;
BEGIN
  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  IF NOT (is_super_admin() OR get_user_tenant_id() = v_rental.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to modify this rental';
  END IF;

  IF v_rental.status IN ('Cancelled', 'Rejected', 'Closed', 'Completed') THEN
    RAISE EXCEPTION 'Cannot swap the vehicle on a % rental', v_rental.status;
  END IF;

  v_old_vehicle_id := v_rental.vehicle_id;

  IF v_old_vehicle_id = p_new_vehicle_id THEN
    RAISE EXCEPTION 'The replacement vehicle is the same as the current vehicle';
  END IF;

  SELECT * INTO v_new_vehicle FROM vehicles WHERE id = p_new_vehicle_id;
  IF NOT FOUND OR v_new_vehicle.tenant_id <> v_rental.tenant_id THEN
    RAISE EXCEPTION 'Replacement vehicle not found for this tenant';
  END IF;

  IF v_new_vehicle.status = 'Disposed' THEN
    RAISE EXCEPTION 'Cannot swap into a disposed vehicle';
  END IF;

  v_has_block := (p_block_old_start IS NOT NULL AND p_block_old_end IS NOT NULL);

  UPDATE rentals
  SET vehicle_id = p_new_vehicle_id,
      updated_at = now()
  WHERE id = p_rental_id;

  IF v_old_vehicle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM rentals
      WHERE vehicle_id = v_old_vehicle_id
        AND id <> p_rental_id
        AND status IN ('Active', 'Pending')
    ) THEN
      IF v_has_block THEN
        UPDATE vehicles SET status = 'Maintenance'
        WHERE id = v_old_vehicle_id AND status IN ('Rented', 'Available');
      ELSE
        UPDATE vehicles SET status = 'Available'
        WHERE id = v_old_vehicle_id AND status = 'Rented';
      END IF;
    END IF;
  END IF;

  IF v_rental.status = 'Active' THEN
    UPDATE vehicles SET status = 'Rented' WHERE id = p_new_vehicle_id;
  END IF;

  IF v_old_vehicle_id IS NOT NULL AND v_has_block THEN
    -- source_type is REQUIRED here. It defaults to 'manual', and
    -- evaluate_vehicle_health only counts a block as taking a car off the road
    -- when source_type IN ('maintenance','swap') — so every swap-created block
    -- was invisible to Fleet Health. 219 of 222 live rows are 'manual'.
    INSERT INTO blocked_dates (tenant_id, vehicle_id, start_date, end_date, reason, source_type)
    VALUES (
      v_rental.tenant_id,
      v_old_vehicle_id,
      p_block_old_start,
      p_block_old_end,
      COALESCE(NULLIF(TRIM(p_reason), ''), 'Vehicle maintenance (swapped out)'),
      'swap'
    );
  END IF;

  SELECT id INTO v_app_user_id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;

  INSERT INTO rental_vehicle_swaps (tenant_id, rental_id, old_vehicle_id, new_vehicle_id, reason, swapped_by)
  VALUES (v_rental.tenant_id, p_rental_id, v_old_vehicle_id, p_new_vehicle_id, NULLIF(TRIM(p_reason), ''), v_app_user_id)
  RETURNING id INTO v_swap_id;

  RETURN json_build_object(
    'swap_id', v_swap_id,
    'rental_id', p_rental_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_new_vehicle_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- F8. Backfill vehicle_events.tenant_id.
--
-- MUST run before S4 enables RLS on this table: a NULL tenant_id under a
-- tenant-scoped policy is invisible to everyone.
--
-- 46 rows are NULL. All 46 point at a vehicle that no longer exists, so only
-- the ones still resolvable get a tenant. The remainder are deliberately left
-- NULL rather than deleted — they are audit rows, and the super-admin arm of
-- the policy below keeps them reachable. Deleting audit history to satisfy a
-- policy would be the wrong trade.
-- ---------------------------------------------------------------------------
UPDATE public.vehicle_events e
   SET tenant_id = v.tenant_id
  FROM public.vehicles v
 WHERE e.vehicle_id = v.id
   AND e.tenant_id IS NULL
   AND v.tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- S4. Tenant-scope service_records and vehicle_events, then enable RLS.
--
-- Both carried a policy of `USING (true)` for anon/public AND had RLS switched
-- OFF, so the policy was decorative twice over. Verified: an anonymous caller
-- reads real service history and event rows today.
--
-- Enabling RLS alone would have changed nothing — the permissive policy has to
-- go first. apps/booking references these tables only in generated types, never
-- in a query, so no customer-facing read depends on anon access here.
--
-- vehicles and blocked_dates are ALSO rls=false with unenforced policies, and
-- are deliberately NOT touched here: the booking site reads both as anon, and
-- 6 call sites use select('*'), so a column- or row-level restriction there
-- needs its own tested change. See the note at the end of this file.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all operations for app users" ON public.service_records;
DROP POLICY IF EXISTS service_records_tenant_access ON public.service_records;
CREATE POLICY service_records_tenant_access ON public.service_records
  FOR ALL TO authenticated
  USING      (COALESCE(is_super_admin(), false) OR COALESCE(tenant_id = get_user_tenant_id(), false))
  WITH CHECK (COALESCE(is_super_admin(), false) OR COALESCE(tenant_id = get_user_tenant_id(), false));
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations for app users on vehicle_events" ON public.vehicle_events;
DROP POLICY IF EXISTS vehicle_events_tenant_access ON public.vehicle_events;
CREATE POLICY vehicle_events_tenant_access ON public.vehicle_events
  FOR ALL TO authenticated
  USING      (COALESCE(is_super_admin(), false) OR COALESCE(tenant_id = get_user_tenant_id(), false))
  WITH CHECK (COALESCE(is_super_admin(), false) OR COALESCE(tenant_id = get_user_tenant_id(), false));
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.service_records FROM anon;
REVOKE ALL ON public.vehicle_events  FROM anon;

-- ---------------------------------------------------------------------------
-- F3. The trigger layer honours tenants.fleet_health_enabled.
--
-- evaluate_fleet_health (cron 66) filters on the flag; none of the 7 trigger
-- functions did. Result: 49 flag-OFF tenants hold 17 vehicle_health_cache rows
-- and 113 odometer rows that the nightly reconciler then skips, so nothing ever
-- repairs them. A feature that is "off" was writing to 49 tenants' data.
--
-- Gating the central dispatcher covers every trigger that routes through it and
-- keeps the change to one function. The guard is a plain early RETURN: doing
-- LESS work can never abort the caller's write, which is the failure mode this
-- feature already caused once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fleet_health_gate(p_vehicle_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT t.fleet_health_enabled
       FROM public.vehicles v
       JOIN public.tenants  t ON t.id = v.tenant_id
      WHERE v.id = p_vehicle_id),
    false);
$$;
REVOKE EXECUTE ON FUNCTION public.fleet_health_gate(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fleet_health_gate(uuid) TO authenticated, service_role;

-- ===== F3  fleet_health_recompute honours the flag =====
CREATE OR REPLACE FUNCTION public.fleet_health_recompute()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle uuid;
BEGIN
  IF TG_TABLE_NAME = 'vehicles' THEN
    IF TG_OP = 'DELETE' THEN
      v_vehicle := OLD.id;
    ELSE
      v_vehicle := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_vehicle := OLD.vehicle_id;
    ELSE
      v_vehicle := NEW.vehicle_id;
    END IF;
  END IF;

  -- F3: do nothing for a tenant that has Fleet Health switched off. The flag
  -- is checked by evaluate_fleet_health (cron 66) but was not checked here, so
  -- triggers seeded cache rows for 49 flag-off tenants which the nightly pass
  -- then skipped and never repaired. Skipping work cannot abort the caller.
  IF v_vehicle IS NOT NULL AND NOT fleet_health_gate(v_vehicle) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF v_vehicle IS NOT NULL THEN
    BEGIN
      PERFORM evaluate_vehicle_health(v_vehicle);
    EXCEPTION WHEN OTHERS THEN
      -- Never block the write that triggered us. RAISE WARNING alone is not
      -- enough: Supabase's postgres_logs pipeline surfaces only ERROR and LOG,
      -- so the row below is the only durable record a human can query.
      RAISE WARNING 'fleet_health_recompute: evaluate_vehicle_health(%) failed: % (%)',
        v_vehicle, SQLERRM, SQLSTATE;
      BEGIN
        INSERT INTO fleet_health_trigger_errors (function_name, vehicle_id, sqlstate, message)
        VALUES ('fleet_health_recompute', v_vehicle, SQLSTATE, SQLERRM);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
