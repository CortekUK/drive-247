-- Fix payment_apply_fifo_v2 to handle P&L constraint violations
CREATE OR REPLACE FUNCTION public.payment_apply_fifo_v2(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_amt NUMERIC;
  v_left NUMERIC;
  v_rental UUID;
  v_customer UUID;
  v_vehicle UUID;
  v_pay_date DATE;
  v_is_early BOOLEAN;
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early
  FROM payments WHERE id = p_id;

  -- Skip if no customer
  IF v_customer IS NULL THEN
    RETURN;
  END IF;

  v_left := v_amt;

  -- Mirror payment in ledger (audit trail)
  INSERT INTO ledger_entries(
    customer_id, rental_id, vehicle_id, entry_date,
    type, category, amount, remaining_amount
  )
  VALUES(
    v_customer, v_rental, v_vehicle, v_pay_date,
    'Payment', 'Rental', v_amt, 0
  )
  ON CONFLICT DO NOTHING;

  -- Auto-detect early payment if not explicitly set
  IF NOT v_is_early THEN
    SELECT MIN(due_date) INTO next_due_date
    FROM ledger_entries
    WHERE customer_id = v_customer
      AND type = 'Charge' 
      AND category = 'Rental'
      AND remaining_amount > 0;
    
    IF next_due_date IS NOT NULL AND v_pay_date < next_due_date THEN
      v_is_early := TRUE;
      UPDATE payments SET is_early = TRUE WHERE id = p_id;
    END IF;
  END IF;

  -- Allocate to ALL charges (due and future) for this customer in FIFO order by due_date, then entry_date
  FOR c IN
    SELECT id, remaining_amount, due_date
      FROM ledger_entries
     WHERE customer_id = v_customer
       AND type='Charge' AND category='Rental'
       AND remaining_amount > 0
       AND (v_rental IS NULL OR rental_id = v_rental)
     ORDER BY due_date ASC, entry_date ASC, id ASC
  LOOP
    EXIT WHEN v_left <= 0;

    to_apply := LEAST(c.remaining_amount, v_left);

    INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
    VALUES (p_id, c.id, to_apply)
    ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;

    UPDATE ledger_entries
       SET remaining_amount = remaining_amount - to_apply
     WHERE id = c.id;

    -- Book revenue on the charge due date (even if future) with conflict handling
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, c.due_date, 'Revenue', 'Rental', to_apply, p_id::text)
    ON CONFLICT (vehicle_id, category, source_ref) 
    DO UPDATE SET amount = pnl_entries.amount + EXCLUDED.amount;

    v_left := v_left - to_apply;
  END LOOP;

  -- Update payment status based on remaining amount
  IF v_left = 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
  ELSIF v_left = v_amt THEN
    UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p_id;
  ELSE
    UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p_id;
  END IF;
END;
$function$