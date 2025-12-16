-- Create missing generate_next_rental_charge function
CREATE OR REPLACE FUNCTION public.generate_next_rental_charge(r_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
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
  
  -- Create the charge
  INSERT INTO ledger_entries(
    customer_id, rental_id, vehicle_id, 
    entry_date, due_date, type, category, 
    amount, remaining_amount
  )
  VALUES(
    v_rental.customer_id, v_rental.id, v_rental.vehicle_id,
    v_next_due_date, v_next_due_date, 'Charge', 'Rental',
    v_rental.monthly_amount, v_rental.monthly_amount
  );
END;
$$;

-- Add index to speed up lookup of open charges
CREATE INDEX IF NOT EXISTS idx_ledger_rental_open
  ON public.ledger_entries (rental_id, due_date)
  WHERE type = 'Charge' AND category = 'Rental' AND remaining_amount > 0;

-- Ensure apply_payment_fully function exists and is properly defined
CREATE OR REPLACE FUNCTION public.apply_payment_fully(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment record;
  v_active_count int;
  v_charge record;
  v_to_apply numeric(12,2);
BEGIN
  SELECT p.*
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;

  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  -- Resolve rental if missing
  IF v_payment.rental_id IS NULL AND v_payment.payment_type = 'Rental' THEN
    SELECT count(*) INTO v_active_count
    FROM rentals r
    WHERE r.customer_id = v_payment.customer_id
      AND r.status = 'Active';

    IF v_active_count = 1 THEN
      UPDATE public.payments
         SET rental_id = (
           SELECT r.id
           FROM rentals r
           WHERE r.customer_id = v_payment.customer_id
             AND r.status = 'Active'
           LIMIT 1)
       WHERE id = v_payment.id;

      SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;

    ELSIF v_active_count > 1 THEN
      RAISE EXCEPTION 'Select rental to apply this payment (customer has multiple active rentals)';
    ELSE
      RAISE EXCEPTION 'No active rental found for this customer';
    END IF;
  END IF;

  -- Initial fee: immediate revenue + mark applied
  IF v_payment.payment_type = 'InitialFee' THEN
    -- mark applied
    UPDATE public.payments
       SET remaining_amount = 0,
           status = 'Applied'
     WHERE id = v_payment.id;

    -- P&L initial fees entry
    INSERT INTO public.pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_payment.vehicle_id, v_payment.payment_date, 'Revenue', 'Initial Fees', v_payment.amount, v_payment.id::text);

    RETURN;
  END IF;

  -- Rental payment: apply FIFO to open charges; if none, create next charge and retry
  <<apply_loop>>
  LOOP
    FOR v_charge IN
      SELECT id, remaining_amount, due_date
      FROM public.ledger_entries
      WHERE rental_id = v_payment.rental_id
        AND type = 'Charge'
        AND category = 'Rental'
        AND remaining_amount > 0
      ORDER BY due_date ASC
    LOOP
      EXIT WHEN COALESCE(v_payment.remaining_amount, v_payment.amount) <= 0;

      v_to_apply := LEAST(COALESCE(v_payment.remaining_amount, v_payment.amount), v_charge.remaining_amount);

      -- create application row
      INSERT INTO public.payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES (v_payment.id, v_charge.id, v_to_apply);

      -- reduce charge and payment
      UPDATE public.ledger_entries
         SET remaining_amount = remaining_amount - v_to_apply
       WHERE id = v_charge.id;

      UPDATE public.payments
         SET remaining_amount = COALESCE(remaining_amount, amount) - v_to_apply
       WHERE id = v_payment.id;

      -- create revenue P&L entry
      INSERT INTO public.pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
      VALUES (v_payment.vehicle_id, v_payment.payment_date, 'Revenue', 'Rental', v_to_apply, v_payment.id::text);

      -- refresh payment record
      SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    END LOOP;

    -- If still has remaining and no open charges, try creating the next upcoming charge once
    IF COALESCE(v_payment.remaining_amount, 0) > 0 THEN
      PERFORM public.generate_next_rental_charge(v_payment.rental_id);
      -- Then loop again to apply it
      -- Prevent infinite loop: only try once
      IF NOT EXISTS (
        SELECT 1 FROM public.ledger_entries
         WHERE rental_id = v_payment.rental_id
           AND type = 'Charge'
           AND category = 'Rental'
           AND remaining_amount > 0
      ) THEN
        EXIT apply_loop;
      END IF;
    ELSE
      EXIT apply_loop;
    END IF;
  END LOOP;

  -- Finalize payment status
  UPDATE public.payments
     SET remaining_amount = GREATEST(0, COALESCE(remaining_amount, 0)),
         status = CASE WHEN GREATEST(0, COALESCE(remaining_amount, 0)) = 0
                       THEN 'Applied' ELSE 'Partially Applied' END
   WHERE id = v_payment.id;
END;
$$;

-- Update trigger to call apply_payment_fully on payment insertion
CREATE OR REPLACE FUNCTION public.trigger_apply_payment_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Call apply_payment_fully for all payment types
  PERFORM apply_payment_fully(NEW.id);
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists and recreate
DROP TRIGGER IF EXISTS trigger_apply_payments_on_insert ON public.payments;
CREATE TRIGGER trigger_apply_payments_on_insert
  AFTER INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION trigger_apply_payment_on_insert();

-- Backfill currently "Credit" or "Unapplied" payments (attempt auto-attach + apply)
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT id
    FROM public.payments
    WHERE COALESCE(remaining_amount, 0) > 0
       OR status IN ('Credit','Unapplied')
  LOOP
    BEGIN
      PERFORM public.apply_payment_fully(p.id);
    EXCEPTION WHEN OTHERS THEN
      -- leave it, it will be shown as needs rental selection in UI if multiple rentals
      RAISE NOTICE 'Payment % needs manual rental selection (%).', p.id, SQLERRM;
    END;
  END LOOP;
END $$;