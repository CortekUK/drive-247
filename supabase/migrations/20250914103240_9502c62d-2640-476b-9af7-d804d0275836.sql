-- Fix customer balance calculation to use remaining_amount and proper payment logic
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
  -- Get total REMAINING charges (what's actually still owed):
  -- - Rental charges: only include if due_date <= CURRENT_DATE (future rentals not yet owed)
  -- - Fine charges: include ALL charges (immediately owed when charged)
  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_total_charges_due
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND remaining_amount > 0
    AND (
      (category = 'Rental' AND due_date <= CURRENT_DATE) OR
      (category = 'Fine')  -- Include all fine charges regardless of due date
    );
  
  -- Get total rental/fine payments made by customer (excluding InitialFee)
  -- InitialFee payments don't reduce rental debt
  SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type IN ('Payment', 'Fine'); -- Exclude InitialFee from rental debt calculation
  
  -- Calculate net position: remaining charges due - applicable payments
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