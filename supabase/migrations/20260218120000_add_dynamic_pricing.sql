-- Migration: Add dynamic pricing feature
-- Allows tenants to configure weekend surcharges and holiday surcharges
-- with per-vehicle override/exclusion support. Only applies to daily tier (<7 days).

-- ============================================
-- 1. Add weekend pricing columns to tenants
-- ============================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS weekend_surcharge_percent NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekend_days JSONB DEFAULT '[6, 0]'::jsonb;

COMMENT ON COLUMN public.tenants.weekend_surcharge_percent IS 'Percentage surcharge applied to daily rate on weekend days (0 = disabled)';
COMMENT ON COLUMN public.tenants.weekend_days IS 'JS day numbers for weekend days (0=Sun, 1=Mon, ..., 6=Sat). Default: [6,0] (Sat, Sun)';

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_weekend_surcharge_percent_valid
  CHECK (weekend_surcharge_percent >= 0);

-- ============================================
-- 2. Create tenant_holidays table
-- ============================================
CREATE TABLE IF NOT EXISTS public.tenant_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  surcharge_percent NUMERIC NOT NULL DEFAULT 0,
  excluded_vehicle_ids UUID[] DEFAULT '{}',
  recurs_annually BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tenant_holidays_end_after_start CHECK (end_date >= start_date),
  CONSTRAINT tenant_holidays_surcharge_valid CHECK (surcharge_percent >= 0)
);

COMMENT ON TABLE public.tenant_holidays IS 'Holiday periods with surcharge pricing per tenant';

-- RLS policies
ALTER TABLE public.tenant_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their holidays"
  ON public.tenant_holidays FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

CREATE POLICY "Tenant users can manage their holidays"
  ON public.tenant_holidays FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- Updated_at trigger
CREATE TRIGGER set_tenant_holidays_updated_at
  BEFORE UPDATE ON public.tenant_holidays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for quick lookup by tenant and date range
CREATE INDEX IF NOT EXISTS idx_tenant_holidays_tenant_dates
  ON public.tenant_holidays(tenant_id, start_date, end_date);

-- ============================================
-- 3. Create vehicle_pricing_overrides table
-- ============================================
CREATE TABLE IF NOT EXISTS public.vehicle_pricing_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  holiday_id UUID REFERENCES public.tenant_holidays(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL,
  fixed_price NUMERIC,
  custom_percent NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT vpo_rule_type_valid CHECK (rule_type IN ('weekend', 'holiday')),
  CONSTRAINT vpo_override_type_valid CHECK (override_type IN ('fixed_price', 'custom_percent', 'excluded')),
  CONSTRAINT vpo_holiday_id_for_holiday CHECK (rule_type = 'holiday' OR holiday_id IS NULL),
  CONSTRAINT vpo_fixed_price_required CHECK (override_type != 'fixed_price' OR fixed_price IS NOT NULL),
  CONSTRAINT vpo_custom_percent_required CHECK (override_type != 'custom_percent' OR custom_percent IS NOT NULL),
  UNIQUE (vehicle_id, rule_type, holiday_id)
);

COMMENT ON TABLE public.vehicle_pricing_overrides IS 'Per-vehicle overrides for dynamic pricing rules (weekend/holiday)';

-- RLS policies (join through vehicles to check tenant)
ALTER TABLE public.vehicle_pricing_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their vehicle pricing overrides"
  ON public.vehicle_pricing_overrides FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_pricing_overrides.vehicle_id
      AND (v.tenant_id = get_user_tenant_id() OR is_super_admin())
    )
  );

CREATE POLICY "Tenant users can manage their vehicle pricing overrides"
  ON public.vehicle_pricing_overrides FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_pricing_overrides.vehicle_id
      AND (v.tenant_id = get_user_tenant_id() OR is_super_admin())
    )
  );

-- Updated_at trigger
CREATE TRIGGER set_vehicle_pricing_overrides_updated_at
  BEFORE UPDATE ON public.vehicle_pricing_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for quick lookup by vehicle
CREATE INDEX IF NOT EXISTS idx_vehicle_pricing_overrides_vehicle
  ON public.vehicle_pricing_overrides(vehicle_id);
