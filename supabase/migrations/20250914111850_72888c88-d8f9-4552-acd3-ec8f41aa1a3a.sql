-- Fix James Rodriguez and all customers - Clean up future charges and Initial Fee ledger issues
-- 1. Remove all future rental charges (due_date > CURRENT_DATE)
DELETE FROM ledger_entries 
WHERE type = 'Charge' 
  AND category = 'Rental' 
  AND due_date > CURRENT_DATE;

-- 2. Remove Initial Fee ledger entries that create customer debt (these should only be P&L revenue)
DELETE FROM ledger_entries 
WHERE payment_id IN (
  SELECT id FROM payments WHERE payment_type = 'InitialFee'
);

-- 3. Update the customer balance function to only include currently due charges
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
  -- Get total charges that are currently due (due_date <= CURRENT_DATE)
  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_total_charges_due
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND remaining_amount > 0
    AND due_date <= CURRENT_DATE; -- Only currently due charges
  
  -- Get total payments made by customer (excluding InitialFee which is company revenue)
  SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type IN ('Payment', 'Rental', 'Fine'); -- Exclude InitialFee from customer debt calculation
  
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
$function$;