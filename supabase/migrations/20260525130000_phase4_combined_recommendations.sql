-- Revenue Optimiser Phase 4 — Lead Hub integration.
-- A "combined" recommendation is a price-drop on an idle vehicle that we've
-- matched against active leads. The portal renders these as a special card
-- and the operator can apply price + send offers in one shot.
ALTER TABLE public.pricing_recommendations
  ADD COLUMN IF NOT EXISTS is_combined BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS matched_lead_ids UUID[];

-- New status that records "apply went through AND we sent offers to the leads"
-- Existing applied path stays untouched; this is purely additive.
ALTER TABLE public.pricing_recommendations
  DROP CONSTRAINT IF EXISTS pricing_recommendations_status_check;

ALTER TABLE public.pricing_recommendations
  ADD CONSTRAINT pricing_recommendations_status_check
  CHECK (status IN (
    'pending', 'applied', 'dismissed', 'snoozed', 'expired',
    'reverted', 'superseded', 'pending_approval', 'suppressed_by_admin',
    'applied_with_offers'
  ));

CREATE INDEX IF NOT EXISTS idx_pricing_recs_combined
  ON public.pricing_recommendations(tenant_id, status)
  WHERE is_combined = true;
