-- Migration: Add tenant_id to export views for multi-tenancy support
-- This fixes 400 Bad Request errors when filtering views by tenant_id

-- Drop and recreate view_aging_receivables with tenant_id
DROP VIEW IF EXISTS "public"."view_aging_receivables";
CREATE OR REPLACE VIEW "public"."view_aging_receivables" AS
SELECT
    c.id AS customer_id,
    c.tenant_id,
    c.name AS customer_name,
    SUM(CASE WHEN (CURRENT_DATE - le.due_date) >= 0 AND (CURRENT_DATE - le.due_date) <= 30 THEN le.remaining_amount ELSE 0 END) AS bucket_0_30,
    SUM(CASE WHEN (CURRENT_DATE - le.due_date) >= 31 AND (CURRENT_DATE - le.due_date) <= 60 THEN le.remaining_amount ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN (CURRENT_DATE - le.due_date) >= 61 AND (CURRENT_DATE - le.due_date) <= 90 THEN le.remaining_amount ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN (CURRENT_DATE - le.due_date) > 90 THEN le.remaining_amount ELSE 0 END) AS bucket_90_plus,
    SUM(le.remaining_amount) AS total_due
FROM customers c
JOIN ledger_entries le ON le.customer_id = c.id
WHERE le.type = 'Charge'
  AND le.remaining_amount > 0
  AND le.due_date <= CURRENT_DATE
GROUP BY c.id, c.tenant_id, c.name
HAVING SUM(le.remaining_amount) > 0;

-- Drop and recreate view_fines_export with tenant_id
DROP VIEW IF EXISTS "public"."view_fines_export";
CREATE OR REPLACE VIEW "public"."view_fines_export" AS
SELECT
    f.id AS fine_id,
    f.tenant_id,
    f.amount,
    CASE WHEN f.appealed_at IS NOT NULL THEN 'Appealed' ELSE 'Not Appealed' END AS appeal_status,
    c.email AS customer_email,
    c.name AS customer_name,
    c.phone AS customer_phone,
    c.id AS customer_id,
    f.due_date,
    f.issue_date,
    f.liability,
    f.notes,
    f.reference_no,
    COALESCE(f.amount - COALESCE((
        SELECT SUM(ap.amount)
        FROM authority_payments ap
        WHERE ap.fine_id = f.id
    ), 0), f.amount) AS remaining_amount,
    f.status,
    f.type,
    v.id AS vehicle_id,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    v.reg AS vehicle_reg
FROM fines f
LEFT JOIN customers c ON f.customer_id = c.id
LEFT JOIN vehicles v ON f.vehicle_id = v.id;

-- Drop and recreate view_payments_export with tenant_id
DROP VIEW IF EXISTS "public"."view_payments_export";
CREATE OR REPLACE VIEW "public"."view_payments_export" AS
SELECT
    p.id AS payment_id,
    p.tenant_id,
    p.payment_date,
    p.customer_id,
    c.name AS customer_name,
    c.email AS customer_email,
    c.phone AS customer_phone,
    p.rental_id,
    p.vehicle_id,
    v.reg AS vehicle_reg,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    p.payment_type,
    p.method,
    p.amount,
    COALESCE(pa_summary.applied_amount, 0) AS applied_amount,
    p.amount - COALESCE(pa_summary.applied_amount, 0) AS unapplied_amount,
    COALESCE(pa_summary.allocations_json, '[]'::jsonb) AS allocations_json
FROM payments p
LEFT JOIN customers c ON c.id = p.customer_id
LEFT JOIN vehicles v ON v.id = p.vehicle_id
LEFT JOIN (
    SELECT
        pa.payment_id,
        SUM(pa.amount_applied) AS applied_amount,
        jsonb_agg(jsonb_build_object(
            'charge_id', le.id,
            'charge_due_date', le.due_date,
            'amount_applied', pa.amount_applied
        )) AS allocations_json
    FROM payment_applications pa
    JOIN ledger_entries le ON le.id = pa.charge_entry_id
    GROUP BY pa.payment_id
) pa_summary ON pa_summary.payment_id = p.id;

-- Drop and recreate view_rentals_export with tenant_id
DROP VIEW IF EXISTS "public"."view_rentals_export";
CREATE OR REPLACE VIEW "public"."view_rentals_export" AS
SELECT
    r.id AS rental_id,
    r.tenant_id,
    r.customer_id,
    r.vehicle_id,
    COALESCE((
        SELECT SUM(CASE WHEN le.type = 'charge' THEN le.remaining_amount ELSE 0 END)
        FROM ledger_entries le
        WHERE le.rental_id = r.id
    ), 0) AS balance,
    c.name AS customer_name,
    r.end_date,
    COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        WHERE le.rental_id = r.id AND le.category = 'initial_fee'
    ), 0) AS initial_fee_amount,
    r.monthly_amount,
    r.schedule,
    r.start_date,
    r.status,
    v.reg AS vehicle_reg
FROM rentals r
LEFT JOIN customers c ON r.customer_id = c.id
LEFT JOIN vehicles v ON r.vehicle_id = v.id;

-- Drop and recreate view_pl_consolidated with tenant_id
-- This view aggregates P&L data from pnl_entries table
DROP VIEW IF EXISTS "public"."view_pl_consolidated";
CREATE OR REPLACE VIEW "public"."view_pl_consolidated" AS
SELECT
    pe.tenant_id,
    'Total'::text AS view_type,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Rental' THEN pe.amount ELSE 0 END), 0) AS revenue_rental,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'InitialFees' THEN pe.amount ELSE 0 END), 0) AS revenue_fees,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category NOT IN ('Rental', 'InitialFees') THEN pe.amount ELSE 0 END), 0) AS revenue_other,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Acquisition' THEN pe.amount ELSE 0 END), 0) AS cost_acquisition,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Service' THEN pe.amount ELSE 0 END), 0) AS cost_service,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Finance' THEN pe.amount ELSE 0 END), 0) AS cost_finance,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Fines' THEN pe.amount ELSE 0 END), 0) AS cost_fines,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category NOT IN ('Acquisition', 'Service', 'Finance', 'Fines') THEN pe.amount ELSE 0 END), 0) AS cost_other,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount ELSE 0 END), 0) AS total_revenue,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount ELSE 0 END), 0) AS total_costs,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount ELSE 0 END), 0) AS net_profit
FROM pnl_entries pe
GROUP BY pe.tenant_id;
