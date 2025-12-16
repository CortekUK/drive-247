-- Add fine_void_charge function for appeal handling
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
  
  -- Get remaining amount from ledger for this fine's customer
  SELECT SUM(remaining_amount) INTO remaining_amt
  FROM ledger_entries 
  WHERE customer_id = fc.customer_id 
    AND type = 'Charge' 
    AND category = 'Fine'
    AND remaining_amount > 0;
  
  -- Void remaining charges for this customer's fines
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
END $$;