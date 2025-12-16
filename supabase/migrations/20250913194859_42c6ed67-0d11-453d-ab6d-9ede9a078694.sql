-- Phase 1: Manual repair of James Jones missing ledger entry
INSERT INTO ledger_entries (
  customer_id, rental_id, vehicle_id, entry_date,
  type, category, amount, due_date, remaining_amount, payment_id
) VALUES (
  '40ef801a-ff31-40f1-82b0-61e5a8220cf0',
  'ef402ac7-e024-4c38-a246-9039e498e9b1', 
  (SELECT vehicle_id FROM payments WHERE id = 'a33ed367-ba91-448f-a203-1246a3979748'),
  '2025-09-13',
  'Payment',
  'Rental',
  -1000.00,
  '2025-09-13', 
  0,
  'a33ed367-ba91-448f-a203-1246a3979748'
) ON CONFLICT DO NOTHING;

-- Phase 5: Update customer balance calculation to handle credits properly  
CREATE OR REPLACE FUNCTION get_customer_balance_with_status(customer_id_param uuid)
RETURNS TABLE(
  balance numeric,
  status text,
  total_charges numeric,
  total_payments numeric
) AS $$
DECLARE
  v_charges numeric := 0;
  v_payments numeric := 0;
  v_balance numeric;
  v_status text;
BEGIN
  -- Get total charges from outstanding rentals
  SELECT COALESCE(SUM(amount), 0) INTO v_charges
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND remaining_amount > 0;
  
  -- Get total payments made by customer
  SELECT COALESCE(SUM(amount), 0) INTO v_payments
  FROM payments
  WHERE customer_id = customer_id_param;
  
  -- Calculate balance (positive = owe money, negative = in credit)
  v_balance := v_charges - v_payments;
  
  -- Determine status
  IF v_balance = 0 THEN
    v_status := 'Settled';
  ELSIF v_balance > 0 THEN
    v_status := 'In Debt';
  ELSE
    v_status := 'In Credit';
  END IF;
  
  RETURN QUERY SELECT v_balance, v_status, v_charges, v_payments;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;