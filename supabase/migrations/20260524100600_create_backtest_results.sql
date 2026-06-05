-- Revenue Optimiser — backtest output (Spec §9.1).
-- One row per backtest run. UI fetches the latest per tenant.
CREATE TABLE IF NOT EXISTS public.backtest_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  actual_revenue NUMERIC(12,2) NOT NULL,
  projected_revenue NUMERIC(12,2) NOT NULL,
  uplift_percent NUMERIC(5,2) NOT NULL,
  uplift_amount NUMERIC(12,2) NOT NULL,

  vehicles_analysed INT NOT NULL DEFAULT 0,
  bookings_analysed INT NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL
    CHECK (confidence IN ('low', 'medium', 'high')),

  per_vehicle_summary JSONB,   -- array of { vehicle_id, reg, make, model, actual, projected, uplift }
  monthly_breakdown JSONB,      -- array of { month, actual, projected }

  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_backtest_results_tenant_recent
  ON public.backtest_results(tenant_id, generated_at DESC);

ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_backtest" ON public.backtest_results
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_backtest" ON public.backtest_results
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.backtest_results IS 'Output of the on-demand backtest engine. Spec §9.1.';
