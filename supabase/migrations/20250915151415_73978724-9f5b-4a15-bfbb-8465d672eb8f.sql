-- Fix missing ledger entry for payment 963c0187-912c-4aa4-9d0f-60063c2a8395
-- This payment exists with applications but no ledger entry, causing balance calculation issues

INSERT INTO ledger_entries (
  customer_id, 
  rental_id, 
  vehicle_id, 
  entry_date, 
  type, 
  category, 
  amount, 
  due_date, 
  remaining_amount, 
  payment_id
)
SELECT 
  p.customer_id,
  p.rental_id,
  p.vehicle_id,
  p.payment_date,
  'Payment',
  'Rental',
  -p.amount,  -- Negative for payment
  p.payment_date,
  0,  -- Payments have 0 remaining amount
  p.id
FROM payments p
WHERE p.id = '963c0187-912c-4aa4-9d0f-60063c2a8395'
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id
  );

-- Also check and fix any other payments missing ledger entries (excluding InitialFee)
INSERT INTO ledger_entries (
  customer_id, 
  rental_id, 
  vehicle_id, 
  entry_date, 
  type, 
  category, 
  amount, 
  due_date, 
  remaining_amount, 
  payment_id
)
SELECT 
  p.customer_id,
  p.rental_id,
  p.vehicle_id,
  p.payment_date,
  'Payment',
  CASE 
    WHEN LOWER(p.payment_type) = 'rental' THEN 'Rental'
    WHEN LOWER(p.payment_type) = 'fine' THEN 'Fines'
    ELSE 'Other'
  END,
  -p.amount,  -- Negative for payment
  p.payment_date,
  0,  -- Payments have 0 remaining amount
  p.id
FROM payments p
WHERE LOWER(COALESCE(p.payment_type, '')) NOT IN ('initial fee', 'initial fees', 'initialfee')
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le WHERE le.payment_id = p.id
  );