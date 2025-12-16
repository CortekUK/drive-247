-- Backfill ledger entries for existing charged customer fines
INSERT INTO ledger_entries (
  customer_id, 
  vehicle_id, 
  entry_date, 
  type, 
  category, 
  amount, 
  due_date, 
  remaining_amount,
  reference
)
SELECT 
  f.customer_id,
  f.vehicle_id,
  f.charged_at::date,
  'Charge',
  'Fine',
  f.amount,
  f.due_date,
  f.amount, -- Start with full amount as remaining
  'fine_backfill_' || f.id::text
FROM fines f
WHERE f.status = 'Charged' 
  AND f.customer_id IS NOT NULL
  AND f.charged_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries le 
    WHERE le.reference = 'fine_backfill_' || f.id::text
  );

-- Create P&L cost entries for business liability fines (immediate cost recognition)
INSERT INTO pnl_entries (
  vehicle_id, 
  entry_date, 
  side, 
  category, 
  amount, 
  reference,
  customer_id
)
SELECT DISTINCT
  f.vehicle_id,
  f.issue_date,
  'Cost',
  'Fines',
  f.amount,
  'fine_cost_' || f.id::text,
  f.customer_id
FROM fines f
WHERE f.liability = 'Business'
  AND NOT EXISTS (
    SELECT 1 FROM pnl_entries pe 
    WHERE pe.reference = 'fine_cost_' || f.id::text
  )
ON CONFLICT (reference) DO NOTHING;