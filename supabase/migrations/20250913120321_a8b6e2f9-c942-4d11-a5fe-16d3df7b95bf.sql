-- Fix timestamp usage in payment functions
-- Update payment_apply_fifo_v2 to use payment_date instead of created_at
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

    -- Book revenue on the charge due date (even if future)
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, c.due_date, 'Revenue', 'Rental', to_apply, p_id::text);

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
$function$;

-- Update reapply_all_payments_v2 to order by payment_date instead of created_at
CREATE OR REPLACE FUNCTION public.reapply_all_payments_v2()
RETURNS TABLE(payments_processed integer, customers_affected integer, total_credit_applied numeric)
LANGUAGE plpgsql
AS $function$
DECLARE
  p RECORD;
  payment_count INTEGER := 0;
  customer_count INTEGER := 0;
  credit_applied NUMERIC := 0;
  customers_set UUID[] := '{}';
BEGIN
  -- Reset computed data safely
  DELETE FROM pnl_entries WHERE category='Rental' AND source_ref IS NOT NULL;
  UPDATE ledger_entries
    SET remaining_amount = amount
   WHERE type='Charge' AND category='Rental';
  DELETE FROM payment_applications;
  UPDATE payments SET status = 'Applied', remaining_amount = 0;

  -- Reapply all payments in payment_date order (business chronological order)
  FOR p IN
    SELECT id, customer_id FROM payments ORDER BY payment_date ASC, id ASC
  LOOP
    PERFORM payment_apply_fifo_v2(p.id);
    payment_count := payment_count + 1;
    
    -- Track unique customers
    IF NOT (p.customer_id = ANY(customers_set)) THEN
      customers_set := customers_set || p.customer_id;
      customer_count := customer_count + 1;
    END IF;
  END LOOP;

  -- Calculate total credit held
  SELECT COALESCE(SUM(remaining_amount), 0) INTO credit_applied
  FROM payments WHERE status IN ('Credit', 'Partial');

  RETURN QUERY SELECT payment_count, customer_count, credit_applied;
END;
$function$;

-- Update auto_apply_customer_credit to use payment_date order instead of created_at
CREATE OR REPLACE FUNCTION auto_apply_customer_credit()
RETURNS TRIGGER AS $$
DECLARE
  credit_payment RECORD;
BEGIN
  -- Only process rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' AND NEW.remaining_amount > 0 THEN
    -- Find payments with remaining credit for this customer, ordered by payment_date
    FOR credit_payment IN
      SELECT id FROM payments 
      WHERE customer_id = NEW.customer_id 
        AND status IN ('Credit', 'Partial')
        AND remaining_amount > 0
      ORDER BY payment_date ASC, id ASC
    LOOP
      -- Apply the payment using our FIFO function
      PERFORM payment_apply_fifo(credit_payment.id);
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update payment_auto_apply_due_credit to check payment_date instead of created_at
CREATE OR REPLACE FUNCTION public.payment_auto_apply_due_credit()
RETURNS void
LANGUAGE plpgsql
AS $function$
declare
  p record;
begin
  for p in
    select p.id
    from payments p
    where
      -- has unapplied balance
      (select coalesce(p.amount - sum(pa.amount_applied), p.amount)
         from payment_applications pa
        where pa.payment_id = p.id) > 0
      -- payment date is not in the future
      and p.payment_date <= current_date
  loop
    perform payment_apply_fifo(p.id);
  end loop;
end;
$function$;