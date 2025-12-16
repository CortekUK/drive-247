-- Fix customer balance calculation to use remaining amounts instead of double-counting
CREATE OR REPLACE FUNCTION public.get_customer_balance_with_status(customer_id_param uuid)
 RETURNS TABLE(balance numeric, status text, total_charges numeric, total_payments numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_balance numeric := 0;
  v_total_charges numeric := 0;
  v_total_payments numeric := 0;
  v_status text;
BEGIN
  -- Get sum of remaining amounts for all due charges (this is what customer actually owes)
  -- Exclude Initial Fees from debt calculation as they are deposits
  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_balance
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND category != 'Initial Fees'  -- Exclude Initial Fees from debt
    AND due_date <= CURRENT_DATE    -- Only count charges that are due
    AND remaining_amount > 0;       -- Only unpaid amounts
  
  -- Get total charges for reporting (original amounts)
  SELECT COALESCE(SUM(amount), 0) INTO v_total_charges
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND category != 'Initial Fees'
    AND due_date <= CURRENT_DATE;
  
  -- Get total payments for reporting
  SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type != 'InitialFee';
  
  -- Determine status based on remaining amounts
  IF v_balance = 0 THEN
    v_status := 'Settled';
  ELSIF v_balance > 0 THEN
    v_status := 'In Debt';
  ELSE
    v_status := 'In Credit';
  END IF;
  
  RETURN QUERY SELECT v_balance, v_status, v_total_charges, v_total_payments;
END;
$function$