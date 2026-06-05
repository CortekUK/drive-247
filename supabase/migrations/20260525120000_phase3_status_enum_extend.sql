-- Revenue Optimiser Phase 3 — extend pricing_recommendations.status with
-- two new states needed for Autopilot:
--   pending_approval      — autopilot would have applied, but the projected
--                           swing exceeded require_approval_above_amount.
--                           Operator must manually apply or dismiss.
--   suppressed_by_admin   — super-admin forced this rec out via the anomaly
--                           inbox. Same effect as 'dismissed' but separately
--                           auditable.
ALTER TABLE public.pricing_recommendations
  DROP CONSTRAINT IF EXISTS pricing_recommendations_status_check;

ALTER TABLE public.pricing_recommendations
  ADD CONSTRAINT pricing_recommendations_status_check
  CHECK (status IN (
    'pending', 'applied', 'dismissed', 'snoozed', 'expired',
    'reverted', 'superseded', 'pending_approval', 'suppressed_by_admin'
  ));

-- Track which super-admin suppressed and why
ALTER TABLE public.pricing_recommendations
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suppressed_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS suppress_reason TEXT;
