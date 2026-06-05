-- Revenue Optimiser — observations table (Spec §6 Journey A, Phase 1).
--
-- Insights mode writes short observations daily (e.g. "5 idle vehicles for >7d",
-- "3 vehicles at 90%+ utilisation last week"). These are the "build trust" data
-- points the operator sees BEFORE recommendations are surfaced.
--
-- Per-vehicle granularity OR fleet-level (vehicle_id nullable for fleet observations).
-- Unique constraint on (tenant_id, observation_type, observation_date, vehicle_id)
-- so the daily cron is idempotent (re-running the same day overwrites nothing).
CREATE TABLE IF NOT EXISTS public.revenue_optimiser_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE,

  observation_type TEXT NOT NULL
    CHECK (observation_type IN (
      'high_utilization',       -- vehicle util 30d > fleet avg + 10pp
      'low_utilization',        -- vehicle util 30d < fleet avg - 10pp
      'idle_streak',            -- idle >= 7 days
      'enquiry_hotspot',        -- active_enquiries_14d >= 3
      'fleet_supply_high',      -- >75% of category vehicles available
      'fleet_supply_low',       -- <25% of category vehicles available
      'fleet_summary'           -- daily fleet rollup (no vehicle_id)
    )),
  observation_date DATE NOT NULL DEFAULT now()::date,

  label TEXT NOT NULL,          -- short human-readable label
  value JSONB,                  -- raw stats backing the observation

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ro_insights_tenant_recent
  ON public.revenue_optimiser_insights(tenant_id, observation_date DESC, created_at DESC);

CREATE INDEX idx_ro_insights_vehicle
  ON public.revenue_optimiser_insights(vehicle_id, observation_date DESC)
  WHERE vehicle_id IS NOT NULL;

-- Dedup gate — the daily cron can re-run safely without producing dup rows.
-- (vehicle_id is part of the key so the same observation_type can fire on
-- multiple vehicles in the same day, but not the SAME vehicle twice.)
-- Two partial unique indexes — one for per-vehicle rows, one for fleet rows.
CREATE UNIQUE INDEX idx_ro_insights_unique_vehicle
  ON public.revenue_optimiser_insights(tenant_id, observation_type, observation_date, vehicle_id)
  WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX idx_ro_insights_unique_fleet
  ON public.revenue_optimiser_insights(tenant_id, observation_type, observation_date)
  WHERE vehicle_id IS NULL;

ALTER TABLE public.revenue_optimiser_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_staff_read_ro_insights" ON public.revenue_optimiser_insights
  FOR SELECT USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY "service_role_full_access_ro_insights" ON public.revenue_optimiser_insights
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.revenue_optimiser_insights IS 'Daily fleet observations during Insights mode. Spec §6 Journey A.';
