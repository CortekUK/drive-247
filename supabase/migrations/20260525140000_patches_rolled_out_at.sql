-- Phase 3 patches — track when an A/B experiment's winner was rolled out to
-- the full category. measure-outcomes sets winner + status='completed'; the
-- next autopilot-run picks up unrolled completed experiments and applies the
-- test price to every eligible vehicle in the category.
ALTER TABLE public.pricing_experiments
  ADD COLUMN IF NOT EXISTS rolled_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rolled_out_vehicle_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_pricing_experiments_pending_rollout
  ON public.pricing_experiments(status, winner, rolled_out_at)
  WHERE status = 'completed' AND winner = 'test' AND rolled_out_at IS NULL;
