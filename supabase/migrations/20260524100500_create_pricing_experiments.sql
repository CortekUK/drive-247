-- Revenue Optimiser — Phase 3 A/B tests (Spec §9.1).
-- Schema lands now; the autopilot-run cron populates rows starting Phase 3.
CREATE TABLE IF NOT EXISTS public.pricing_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  tier TEXT NOT NULL
    CHECK (tier IN ('daily', 'weekly', 'monthly', 'weekend_daily')),

  control_price NUMERIC(10,2) NOT NULL,
  test_price NUMERIC(10,2) NOT NULL,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,

  control_bookings INT DEFAULT 0,
  test_bookings INT DEFAULT 0,
  control_revenue NUMERIC(12,2) DEFAULT 0,
  test_revenue NUMERIC(12,2) DEFAULT 0,

  winner TEXT CHECK (winner IN ('control', 'test', 'inconclusive')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'aborted')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_experiments_tenant_status
  ON public.pricing_experiments(tenant_id, status, ends_at);

CREATE INDEX idx_pricing_experiments_running
  ON public.pricing_experiments(ends_at) WHERE status = 'running';

CREATE TRIGGER set_pricing_experiments_updated_at
  BEFORE UPDATE ON public.pricing_experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pricing_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_experiments" ON public.pricing_experiments
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_experiments" ON public.pricing_experiments
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.pricing_experiments IS 'A/B test rows for Phase 3 autopilot. Schema lands now; cron populates later. Spec §9.1.';
