-- Revenue Optimiser — tenant-level opt-in flag.
-- Mirrors the existing `lead_management_enabled` / `automations_enabled` pattern.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS revenue_optimiser_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tenants.revenue_optimiser_enabled IS 'Revenue Optimiser opt-in flag. Set via /revenue welcome screen after backtest.';
