-- Fix the repair function to handle unique constraints properly
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
    
    -- Insert missing ledger entry using ON CONFLICT to handle duplicates
    BEGIN
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
    EXCEPTION
      WHEN unique_violation THEN
        -- If there's a unique constraint violation, skip this entry
        CONTINUE;
    END;
  END LOOP;
  
  RETURN 'Repaired ' || missing_count || ' missing ledger entries';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run repair function to fix current issues
SELECT repair_missing_ledger_entries();

-- Check integrity after repair
SELECT * FROM check_payment_data_integrity();