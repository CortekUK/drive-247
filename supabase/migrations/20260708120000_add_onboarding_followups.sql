-- Follow-up contact log for tenant onboarding (used by the admin Onboarding tab
-- follow-up sheet: George records every outreach so the suggested message adapts).
CREATE TABLE IF NOT EXISTS public.onboarding_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp', 'sms', 'call', 'other')),
  message TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_followups_tenant
  ON public.onboarding_followups (tenant_id, contacted_at DESC);

ALTER TABLE public.onboarding_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_manage_onboarding_followups"
  ON public.onboarding_followups FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "super_admins_manage_onboarding_followups"
  ON public.onboarding_followups FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());
