-- Update the existing payment_apply_fifo function to handle different categories
CREATE OR REPLACE FUNCTION public.payment_apply_fifo(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amt NUMERIC; 
  v_left NUMERIC; 
  v_rental UUID; 
  v_customer UUID; 
  v_vehicle UUID; 
  v_date DATE;
  v_payment_type TEXT;
  c RECORD; 
  applied_total NUMERIC := 0;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, payment_type
  INTO v_amt, v_rental, v_customer, v_vehicle, v_date, v_payment_type
  FROM payments WHERE id = p_id;

  v_left := v_amt;

  -- Mirror receipt in ledger
  INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, remaining_amount)
  VALUES(v_customer, v_rental, v_vehicle, v_date, 'Payment', 
         CASE WHEN v_payment_type = 'Fine' THEN 'Fine' ELSE 'Rental' END, 
         v_amt, 0);

  -- Apply to charges FIFO based on payment type
  FOR c IN
    SELECT id, remaining_amount
    FROM ledger_entries
    WHERE customer_id = v_customer 
      AND type = 'Charge' 
      AND (CASE WHEN v_payment_type = 'Fine' THEN category = 'Fine' ELSE category IN ('Rental', 'InitialFee') END)
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

  -- Post P&L revenue for applied amount
  IF applied_total > 0 THEN
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, v_date, 'Revenue', 
            CASE WHEN v_payment_type = 'Fine' THEN 'Fine' ELSE 'Rental' END, 
            applied_total, p_id::text);
  END IF;

  -- Update fine status if this was a fine payment
  IF v_payment_type = 'Fine' THEN
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
  END IF;
END $$;