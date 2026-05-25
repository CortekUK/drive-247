-- Revenue Optimiser — immutable price-change audit log (Spec §9.1, §13.10).
-- Every change to vehicles.*_rent goes here. Retained 24 months.
-- INSERT-only RLS — NEVER updated or deleted by anyone (including super-admin).
CREATE TABLE IF NOT EXISTS public.pricing_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  tier TEXT NOT NULL
    CHECK (tier IN ('daily', 'weekly', 'monthly', 'weekend_daily')),

  old_price NUMERIC(10,2),
  new_price NUMERIC(10,2) NOT NULL,

  change_source TEXT NOT NULL
    CHECK (change_source IN ('manual', 'ai_recommendation', 'autopilot', 'revert', 'import')),
  recommendation_id UUID REFERENCES public.pricing_recommendations(id),
  changed_by UUID REFERENCES public.app_users(id),
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_change_history_vehicle
  ON public.pricing_change_history(vehicle_id, created_at DESC);

CREATE INDEX idx_pricing_change_history_tenant
  ON public.pricing_change_history(tenant_id, created_at DESC);

ALTER TABLE public.pricing_change_history ENABLE ROW LEVEL SECURITY;

-- Tenant staff + super-admin READ. NO update, NO delete policy exists by design.
CREATE POLICY "tenant_staff_read_pch" ON public.pricing_change_history
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- service_role INSERT only — explicitly enumerate to prevent accidental UPDATE/DELETE policy creep
CREATE POLICY "service_role_insert_pch" ON public.pricing_change_history
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_select_pch" ON public.pricing_change_history
  FOR SELECT USING (auth.role() = 'service_role');

-- Belt-and-suspenders trigger: block any UPDATE/DELETE attempt outright,
-- in case a future migration grants those policies.
CREATE OR REPLACE FUNCTION public.block_pricing_change_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pricing_change_history is append-only; UPDATE/DELETE blocked';
END;
$$;

CREATE TRIGGER block_pch_update
  BEFORE UPDATE ON public.pricing_change_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_pricing_change_history_mutation();

CREATE TRIGGER block_pch_delete
  BEFORE DELETE ON public.pricing_change_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_pricing_change_history_mutation();

COMMENT ON TABLE public.pricing_change_history IS 'Immutable audit log of every vehicle price change. INSERT-only. Spec §9.1, §13.10.';
