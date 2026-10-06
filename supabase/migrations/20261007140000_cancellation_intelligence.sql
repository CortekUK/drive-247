-- =============================================================================
-- APPLIED to production 2026-10-07 via the Management API.
-- Cancellation intelligence — why operators leave.
--
-- Read by admin → Customer Management → Cancellations. Reasons come from, in
-- order of trust:
--   1. tenant_churn_reasons   — a super admin recorded it (e.g. after a call)
--   2. go_live_requests       — what the operator picked when they asked to
--                               cancel (integration_type 'subscription_cancellation')
--   3. Stripe                 — the cancellation_details on the subscription:
--                               payment failed / disputed / requested
--   4. inferred               — never finished setup (no Stripe connected)
--
-- Inert on its own: adds nullable columns and an empty table.
-- =============================================================================

-- Stripe's own record of why a subscription ended (subscription.cancellation_details).
--   cancellation_reason   cancellation_requested | payment_failed | payment_disputed
--   cancellation_feedback too_expensive | missing_features | switched_service |
--                         unused | customer_service | too_complex | low_quality | other
--   cancellation_comment  free text, when collected
-- Written by subscription-webhook from now on; backfilled once from Stripe.
ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS cancellation_reason   text,
  ADD COLUMN IF NOT EXISTS cancellation_feedback text,
  ADD COLUMN IF NOT EXISTS cancellation_comment  text;

-- A super admin's own answer for one company. Overrides every other source.
CREATE TABLE IF NOT EXISTS public.tenant_churn_reasons (
  tenant_id  uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  reason     text NOT NULL CHECK (reason IN (
               'too_expensive', 'missing_features', 'switched_tools', 'not_using',
               'closing_business', 'technical_problems', 'never_finished_setup',
               'payment_failed', 'other')),
  note       text CHECK (note IS NULL OR length(note) <= 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_churn_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage churn reasons" ON public.tenant_churn_reasons;
CREATE POLICY "Super admins manage churn reasons" ON public.tenant_churn_reasons
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

COMMENT ON TABLE public.tenant_churn_reasons IS
  'Why a company left, as recorded by a super admin. Overrides the reason inferred from requests and Stripe.';
