-- Create the integrity check function first
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

-- Run repair and check integrity
SELECT repair_missing_ledger_entries();
SELECT * FROM check_payment_data_integrity();