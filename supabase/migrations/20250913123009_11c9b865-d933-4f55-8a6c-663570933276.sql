-- Update P&L views to correctly map InitialFees category to revenue_fees
-- Drop views in dependency order
DROP VIEW IF EXISTS public.view_pl_consolidated CASCADE;
DROP VIEW IF EXISTS public.view_pl_by_vehicle CASCADE;

-- Recreate view_pl_by_vehicle with correct InitialFees mapping
CREATE VIEW public.view_pl_by_vehicle AS 
SELECT 
    v.id AS vehicle_id,
    v.reg AS vehicle_reg,
    CONCAT(v.make, ' ', v.model) AS make_model,
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
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount ELSE 0 END), 0) AS net_profit
FROM public.vehicles v
LEFT JOIN public.pnl_entries pe ON pe.vehicle_id = v.id
GROUP BY v.id, v.reg, v.make, v.model;

-- Recreate view_pl_consolidated with correct InitialFees mapping
CREATE VIEW public.view_pl_consolidated AS 
SELECT 
    'Total' AS view_type,
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
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount ELSE 0 END), 0) AS net_profit
FROM public.pnl_entries pe;