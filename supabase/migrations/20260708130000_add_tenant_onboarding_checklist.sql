-- Tenant onboarding checklist (super-admin tracked) + daily digest settings
-- Manual items live in tenant_onboarding_checklist; automatic items are
-- computed in v_tenant_onboarding_status from existing tenant/subscription data.

CREATE TABLE IF NOT EXISTS public.tenant_onboarding_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  credentials_sent boolean NOT NULL DEFAULT false,
  credentials_sent_at timestamptz,
  training_complete boolean NOT NULL DEFAULT false,
  training_complete_at timestamptz,
  brandon_sent_at timestamptz,
  excluded boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_tenant_onboarding_checklist_updated_at ON public.tenant_onboarding_checklist;
CREATE TRIGGER set_tenant_onboarding_checklist_updated_at
  BEFORE UPDATE ON public.tenant_onboarding_checklist
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_onboarding_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admins_manage_onboarding_checklist" ON public.tenant_onboarding_checklist;
CREATE POLICY "super_admins_manage_onboarding_checklist"
  ON public.tenant_onboarding_checklist
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "service_role_manage_onboarding_checklist" ON public.tenant_onboarding_checklist;
CREATE POLICY "service_role_manage_onboarding_checklist"
  ON public.tenant_onboarding_checklist
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Digest recipients + Bonzah contact, editable from the admin Onboarding page
ALTER TABLE public.admin_settings
  ADD COLUMN IF NOT EXISTS onboarding_digest_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bonzah_brandon_email text;

UPDATE public.admin_settings
SET onboarding_digest_emails = ARRAY['ilyasghulam35@gmail.com', 'george@drive-247.com']
WHERE onboarding_digest_emails = '{}';

-- One row per production tenant with all 8 checklist items resolved.
-- security_invoker so tenant users only ever see their own row via tenants RLS;
-- super admins and service_role see everything.
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
  COALESCE(c.training_complete, false) AS training_complete,
  (t.bonzah_mode = 'live'
    AND t.bonzah_username IS NOT NULL
    AND COALESCE(t.integration_bonzah, false)) AS bonzah_live,
  COALESCE(c.excluded, false) AS excluded,
  c.notes
FROM public.tenants t
LEFT JOIN public.tenant_onboarding_checklist c ON c.tenant_id = t.id
WHERE t.tenant_type = 'production';

GRANT SELECT ON public.v_tenant_onboarding_status TO authenticated, service_role;
