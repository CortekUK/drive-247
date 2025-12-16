-- Fix customer balance calculation to include correct payment types
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
  -- Get total charges with different logic for rental vs fine charges:
  -- - Rental charges: only include if due_date <= CURRENT_DATE (future rentals not yet owed)
  -- - Fine charges: include ALL charges (immediately owed when charged)
  SELECT COALESCE(SUM(amount), 0) INTO v_total_charges_due
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND (
      (category = 'Rental' AND due_date <= CURRENT_DATE) OR
      (category = 'Fine')  -- Include all fine charges regardless of due date
    );
  
  -- Get total payments (Payment + InitialFee + Fine) made by customer
  -- Updated to use the correct payment_type values
  SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type IN ('Payment', 'InitialFee', 'Fine');
  
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