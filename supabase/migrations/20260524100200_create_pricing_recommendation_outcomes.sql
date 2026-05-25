-- Revenue Optimiser — measured outcomes (Spec §9.1).
-- Populated 14 days after a recommendation is applied. Proves the lift.
CREATE TABLE IF NOT EXISTS public.pricing_recommendation_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL UNIQUE
    REFERENCES public.pricing_recommendations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,

  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  measurement_window_days INT NOT NULL DEFAULT 14,

  bookings_before INT,
  bookings_after INT,
  revenue_before NUMERIC(12,2),
  revenue_after NUMERIC(12,2),
  utilization_before NUMERIC(5,2),
  utilization_after NUMERIC(5,2),

  net_revenue_delta NUMERIC(10,2),
  outcome TEXT NOT NULL
    CHECK (outcome IN ('positive', 'neutral', 'negative')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_outcomes_tenant
  ON public.pricing_recommendation_outcomes(tenant_id, measured_at DESC);

CREATE INDEX idx_pricing_outcomes_vehicle_outcome
  ON public.pricing_recommendation_outcomes(vehicle_id, outcome, measured_at DESC);

ALTER TABLE public.pricing_recommendation_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_pricing_outcomes" ON public.pricing_recommendation_outcomes
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_pricing_outcomes" ON public.pricing_recommendation_outcomes
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.pricing_recommendation_outcomes IS 'Measured 14 days after a recommendation is applied. Drives the "show the lift" tracker. Spec §9.1.';
