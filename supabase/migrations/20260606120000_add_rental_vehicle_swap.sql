-- Vehicle Swap feature
-- Lets an operator reassign the vehicle on an existing rental (e.g. when the
-- originally rented car has to go in for maintenance) without closing and
-- recreating the rental. Done atomically in one RPC so the rental, both
-- vehicles' statuses, an optional maintenance block, and a history row all
-- move together.

-- 1. History / audit trail of every swap
CREATE TABLE IF NOT EXISTS public.rental_vehicle_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rental_id uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  old_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  new_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  reason text,
  swapped_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_vehicle_swaps_rental ON public.rental_vehicle_swaps(rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_vehicle_swaps_tenant ON public.rental_vehicle_swaps(tenant_id);

ALTER TABLE public.rental_vehicle_swaps ENABLE ROW LEVEL SECURITY;

-- Tenants can read their own swap history; super admins read all.
DROP POLICY IF EXISTS "rental_vehicle_swaps_select" ON public.rental_vehicle_swaps;
CREATE POLICY "rental_vehicle_swaps_select"
  ON public.rental_vehicle_swaps
  FOR SELECT
  USING (is_super_admin() OR tenant_id = get_user_tenant_id());

-- Mutations only happen through the SECURITY DEFINER RPC below (or service_role).
DROP POLICY IF EXISTS "rental_vehicle_swaps_service" ON public.rental_vehicle_swaps;
CREATE POLICY "rental_vehicle_swaps_service"
  ON public.rental_vehicle_swaps
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. The swap RPC
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
BEGIN
  -- Load the rental
  SELECT * INTO v_rental FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental not found';
  END IF;

  -- Authorization: caller must belong to the rental's tenant (or be a super admin)
  IF NOT (is_super_admin() OR get_user_tenant_id() = v_rental.tenant_id) THEN
    RAISE EXCEPTION 'Not authorized to modify this rental';
  END IF;

  -- Can't swap a finished rental
  IF v_rental.status IN ('Cancelled', 'Rejected', 'Closed', 'Completed') THEN
    RAISE EXCEPTION 'Cannot swap the vehicle on a % rental', v_rental.status;
  END IF;

  v_old_vehicle_id := v_rental.vehicle_id;

  IF v_old_vehicle_id = p_new_vehicle_id THEN
    RAISE EXCEPTION 'The replacement vehicle is the same as the current vehicle';
  END IF;

  -- Validate the replacement vehicle exists and belongs to the same tenant
  SELECT * INTO v_new_vehicle FROM vehicles WHERE id = p_new_vehicle_id;
  IF NOT FOUND OR v_new_vehicle.tenant_id <> v_rental.tenant_id THEN
    RAISE EXCEPTION 'Replacement vehicle not found for this tenant';
  END IF;

  IF v_new_vehicle.status = 'Disposed' THEN
    RAISE EXCEPTION 'Cannot swap into a disposed vehicle';
  END IF;

  -- Reassign the vehicle. The prevent_rental_overlap trigger guards against
  -- double-booking the new car during this rental's dates.
  UPDATE rentals
  SET vehicle_id = p_new_vehicle_id,
      updated_at = now()
  WHERE id = p_rental_id;

  -- Free the old vehicle if nothing else is keeping it rented.
  IF v_old_vehicle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM rentals
      WHERE vehicle_id = v_old_vehicle_id
        AND id <> p_rental_id
        AND status IN ('Active', 'Pending')
    ) THEN
      UPDATE vehicles SET status = 'Available'
      WHERE id = v_old_vehicle_id AND status = 'Rented';
    END IF;
  END IF;

  -- Mark the new vehicle as Rented if the rental is currently active.
  IF v_rental.status = 'Active' THEN
    UPDATE vehicles SET status = 'Rented' WHERE id = p_new_vehicle_id;
  END IF;

  -- Optionally block the old vehicle's dates for the maintenance window.
  IF v_old_vehicle_id IS NOT NULL
     AND p_block_old_start IS NOT NULL
     AND p_block_old_end IS NOT NULL THEN
    INSERT INTO blocked_dates (tenant_id, vehicle_id, start_date, end_date, reason)
    VALUES (
      v_rental.tenant_id,
      v_old_vehicle_id,
      p_block_old_start,
      p_block_old_end,
      COALESCE(NULLIF(TRIM(p_reason), ''), 'Vehicle maintenance (swapped out)')
    );
  END IF;

  -- Resolve the acting staff user for the history row (best effort).
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

GRANT EXECUTE ON FUNCTION public.swap_rental_vehicle(uuid, uuid, text, date, date) TO authenticated;
