-- Create function to generate first charge for a specific rental (used by client booking flow)
-- This function works regardless of rental status (Pending or Active)

CREATE OR REPLACE FUNCTION public.generate_first_charge_for_rental(rental_id_param uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rental record;
BEGIN
  -- Get rental details
  SELECT id, customer_id, vehicle_id, start_date, monthly_amount, status
  INTO v_rental
  FROM rentals
  WHERE id = rental_id_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental % not found', rental_id_param;
  END IF;

  -- Check if this rental already has a first charge
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE rental_id = v_rental.id
      AND type = 'Charge'
      AND category = 'Rental'
      AND due_date = v_rental.start_date
  ) THEN
    -- Charge already exists, skip
    RETURN;
  END IF;

  -- Create the first charge for the rental start date
  -- Uses rental_create_charge which directly inserts into ledger_entries
  PERFORM rental_create_charge(
    v_rental.id,
    v_rental.start_date,
    v_rental.monthly_amount
  );

  RAISE NOTICE 'Created first charge for rental % with status %', v_rental.id, v_rental.status;
END;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.generate_first_charge_for_rental(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_first_charge_for_rental(uuid) TO anon;

COMMENT ON FUNCTION public.generate_first_charge_for_rental(uuid) IS
'Generates the first charge (ledger entry) for a specific rental, regardless of its status. Used by client-side booking flow where rentals are created as Pending before payment.';
