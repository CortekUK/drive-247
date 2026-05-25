-- Revenue Optimiser — add cost_floor + category columns to vehicles.
-- cost_floor: per-tier minimum below which RO will never recommend (Spec §13.3).
-- category:   needed for the elasticity model's category-fallback (Spec §11.2) and
--             Autopilot scope picker (Spec §8.6). The vehicles table previously had
--             no category/class column — only make, model, fuel_type, acquisition_type.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS cost_floor_daily NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cost_floor_weekly NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cost_floor_monthly NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IS NULL OR category IN ('economy', 'sedan', 'suv', 'luxury', 'van', 'electric'));

-- Index category for the category-fallback elasticity query
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_category
  ON public.vehicles(tenant_id, category)
  WHERE category IS NOT NULL;

COMMENT ON COLUMN public.vehicles.cost_floor_daily IS 'Revenue Optimiser: never recommend daily_rent below this value.';
COMMENT ON COLUMN public.vehicles.cost_floor_weekly IS 'Revenue Optimiser: never recommend weekly_rent below this value.';
COMMENT ON COLUMN public.vehicles.cost_floor_monthly IS 'Revenue Optimiser: never recommend monthly_rent below this value.';
COMMENT ON COLUMN public.vehicles.category IS 'Revenue Optimiser: pricing category used for elasticity fallback + autopilot scope.';
