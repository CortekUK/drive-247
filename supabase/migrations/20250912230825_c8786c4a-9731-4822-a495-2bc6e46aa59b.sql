-- Create database views for Reports & Exports system

-- 1. Payments Export View
CREATE OR REPLACE VIEW view_payments_export AS
SELECT 
  p.id as payment_id,
  p.payment_date,
  p.customer_id,
  c.name as customer_name,
  c.email as customer_email,
  c.phone as customer_phone,
  p.rental_id,
  p.vehicle_id,
  v.reg as vehicle_reg,
  v.make as vehicle_make,
  v.model as vehicle_model,
  p.payment_type,
  p.method,
  p.amount,
  COALESCE(pa_summary.applied_amount, 0) as applied_amount,
  p.amount - COALESCE(pa_summary.applied_amount, 0) as unapplied_amount,
  COALESCE(pa_summary.allocations_json, '[]'::jsonb) as allocations_json,
  p.created_at
FROM payments p
LEFT JOIN customers c ON c.id = p.customer_id
LEFT JOIN vehicles v ON v.id = p.vehicle_id
LEFT JOIN (
  SELECT 
    pa.payment_id,
    SUM(pa.amount_applied) as applied_amount,
    jsonb_agg(jsonb_build_object(
      'charge_id', le.id,
      'charge_due_date', le.due_date,
      'amount_applied', pa.amount_applied
    )) as allocations_json
  FROM payment_applications pa
  JOIN ledger_entries le ON le.id = pa.charge_entry_id
  GROUP BY pa.payment_id
) pa_summary ON pa_summary.payment_id = p.id;

-- 2. P&L By Vehicle View
CREATE OR REPLACE VIEW view_pl_by_vehicle AS
SELECT 
  v.id as vehicle_id,
  v.reg as vehicle_reg,
  CONCAT(v.make, ' ', v.model) as make_model,
  COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Rental' THEN pe.amount ELSE 0 END), 0) as revenue_rental,
  COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category IN ('Initial Fee', 'Fee') THEN pe.amount ELSE 0 END), 0) as revenue_fees,
  COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category NOT IN ('Rental', 'Initial Fee', 'Fee') THEN pe.amount ELSE 0 END), 0) as revenue_other,
  COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Acquisition' THEN pe.amount ELSE 0 END), 0) as cost_acquisition,
  COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Finance' THEN pe.amount ELSE 0 END), 0) as cost_finance,
  COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Service' THEN pe.amount ELSE 0 END), 0) as cost_service,
  COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Fine' THEN pe.amount ELSE 0 END), 0) as cost_fines,
  COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category NOT IN ('Acquisition', 'Finance', 'Service', 'Fine') THEN pe.amount ELSE 0 END), 0) as cost_other,
  COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount ELSE 0 END), 0) as total_revenue,
  COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount ELSE 0 END), 0) as total_costs,
  COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount ELSE -pe.amount END), 0) as net_profit
FROM vehicles v
LEFT JOIN pnl_entries pe ON pe.vehicle_id = v.id
GROUP BY v.id, v.reg, v.make, v.model;

-- 3. P&L Consolidated View
CREATE OR REPLACE VIEW view_pl_consolidated AS
SELECT 
  'Consolidated' as view_type,
  SUM(revenue_rental) as revenue_rental,
  SUM(revenue_fees) as revenue_fees,
  SUM(revenue_other) as revenue_other,
  SUM(cost_acquisition) as cost_acquisition,
  SUM(cost_finance) as cost_finance,
  SUM(cost_service) as cost_service,
  SUM(cost_fines) as cost_fines,
  SUM(cost_other) as cost_other,
  SUM(total_revenue) as total_revenue,
  SUM(total_costs) as total_costs,
  SUM(net_profit) as net_profit
FROM view_pl_by_vehicle;

-- 4. Rentals Export View
CREATE OR REPLACE VIEW view_rentals_export AS
SELECT 
  r.id as rental_id,
  c.name as customer_name,
  v.reg as vehicle_reg,
  r.start_date,
  r.end_date,
  r.schedule,
  r.monthly_amount,
  r.status,
  COALESCE(initial_payments.initial_fee_amount, 0) as initial_fee_amount,
  COALESCE(charges.total_charges, 0) - COALESCE(applied_payments.total_applied, 0) as balance
