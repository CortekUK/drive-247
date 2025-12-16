-- Phase 1: Data Repair & Synchronization
-- Create function to repair missing ledger entries for payments
CREATE OR REPLACE FUNCTION repair_missing_ledger_entries()
RETURNS TEXT AS $$
DECLARE
  missing_count INTEGER := 0;
  payment_rec RECORD;
  category_mapped TEXT;
BEGIN
  -- Find payments without corresponding ledger entries
  FOR payment_rec IN
    SELECT p.id, p.customer_id, p.rental_id, p.vehicle_id, p.amount, 
           p.payment_date, p.payment_type
    FROM payments p
    LEFT JOIN ledger_entries le ON le.payment_id = p.id
    WHERE le.id IS NULL
  LOOP
    -- Map payment category
    category_mapped := CASE 
      WHEN LOWER(COALESCE(payment_rec.payment_type, '')) IN ('initial fee', 'initial fees', 'initialfee') THEN 'Initial Fees'
      WHEN LOWER(COALESCE(payment_rec.payment_type, '')) = 'rental' THEN 'Rental'
      WHEN LOWER(COALESCE(payment_rec.payment_type, '')) = 'fine' THEN 'Fines'
      ELSE 'Other'
    END;
    
    -- Insert missing ledger entry
    INSERT INTO ledger_entries (
      customer_id, rental_id, vehicle_id, entry_date,
      type, category, amount, due_date, remaining_amount, payment_id
    ) VALUES (
      payment_rec.customer_id,
      payment_rec.rental_id,
      payment_rec.vehicle_id,
      payment_rec.payment_date,
      'Payment',
      category_mapped,
      -ABS(payment_rec.amount), -- Ensure negative
      payment_rec.payment_date,
      0,
      payment_rec.id
    );
    
    missing_count := missing_count + 1;
  END LOOP;
  
  RETURN 'Repaired ' || missing_count || ' missing ledger entries';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Phase 4: System Integrity Monitoring
-- Create function to check data consistency
CREATE OR REPLACE FUNCTION check_payment_data_integrity()
RETURNS TABLE(
  issue_type TEXT,
  issue_count INTEGER,
  details TEXT
) AS $$
BEGIN
  -- Check 1: Payments without ledger entries
  RETURN QUERY
  SELECT 
    'missing_ledger_entries'::TEXT,
    COUNT(*)::INTEGER,
    'Payments without corresponding ledger entries'::TEXT
  FROM payments p
  LEFT JOIN ledger_entries le ON le.payment_id = p.id
  WHERE le.id IS NULL;
  
  -- Check 2: Ledger entries without payments
  RETURN QUERY
  SELECT 
    'orphaned_ledger_entries'::TEXT,
    COUNT(*)::INTEGER,
    'Payment ledger entries without corresponding payments'::TEXT
  FROM ledger_entries le
  LEFT JOIN payments p ON p.id = le.payment_id
  WHERE le.type = 'Payment' AND le.payment_id IS NOT NULL AND p.id IS NULL;
  
  -- Check 3: Payment status inconsistencies
  RETURN QUERY
  SELECT 
    'status_inconsistencies'::TEXT,
    COUNT(*)::INTEGER,
    'Payments with status/remaining_amount mismatches'::TEXT
  FROM payments p
  WHERE (p.status = 'Applied' AND p.remaining_amount > 0)
     OR (p.status = 'Credit' AND p.remaining_amount = 0)
     OR (p.status = 'Partial' AND (p.remaining_amount = 0 OR p.remaining_amount = p.amount));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run repair function immediately to fix current issues
SELECT repair_missing_ledger_entries();

-- Check integrity after repair
SELECT * FROM check_payment_data_integrity();