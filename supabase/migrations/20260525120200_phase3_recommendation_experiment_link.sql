-- Revenue Optimiser Phase 3 — link recommendations to their pricing experiment.
-- A recommendation that's part of an A/B test rolls into one of two arms; we
-- need to query rec → experiment for the outcome step + UI badge.
ALTER TABLE public.pricing_recommendations
  ADD COLUMN IF NOT EXISTS experiment_id UUID
    REFERENCES public.pricing_experiments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS experiment_arm TEXT
    CHECK (experiment_arm IN ('control', 'test'));

CREATE INDEX IF NOT EXISTS idx_pricing_recs_experiment
  ON public.pricing_recommendations(experiment_id)
  WHERE experiment_id IS NOT NULL;

-- Also: track which `pricing_recommendations` were generated DURING an
-- autopilot run (vs daily generate). Helps the admin per-tenant dashboard
-- show apply-rate "auto vs manual" split.
ALTER TABLE public.pricing_recommendations
  ADD COLUMN IF NOT EXISTS autopilot_run_id UUID;

CREATE INDEX IF NOT EXISTS idx_pricing_recs_autopilot_run
  ON public.pricing_recommendations(autopilot_run_id)
  WHERE autopilot_run_id IS NOT NULL;
