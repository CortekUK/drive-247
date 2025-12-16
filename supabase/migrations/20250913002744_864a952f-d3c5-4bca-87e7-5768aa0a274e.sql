-- Create view for customer statements with running balance
CREATE OR REPLACE VIEW public.view_customer_statements AS
SELECT 
  le.customer_id,
  c.name as customer_name,
  c.email as customer_email,
  c.phone as customer_phone,
  le.id as entry_id,
  le.entry_date,
  le.type,
  le.category,
  le.amount,
  le.remaining_amount,
  le.due_date,
  le.rental_id,
  le.vehicle_id,
  v.reg as vehicle_reg,
  v.make as vehicle_make,
  v.model as vehicle_model,
  CASE 
    WHEN le.type = 'Payment' THEN le.amount
    ELSE -le.amount
  END as transaction_amount,
  SUM(CASE 
    WHEN le.type = 'Payment' THEN le.amount
    ELSE -le.amount
  END) OVER (
    PARTITION BY le.customer_id 
    ORDER BY le.entry_date, le.id
    ROWS UNBOUNDED PRECEDING
  ) as running_balance
FROM ledger_entries le
JOIN customers c ON c.id = le.customer_id
LEFT JOIN vehicles v ON v.id = le.vehicle_id
WHERE le.type != 'Upcoming' OR le.type IS NULL
ORDER BY le.customer_id, le.entry_date, le.id;

-- Create view for fines export
CREATE OR REPLACE VIEW public.view_fines_export AS
SELECT 
  f.id as fine_id,
  f.reference_no,
  f.type,
  f.issue_date,
  f.due_date,
  f.amount,
  f.liability,
  f.status,
  f.notes,
  c.name as customer_name,
  c.email as customer_email,
  c.phone as customer_phone,
  v.reg as vehicle_reg,
  v.make as vehicle_make,
  v.model as vehicle_model,
  COALESCE(le.remaining_amount, f.amount) as remaining_amount,
  CASE 
    WHEN f.status = 'Appealed' THEN 'Pending'
    WHEN f.status = 'Appeal Successful' THEN 'Successful'
    WHEN f.status = 'Appeal Rejected' THEN 'Rejected'
    ELSE 'None'
  END as appeal_status
FROM fines f
JOIN customers c ON c.id = f.customer_id
JOIN vehicles v ON v.id = f.vehicle_id
LEFT JOIN ledger_entries le ON le.customer_id = f.customer_id 
  AND le.vehicle_id = f.vehicle_id 
  AND le.type = 'Charge' 
  AND le.category = 'Fine'
  AND ABS(le.amount - f.amount) < 0.01
  AND le.due_date = f.due_date;