FROM rentals r
LEFT JOIN customers c ON c.id = r.customer_id
LEFT JOIN vehicles v ON v.id = r.vehicle_id
LEFT JOIN (
  SELECT 
    rental_id,
    SUM(amount) as initial_fee_amount
  FROM payments 
  WHERE payment_type = 'Initial Fee'
  GROUP BY rental_id
) initial_payments ON initial_payments.rental_id = r.id
LEFT JOIN (
  SELECT 
    rental_id,
    SUM(amount) as total_charges
  FROM ledger_entries 
  WHERE type = 'Charge' AND due_date <= CURRENT_DATE
  GROUP BY rental_id
) charges ON charges.rental_id = r.id
LEFT JOIN (
  SELECT 
    le.rental_id,
    SUM(pa.amount_applied) as total_applied
  FROM payment_applications pa
  JOIN ledger_entries le ON le.id = pa.charge_entry_id
  WHERE le.type = 'Charge'
  GROUP BY le.rental_id
) applied_payments ON applied_payments.rental_id = r.id;

-- 5. Aging Receivables View
CREATE OR REPLACE VIEW view_aging_receivables AS
SELECT 
  c.id as customer_id,
  c.name as customer_name,
  SUM(CASE WHEN (CURRENT_DATE - le.due_date) BETWEEN 0 AND 30 THEN le.remaining_amount ELSE 0 END) as bucket_0_30,
  SUM(CASE WHEN (CURRENT_DATE - le.due_date) BETWEEN 31 AND 60 THEN le.remaining_amount ELSE 0 END) as bucket_31_60,
  SUM(CASE WHEN (CURRENT_DATE - le.due_date) BETWEEN 61 AND 90 THEN le.remaining_amount ELSE 0 END) as bucket_61_90,
  SUM(CASE WHEN (CURRENT_DATE - le.due_date) > 90 THEN le.remaining_amount ELSE 0 END) as bucket_90_plus,
  SUM(le.remaining_amount) as total_due
FROM customers c
JOIN ledger_entries le ON le.customer_id = c.id
WHERE le.type = 'Charge' 
  AND le.remaining_amount > 0 
  AND le.due_date <= CURRENT_DATE
GROUP BY c.id, c.name
HAVING SUM(le.remaining_amount) > 0;

-- 6. Customer Statement Function
CREATE OR REPLACE FUNCTION get_customer_statement(
  p_customer_id UUID,
  p_from_date DATE,
  p_to_date DATE
)
RETURNS TABLE(
  transaction_date DATE,
  type TEXT,
  description TEXT,
  debit NUMERIC,
  credit NUMERIC,
  running_balance NUMERIC,
  rental_id UUID,
  vehicle_reg TEXT
) AS $$
DECLARE
  opening_balance NUMERIC := 0;
  current_balance NUMERIC := 0;
BEGIN
  -- Calculate opening balance
  SELECT COALESCE(
    (SELECT SUM(pa.amount_applied) 
     FROM payment_applications pa
     JOIN ledger_entries le ON le.id = pa.charge_entry_id
     JOIN payments p ON p.id = pa.payment_id
     WHERE le.customer_id = p_customer_id AND p.payment_date < p_from_date)
    -
    (SELECT SUM(le.amount)
     FROM ledger_entries le
     WHERE le.customer_id = p_customer_id 
       AND le.type = 'Charge' 
       AND le.due_date < p_from_date), 0
  ) INTO opening_balance;
  
  current_balance := opening_balance;
  
  -- Return transactions in date order
  RETURN QUERY
  WITH statement_transactions AS (
    -- Charges
    SELECT 
      le.due_date as transaction_date,
      'Charge'::TEXT as type,
      CONCAT('Rental charge - ', v.reg) as description,
      le.amount as debit,
      0::NUMERIC as credit,
      le.rental_id,
      v.reg as vehicle_reg,
      le.due_date as sort_date,
      le.id::TEXT as sort_id
    FROM ledger_entries le
    JOIN vehicles v ON v.id = le.vehicle_id
    WHERE le.customer_id = p_customer_id
      AND le.type = 'Charge'
      AND le.due_date BETWEEN p_from_date AND p_to_date
    
    UNION ALL
    
    -- Payments
    SELECT 
      p.payment_date as transaction_date,
      'Payment'::TEXT as type,
      CONCAT('Payment - ', p.method) as description,
      0::NUMERIC as debit,
      p.amount as credit,
      p.rental_id,
      v.reg as vehicle_reg,
      p.payment_date as sort_date,
      p.id::TEXT as sort_id
    FROM payments p
    LEFT JOIN vehicles v ON v.id = p.vehicle_id
    WHERE p.customer_id = p_customer_id
      AND p.payment_date BETWEEN p_from_date AND p_to_date
  )
  SELECT 
    st.transaction_date,
    st.type,
    st.description,
    st.debit,
    st.credit,
    opening_balance + SUM(st.credit - st.debit) OVER (ORDER BY st.sort_date, st.sort_id) as running_balance,
    st.rental_id,
    st.vehicle_reg
  FROM statement_transactions st
  ORDER BY st.sort_date, st.sort_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;