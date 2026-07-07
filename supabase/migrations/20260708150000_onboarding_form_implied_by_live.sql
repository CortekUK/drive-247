-- Legacy operators went Bonzah-live before the in-platform application form
-- existed, so a live Bonzah integration implies the form/application step is
-- complete even without a bonzah_onboarding_submissions row.

CREATE OR REPLACE VIEW public.v_tenant_onboarding_status
WITH (security_invoker = true) AS
SELECT
  t.id AS tenant_id,
  t.slug,
  t.company_name,
  t.contact_email,
  t.admin_name,
  t.created_at,
  (t.logo_url IS NOT NULL
    OR t.light_primary_color IS NOT NULL
    OR t.primary_color IS NOT NULL) AS branding_done,
  COALESCE(c.credentials_sent, false) AS credentials_sent,
  EXISTS (
    SELECT 1 FROM public.subscription_plans p
    WHERE p.tenant_id = t.id AND p.is_active
  ) AS paywall_set,
  EXISTS (
    SELECT 1 FROM public.tenant_subscriptions s
    WHERE s.tenant_id = t.id AND s.status IN ('active', 'trialing', 'past_due')
  ) AS subscribed,
  (
    EXISTS (
      SELECT 1 FROM public.bonzah_onboarding_submissions b
      WHERE b.tenant_id = t.id
    )
    OR (t.bonzah_mode = 'live'
      AND t.bonzah_username IS NOT NULL
      AND COALESCE(t.integration_bonzah, false))
  ) AS bonzah_form_submitted,
  (
    SELECT b.status::text FROM public.bonzah_onboarding_submissions b
    WHERE b.tenant_id = t.id
    ORDER BY b.submitted_at DESC LIMIT 1
  ) AS bonzah_form_status,
  (c.brandon_sent_at IS NOT NULL) AS brandon_sent,
  c.brandon_sent_at,
  COALESCE(c.training_complete, false) AS training_complete,
  (t.bonzah_mode = 'live'
    AND t.bonzah_username IS NOT NULL
    AND COALESCE(t.integration_bonzah, false)) AS bonzah_live,
  COALESCE(c.excluded, false) AS excluded,
  c.notes
FROM public.tenants t
LEFT JOIN public.tenant_onboarding_checklist c ON c.tenant_id = t.id
WHERE t.tenant_type = 'production';
