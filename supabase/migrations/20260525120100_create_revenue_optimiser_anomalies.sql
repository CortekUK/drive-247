-- Revenue Optimiser Phase 3 — anomaly inbox.
-- The 6-hourly anomaly cron writes here. Super-admins read the global feed;
-- tenant admins see their own rows (so they understand when autopilot paused).
CREATE TABLE IF NOT EXISTS public.revenue_optimiser_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  recommendation_id UUID REFERENCES public.pricing_recommendations(id) ON DELETE SET NULL,

  /** Anomaly taxonomy — keep tight. Add new types via a follow-up migration. */
  anomaly_type TEXT NOT NULL
    CHECK (anomaly_type IN (
      'large_swing',              -- single rec > 25% delta from current
      'utilisation_drop',         -- fleet utilisation dropped > X% after applies
      'apply_then_revert',        -- operator reverted within 24h (distrust signal)
      'autopilot_paused_fleet',   -- circuit-breaker pause event
      'autopilot_paused_vehicle'  -- 2 negative outcomes in a row
    )),
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),

  /** Human-readable headline + the numeric evidence behind the trigger */
  summary TEXT NOT NULL,
  details JSONB,

  /** Lifecycle: open → acknowledged → resolved.
      Super-admin can acknowledge to silence the inbox without resolving. */
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES public.app_users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.app_users(id),
  resolution_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ro_anomalies_tenant_status
  ON public.revenue_optimiser_anomalies(tenant_id, status, created_at DESC);

CREATE INDEX idx_ro_anomalies_global_status
  ON public.revenue_optimiser_anomalies(status, created_at DESC);

CREATE INDEX idx_ro_anomalies_type
  ON public.revenue_optimiser_anomalies(anomaly_type, created_at DESC);

CREATE TRIGGER set_ro_anomalies_updated_at
  BEFORE UPDATE ON public.revenue_optimiser_anomalies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.revenue_optimiser_anomalies ENABLE ROW LEVEL SECURITY;

-- Tenant admins can see their own anomalies (so they know why autopilot paused)
CREATE POLICY "tenant_admin_read_anomalies" ON public.revenue_optimiser_anomalies
  FOR SELECT USING (
    tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

-- Only super-admins (or service_role) can update — to acknowledge / resolve
CREATE POLICY "super_admin_update_anomalies" ON public.revenue_optimiser_anomalies
  FOR UPDATE USING (public.is_super_admin());

CREATE POLICY "service_role_full_access_anomalies" ON public.revenue_optimiser_anomalies
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.revenue_optimiser_anomalies IS 'Anomaly inbox populated by revenue-optimiser-anomaly-check cron. Spec §13.';
