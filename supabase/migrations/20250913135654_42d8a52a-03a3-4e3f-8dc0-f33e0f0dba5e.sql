-- 1) Normalize P&L category spellings to 'Initial Fees'
UPDATE public.pnl_entries
SET category = 'Initial Fees'
WHERE lower(replace(category, ' ', '')) IN ('initialfees', 'initialfee');

-- 2) Create unique index for Initial Fees P&L entries (one per payment)
CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_initial_fee_once
ON public.pnl_entries (payment_id)
WHERE category = 'Initial Fees';

-- 3) Update view_pl_by_vehicle to correctly match 'Initial Fees' category
CREATE OR REPLACE VIEW public.view_pl_by_vehicle AS
SELECT 
    v.id as vehicle_id,
    v.reg as vehicle_reg,
    CONCAT(v.make, ' ', v.model) as make_model,
    
    -- Revenue breakdown
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Rental' THEN pe.amount END), 0) as revenue_rental,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Initial Fees' THEN pe.amount END), 0) as revenue_fees,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Other' THEN pe.amount END), 0) as revenue_other,
    
    -- Cost breakdown
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Acquisition' THEN pe.amount END), 0) as cost_acquisition,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Finance' THEN pe.amount END), 0) as cost_finance,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Service' THEN pe.amount END), 0) as cost_service,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Fines' THEN pe.amount END), 0) as cost_fines,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Other' THEN pe.amount END), 0) as cost_other,
    
    -- Totals
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount END), 0) as total_revenue,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount END), 0) as total_costs,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' THEN pe.amount END), 0) - COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount END), 0) as net_profit
    
FROM public.vehicles v
LEFT JOIN public.pnl_entries pe ON pe.vehicle_id = v.id
GROUP BY v.id, v.reg, v.make, v.model;

-- 4) Create vehicle_pnl_rollup view for future date-based filtering
CREATE OR REPLACE VIEW public.vehicle_pnl_rollup AS
SELECT
    v.id as vehicle_id,
    v.make,
    v.model,
    v.reg,
    pe.entry_date::date as entry_date,
    
    -- Revenue
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Rental' THEN pe.amount END), 0) as revenue_rental,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Initial Fees' THEN pe.amount END), 0) as revenue_initial_fees,
    COALESCE(SUM(CASE WHEN pe.side = 'Revenue' AND pe.category = 'Other' THEN pe.amount END), 0) as revenue_other,
    
    -- Costs
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Acquisition' THEN pe.amount END), 0) as cost_acquisition,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Finance' THEN pe.amount END), 0) as cost_finance,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Service' THEN pe.amount END), 0) as cost_service,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Fines' THEN pe.amount END), 0) as cost_fines,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' AND pe.category = 'Other' THEN pe.amount END), 0) as cost_other,
    COALESCE(SUM(CASE WHEN pe.side = 'Cost' THEN pe.amount END), 0) as cost_total
    
FROM public.vehicles v
LEFT JOIN public.pnl_entries pe ON pe.vehicle_id = v.id
GROUP BY v.id, v.make, v.model, v.reg, pe.entry_date::date;