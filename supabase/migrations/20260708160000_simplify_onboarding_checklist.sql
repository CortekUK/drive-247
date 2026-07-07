-- Simplify the onboarding checklist to 3 checkpoints, each auto-detected but
-- manually overridable:
--   1. Branding      — auto when the paywall exists (active subscription plan);
--                      Haseeb finishes branding, then sets up the paywall.
--   2. Subscription  — auto when the tenant pays through the paywall
--                      ($1 card capture → active/trialing subscription).
--   3. Bonzah        — auto when the Bonzah integration is live.
-- The Send-to-Brandon button remains a separate action (not a checkpoint).

DROP VIEW IF EXISTS public.v_tenant_onboarding_status;

ALTER TABLE public.tenant_onboarding_checklist
  DROP COLUMN IF EXISTS credentials_sent,
  DROP COLUMN IF EXISTS credentials_sent_at,
  DROP COLUMN IF EXISTS training_complete,
  DROP COLUMN IF EXISTS training_complete_at,
  ADD COLUMN IF NOT EXISTS branding_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bonzah_override boolean NOT NULL DEFAULT false;

CREATE VIEW public.v_tenant_onboarding_status
WITH (security_invoker = true) AS
SELECT
  t.id AS tenant_id,
  t.slug,
  t.company_name,
  t.contact_email,
  t.admin_name,
  t.created_at,

  EXISTS (
    SELECT 1 FROM public.subscription_plans p
    WHERE p.tenant_id = t.id AND p.is_active
  ) AS branding_auto,
  COALESCE(c.branding_override, false) AS branding_override,
  (EXISTS (
    SELECT 1 FROM public.subscription_plans p
    WHERE p.tenant_id = t.id AND p.is_active
  ) OR COALESCE(c.branding_override, false)) AS branding_done,

  EXISTS (
    SELECT 1 FROM public.tenant_subscriptions s
    WHERE s.tenant_id = t.id AND s.status IN ('active', 'trialing', 'past_due')
  ) AS subscription_auto,
  COALESCE(c.subscription_override, false) AS subscription_override,
  (EXISTS (
    SELECT 1 FROM public.tenant_subscriptions s
    WHERE s.tenant_id = t.id AND s.status IN ('active', 'trialing', 'past_due')
  ) OR COALESCE(c.subscription_override, false)) AS subscription_done,

  (t.bonzah_mode = 'live'
    AND t.bonzah_username IS NOT NULL
    AND COALESCE(t.integration_bonzah, false)) AS bonzah_auto,
  COALESCE(c.bonzah_override, false) AS bonzah_override,
  ((t.bonzah_mode = 'live'
    AND t.bonzah_username IS NOT NULL
    AND COALESCE(t.integration_bonzah, false))
   OR COALESCE(c.bonzah_override, false)) AS bonzah_done,

  EXISTS (
    SELECT 1 FROM public.bonzah_onboarding_submissions b
    WHERE b.tenant_id = t.id
  ) AS bonzah_form_submitted,
  (
    SELECT b.status::text FROM public.bonzah_onboarding_submissions b
    WHERE b.tenant_id = t.id
    ORDER BY b.submitted_at DESC LIMIT 1
  ) AS bonzah_form_status,
  (c.brandon_sent_at IS NOT NULL) AS brandon_sent,
  c.brandon_sent_at,
  COALESCE(c.excluded, false) AS excluded,
  c.notes
FROM public.tenants t
LEFT JOIN public.tenant_onboarding_checklist c ON c.tenant_id = t.id
WHERE t.tenant_type = 'production';

GRANT SELECT ON public.v_tenant_onboarding_status TO authenticated, service_role;
