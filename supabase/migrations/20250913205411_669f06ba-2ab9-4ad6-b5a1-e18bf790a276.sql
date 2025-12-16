-- Fix customer balance calculation to only include due charges and separate Initial Fees
CREATE OR REPLACE FUNCTION public.get_customer_balance_with_status(customer_id_param uuid)
 RETURNS TABLE(balance numeric, status text, total_charges numeric, total_payments numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_due_charges numeric := 0;
  v_rental_payments numeric := 0;
  v_balance numeric;
  v_status text;
BEGIN
  -- Get total charges that are DUE (due_date <= current_date) and outstanding
  -- Exclude Initial Fees from debt calculation as they are deposits
  SELECT COALESCE(SUM(amount), 0) INTO v_due_charges
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND category != 'Initial Fees'  -- Exclude Initial Fees from debt
    AND due_date <= CURRENT_DATE    -- Only count charges that are due
    AND remaining_amount > 0;
  
  -- Get total rental payments made by customer (exclude Initial Fees)
  SELECT COALESCE(SUM(amount), 0) INTO v_rental_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type != 'InitialFee';  -- Exclude Initial Fee payments from debt offset
  
  -- Calculate balance (positive = owe money, negative = in credit)
  v_balance := v_due_charges - v_rental_payments;
  
  -- Determine status
  IF v_balance = 0 THEN
    v_status := 'Settled';
  ELSIF v_balance > 0 THEN
    v_status := 'In Debt';
  ELSE
    v_status := 'In Credit';
  END IF;
  
  RETURN QUERY SELECT v_balance, v_status, v_due_charges, v_rental_payments;
END;
$function$