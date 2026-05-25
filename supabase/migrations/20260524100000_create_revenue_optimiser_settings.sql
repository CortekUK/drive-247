-- Revenue Optimiser — per-tenant settings (Spec §9.1).
-- One row per tenant. Created lazily when the operator enables Insights Mode.
CREATE TABLE IF NOT EXISTS public.revenue_optimiser_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL DEFAULT 'observation'
    CHECK (mode IN ('observation', 'recommendations', 'autopilot')),
  calibration_complete BOOLEAN NOT NULL DEFAULT FALSE,
  calibration_started_at TIMESTAMPTZ,
  backtest_completed_at TIMESTAMPTZ,
  backtest_projected_lift_percent NUMERIC(5,2),
  backtest_projected_lift_amount NUMERIC(12,2),

  -- safety rails (spec §13)
  max_swing_percent NUMERIC(5,2) NOT NULL DEFAULT 15.0,
  weekend_max_increase_percent NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  cost_floor_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  require_approval_above_amount NUMERIC(10,2),
  auto_pause_on_utilization_drop BOOLEAN NOT NULL DEFAULT TRUE,
  auto_pause_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 20.0,

  -- notifications (spec §8.6)
  notify_daily_summary BOOLEAN NOT NULL DEFAULT TRUE,
  notify_outcome BOOLEAN NOT NULL DEFAULT TRUE,
  notify_anomalies BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_revenue_optimiser_settings_updated_at
  BEFORE UPDATE ON public.revenue_optimiser_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.revenue_optimiser_settings ENABLE ROW LEVEL SECURITY;

-- Tenant staff + super-admins read
CREATE POLICY "tenant_staff_read_ro_settings" ON public.revenue_optimiser_settings
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Tenant admins can update their own settings (per spec §13: editor role required)
CREATE POLICY "tenant_admin_update_ro_settings" ON public.revenue_optimiser_settings
  FOR UPDATE USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'head_admin')
    )
  );

-- service_role full access via edge functions
CREATE POLICY "service_role_full_access_ro_settings" ON public.revenue_optimiser_settings
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.revenue_optimiser_settings IS 'Revenue Optimiser per-tenant settings — mode, safety rails, notifications. Spec §9.1.';
