-- Fix generate_next_rental_charge to use rental_create_charge function which handles conflicts
CREATE OR REPLACE FUNCTION public.generate_next_rental_charge(r_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rental record;
  v_next_due_date date;
  v_last_charge_date date;
BEGIN
  -- Get rental details
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
  
  -- Calculate next due date
  IF v_last_charge_date IS NULL THEN
    -- No charges yet, start from rental start date
    v_next_due_date := v_rental.start_date;
  ELSE
    -- Add one month to last charge date
    v_next_due_date := v_last_charge_date + INTERVAL '1 month';
  END IF;
  
  -- Don't generate charges beyond end date if rental has ended
  IF v_rental.end_date IS NOT NULL AND v_next_due_date > v_rental.end_date THEN
    RETURN; -- No more charges to generate
  END IF;
  
  -- Use rental_create_charge which handles conflicts properly
  PERFORM rental_create_charge(v_rental.id, v_next_due_date, v_rental.monthly_amount);
END;
$function$