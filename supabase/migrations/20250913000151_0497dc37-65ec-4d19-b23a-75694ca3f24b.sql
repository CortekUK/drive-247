-- Fix function search path issues
CREATE OR REPLACE FUNCTION public.fine_create_charge(f_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  fc RECORD; 
  cid UUID;
BEGIN
  SELECT * INTO fc FROM fines WHERE id = f_id;
  
  -- Only create charge if liability is Customer and customer is assigned
  IF fc.liability = 'Customer' AND fc.customer_id IS NOT NULL THEN
    INSERT INTO ledger_entries(
      customer_id, 
      vehicle_id, 
      entry_date, 
      type, 
      category, 
      amount, 
      due_date, 
      remaining_amount
    )
    VALUES(
      fc.customer_id, 
      fc.vehicle_id, 
      fc.issue_date, 
      'Charge', 
      'Fine', 
      fc.amount, 
      fc.due_date, 
      fc.amount
    )
    RETURNING id INTO cid;
  END IF;
  
  -- If liability is Business, create P&L cost entry
  IF fc.liability = 'Business' THEN
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (fc.vehicle_id, fc.issue_date, 'Cost', 'Fines', fc.amount, fc.id::text);
  END IF;
  
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.fine_apply_payment_fifo(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amt NUMERIC; 
  v_left NUMERIC; 
  v_customer UUID; 
  v_vehicle UUID; 
  v_date DATE;
  c RECORD; 
  applied_total NUMERIC := 0;
BEGIN
  SELECT amount, customer_id, vehicle_id, payment_date
  INTO v_amt, v_customer, v_vehicle, v_date
  FROM payments WHERE id = p_id;

  v_left := v_amt;

  -- Apply to fine charges FIFO
  FOR c IN
    SELECT id, remaining_amount
    FROM ledger_entries
    WHERE customer_id = v_customer 
      AND type = 'Charge' 
      AND category = 'Fine'
      AND remaining_amount > 0 
      AND due_date <= CURRENT_DATE
    ORDER BY due_date ASC, entry_date ASC
  LOOP
    EXIT WHEN v_left <= 0;
    
    IF c.remaining_amount <= v_left THEN
      INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES(p_id, c.id, c.remaining_amount);
      UPDATE ledger_entries SET remaining_amount = 0 WHERE id = c.id;
      applied_total := applied_total + c.remaining_amount;
      v_left := v_left - c.remaining_amount;
    ELSE
      INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES(p_id, c.id, v_left);
      UPDATE ledger_entries SET remaining_amount = remaining_amount - v_left WHERE id = c.id;
      applied_total := applied_total + v_left;
      v_left := 0;
    END IF;
  END LOOP;

  -- Update fine status based on remaining amounts
  UPDATE fines 
  SET status = CASE 
    WHEN (SELECT SUM(remaining_amount) FROM ledger_entries 
          WHERE customer_id = v_customer AND type = 'Charge' AND category = 'Fine') = 0 
    THEN 'Paid'
    WHEN (SELECT SUM(remaining_amount) FROM ledger_entries 
          WHERE customer_id = v_customer AND type = 'Charge' AND category = 'Fine') < amount 
    THEN 'Partially Paid'
    ELSE status
  END
  WHERE customer_id = v_customer AND status IN ('Open', 'Partially Paid');

  -- Post P&L revenue for applied amount
  IF applied_total > 0 THEN
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, v_date, 'Revenue', 'Fine', applied_total, p_id::text);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fine_void_charge(f_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fc RECORD;
  remaining_amt NUMERIC;
BEGIN
  SELECT * INTO fc FROM fines WHERE id = f_id;
  
  -- Get remaining amount from ledger
  SELECT SUM(remaining_amount) INTO remaining_amt
  FROM ledger_entries 
  WHERE customer_id = fc.customer_id 
    AND type = 'Charge' 
    AND category = 'Fine'
    AND remaining_amount > 0;
  
  -- Void remaining charges
  UPDATE ledger_entries 
  SET remaining_amount = 0 
  WHERE customer_id = fc.customer_id 
    AND type = 'Charge' 
    AND category = 'Fine'
    AND remaining_amount > 0;
  
  -- Create adjustment if there was remaining amount
  IF remaining_amt > 0 THEN
    INSERT INTO ledger_entries(
      customer_id, 
      vehicle_id, 
      entry_date, 
      type, 
      category, 
      amount, 
      remaining_amount
    )
    VALUES(
      fc.customer_id, 
      fc.vehicle_id, 
      CURRENT_DATE, 
      'Adjustment', 
      'Fine', 
      -remaining_amt, 
      0
    );
  END IF;
  
  -- Update fine status
  UPDATE fines SET status = 'Appeal Successful' WHERE id = f_id;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_create_fine_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fine_create_charge(NEW.id);
  RETURN NEW;
END $$;