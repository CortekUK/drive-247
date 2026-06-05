-- Revenue Optimiser — per-vehicle price recommendations (Spec §9.1).
-- One row per recommendation generated. Status drives the operator workflow.
CREATE TABLE IF NOT EXISTS public.pricing_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,

  tier TEXT NOT NULL
    CHECK (tier IN ('daily', 'weekly', 'monthly', 'weekend_daily')),

  current_price NUMERIC(10,2) NOT NULL,
  recommended_price NUMERIC(10,2) NOT NULL,
  recommended_range_low NUMERIC(10,2) NOT NULL,
  recommended_range_high NUMERIC(10,2) NOT NULL,

  confidence TEXT NOT NULL
    CHECK (confidence IN ('low', 'medium', 'high')),
  confidence_score NUMERIC(5,2) NOT NULL,  -- 0–100

  projected_revenue_delta_monthly NUMERIC(10,2),

  -- structured reasoning so UI + outcome attribution both speak the same language
  reasons JSONB NOT NULL,         -- array of {code, label, value, weight}
  data_points JSONB NOT NULL,     -- raw stats snapshot
  elasticity_curve JSONB,         -- price/qty pairs for chart

  -- GPT explanation (math first, AI second — never the price)
  ai_explanation TEXT,
  ai_model TEXT,
  ai_tokens_total INTEGER,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'dismissed', 'snoozed',
                      'expired', 'reverted', 'superseded')),
  applied_at TIMESTAMPTZ,
  applied_by UUID REFERENCES public.app_users(id),
  applied_price NUMERIC(10,2),    -- may differ from recommended (custom)
  applied_source TEXT
    CHECK (applied_source IN ('manual', 'autopilot')),

  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES public.app_users(id),
  dismiss_reason TEXT,
  snoozed_until TIMESTAMPTZ,

  reverted_at TIMESTAMPTZ,
  reverted_by UUID REFERENCES public.app_users(id),
  revert_reason TEXT,

  expires_at TIMESTAMPTZ NOT NULL,  -- recommendations decay; new one supersedes
  generation_run_id UUID,           -- groups recs from same batch

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_recs_tenant_status
  ON public.pricing_recommendations(tenant_id, status, created_at DESC);

CREATE INDEX idx_pricing_recs_vehicle
  ON public.pricing_recommendations(vehicle_id, status);

CREATE INDEX idx_pricing_recs_pending_expiry
  ON public.pricing_recommendations(tenant_id, expires_at)
  WHERE status = 'pending';

CREATE TRIGGER set_pricing_recommendations_updated_at
  BEFORE UPDATE ON public.pricing_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pricing_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_pricing_recs" ON public.pricing_recommendations
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- mutations only through edge functions (service_role)
CREATE POLICY "service_role_full_access_pricing_recs" ON public.pricing_recommendations
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.pricing_recommendations IS 'Per-vehicle price recommendations from the Revenue Optimiser engine. Spec §9.1.';
