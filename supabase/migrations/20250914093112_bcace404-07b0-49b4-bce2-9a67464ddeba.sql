-- Fix customer balance to include fine charges and payments
CREATE OR REPLACE FUNCTION public.get_customer_balance_with_status(customer_id_param uuid)
 RETURNS TABLE(balance numeric, status text, total_charges numeric, total_payments numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_balance numeric := 0;
  v_total_charges_due numeric := 0;
  v_total_payments numeric := 0;
  v_status text;
BEGIN
  -- Get total charges (rental + fine) that are due as of today (original amounts)
  SELECT COALESCE(SUM(amount), 0) INTO v_total_charges_due
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND category IN ('Rental', 'Fine')  -- Include both rental and fine charges
    AND due_date <= CURRENT_DATE;
  
  -- Get total payments (rental + fine) made by customer
  SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type IN ('Rental', 'Fine');  -- Include both rental and fine payments
  
  -- Calculate net position: charges due - payments
  v_balance := v_total_charges_due - v_total_payments;
  
  -- Determine status based on net position
  IF v_balance = 0 THEN
    v_status := 'Settled';
  ELSIF v_balance > 0 THEN
    v_status := 'In Debt';
  ELSE
    v_status := 'In Credit';
    -- Return positive credit amount
    v_balance := ABS(v_balance);
  END IF;
  
  RETURN QUERY SELECT v_balance, v_status, v_total_charges_due, v_total_payments;
END;
$function$