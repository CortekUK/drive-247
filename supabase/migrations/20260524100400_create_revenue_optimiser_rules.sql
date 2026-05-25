-- Revenue Optimiser — per-vehicle / per-category bounds for autopilot (Spec §9.1).
-- A rule constrains either a specific vehicle OR a category (mutually exclusive).
CREATE TABLE IF NOT EXISTS public.revenue_optimiser_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE,
  category TEXT,  -- e.g. 'economy', 'suv' — matches vehicles.category

  autopilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  paused_until TIMESTAMPTZ,  -- set by outcome-dependency logic in Phase 3

  min_price_daily NUMERIC(10,2),
  max_price_daily NUMERIC(10,2),
  min_price_weekly NUMERIC(10,2),
  max_price_weekly NUMERIC(10,2),
  min_price_monthly NUMERIC(10,2),
  max_price_monthly NUMERIC(10,2),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Either vehicle OR category, never both / neither
  CONSTRAINT one_scope_only CHECK (
    (vehicle_id IS NOT NULL AND category IS NULL) OR
    (vehicle_id IS NULL AND category IS NOT NULL)
  )
);

CREATE INDEX idx_ro_rules_tenant ON public.revenue_optimiser_rules(tenant_id);
CREATE INDEX idx_ro_rules_vehicle ON public.revenue_optimiser_rules(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_ro_rules_category ON public.revenue_optimiser_rules(tenant_id, category) WHERE category IS NOT NULL;

-- One rule per scope per tenant
CREATE UNIQUE INDEX idx_ro_rules_unique_vehicle
  ON public.revenue_optimiser_rules(tenant_id, vehicle_id)
  WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX idx_ro_rules_unique_category
  ON public.revenue_optimiser_rules(tenant_id, category)
  WHERE category IS NOT NULL;

CREATE TRIGGER set_ro_rules_updated_at
  BEFORE UPDATE ON public.revenue_optimiser_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.revenue_optimiser_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_ro_rules" ON public.revenue_optimiser_rules
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "tenant_admin_write_ro_rules" ON public.revenue_optimiser_rules
  FOR ALL USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'head_admin')
    )
  );

CREATE POLICY "service_role_full_access_ro_rules" ON public.revenue_optimiser_rules
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.revenue_optimiser_rules IS 'Per-vehicle or per-category bounds + autopilot flag. Spec §9.1.';
