-- Update generate_next_rental_charge to handle Daily, Weekly, and Monthly period types

CREATE OR REPLACE FUNCTION public.generate_next_rental_charge(r_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rental record;
  v_next_due_date date;
  v_last_charge_date date;
  v_interval interval;
BEGIN
  -- Get rental details including rental_period_type
  SELECT * INTO v_rental FROM rentals WHERE id = r_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental % not found', r_id;
  END IF;

  -- Find the last charge date for this rental
  SELECT MAX(due_date) INTO v_last_charge_date
  FROM ledger_entries
  WHERE rental_id = r_id
    AND type = 'Charge'
    AND category = 'Rental';

  -- Calculate next due date based on rental_period_type
  IF v_last_charge_date IS NULL THEN
    -- No charges yet, start from rental start date
    v_next_due_date := v_rental.start_date;
  ELSE
    -- Determine interval based on rental_period_type
    CASE v_rental.rental_period_type
      WHEN 'Daily' THEN
        v_interval := INTERVAL '1 day';
      WHEN 'Weekly' THEN
        v_interval := INTERVAL '1 week';
      ELSE -- 'Monthly' or NULL (default)
        v_interval := INTERVAL '1 month';
    END CASE;

    v_next_due_date := v_last_charge_date + v_interval;
  END IF;

  -- Don't generate charges beyond end date if rental has ended
  IF v_rental.end_date IS NOT NULL AND v_next_due_date > v_rental.end_date THEN
    RETURN; -- No more charges to generate
  END IF;

  -- Use rental_create_charge which handles conflicts properly
  PERFORM rental_create_charge(v_rental.id, v_next_due_date, v_rental.monthly_amount);
END;
$function$;

-- Also update the backfill function to handle different period types
CREATE OR REPLACE FUNCTION public.backfill_rental_charges_first_month_only()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rental record;
  v_interval interval;
BEGIN
  -- Loop through all active rentals
  FOR v_rental IN
    SELECT id, customer_id, vehicle_id, start_date, rental_period_type, monthly_amount
    FROM rentals
    WHERE status = 'Active'
  LOOP
    -- Check if this rental already has a first charge
    IF NOT EXISTS (
      SELECT 1 FROM ledger_entries
      WHERE rental_id = v_rental.id
        AND type = 'Charge'
        AND category = 'Rental'
        AND due_date = v_rental.start_date
    ) THEN
      -- Create the first charge for the rental start date
      PERFORM rental_create_charge(
        v_rental.id,
        v_rental.start_date,
        v_rental.monthly_amount
      );
    END IF;
  END LOOP;
END;
$function$;
