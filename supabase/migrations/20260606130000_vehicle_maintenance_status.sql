-- Vehicle Swap follow-up: reflect maintenance in the vehicle's status badge.
-- When an operator swaps a car out AND ticks "Block the old vehicle for
-- maintenance", the old car should read "Maintenance" (not "Available") for the
-- duration of the block, then auto-return to "Available" once the window ends.

-- 1. Updated swap RPC: set old vehicle to 'Maintenance' when a block is added.
CREATE OR REPLACE FUNCTION public.swap_rental_vehicle(
  p_rental_id uuid,
  p_new_vehicle_id uuid,
  p_reason text DEFAULT NULL,
  p_block_old_start date DEFAULT NULL,
  p_block_old_end date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Reassign the vehicle. The prevent_rental_overlap trigger guards the new car.
  UPDATE rentals
  SET vehicle_id = p_new_vehicle_id,
      updated_at = now()
  WHERE id = p_rental_id;

  -- Release the old vehicle if nothing else is keeping it rented. If a
  -- maintenance block is being added, mark it 'Maintenance' instead of 'Available'.
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

  -- Mark the new vehicle as Rented if the rental is currently active.
  IF v_rental.status = 'Active' THEN
    UPDATE vehicles SET status = 'Rented' WHERE id = p_new_vehicle_id;
  END IF;

  -- Record the maintenance block on the old vehicle.
  IF v_old_vehicle_id IS NOT NULL AND v_has_block THEN
    INSERT INTO blocked_dates (tenant_id, vehicle_id, start_date, end_date, reason)
    VALUES (
      v_rental.tenant_id,
      v_old_vehicle_id,
      p_block_old_start,
      p_block_old_end,
      COALESCE(NULLIF(TRIM(p_reason), ''), 'Vehicle maintenance (swapped out)')
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
$$;

-- 2. Daily reconcile: return a vehicle from 'Maintenance' to its normal status
-- once no vehicle-specific block covers today. If an active rental somehow holds
-- it, it becomes 'Rented', otherwise 'Available'.
CREATE OR REPLACE FUNCTION public.sync_vehicle_maintenance_status()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE vehicles v
  SET status = CASE
    WHEN EXISTS (
      SELECT 1 FROM rentals r WHERE r.vehicle_id = v.id AND r.status = 'Active'
    ) THEN 'Rented'
    ELSE 'Available'
  END
  WHERE v.status = 'Maintenance'
    AND NOT EXISTS (
      SELECT 1 FROM blocked_dates b
      WHERE b.vehicle_id = v.id
        AND b.start_date <= CURRENT_DATE
        AND b.end_date >= CURRENT_DATE
    );
END;
$$;

-- 3. Schedule it daily at 01:00 UTC.
DO $$
BEGIN
  PERFORM cron.unschedule('sync-vehicle-maintenance');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'sync-vehicle-maintenance',
  '0 1 * * *',
  $$SELECT public.sync_vehicle_maintenance_status();$$
);
