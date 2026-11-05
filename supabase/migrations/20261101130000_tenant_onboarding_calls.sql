-- APPLIED to production 2026-11-01.
-- The free 30-minute onboarding call (Nov 2026), Portal V2 only.
--
-- One row per tenant, created the first time anything happens. The portal's
-- dashboard card reads it through get_my_onboarding_call() and writes it only
-- through mark_my_onboarding_call(), so an operator can set exactly three
-- things about themselves (booked / previewed the site / hid the card) and
-- nothing else. Brian's tracker (admin → Customer management → Onboarding
-- calls) reads admin_onboarding_calls() and writes the row directly as a
-- super admin. The 24h reminder (edge function onboarding-call-reminder) uses
-- service_role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_onboarding_calls (
  tenant_id          uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_booked_at     timestamptz,
  call_booked_via    text CHECK (call_booked_via IN ('portal', 'admin')),
  call_completed_at  timestamptz,
  site_previewed_at  timestamptz,
  dismissed_at       timestamptz,
  reminder_sent_at   timestamptz,
  admin_notes        text CHECK (char_length(admin_notes) <= 2000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_onboarding_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant reads own onboarding call" ON public.tenant_onboarding_calls;
CREATE POLICY "tenant reads own onboarding call" ON public.tenant_onboarding_calls
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "super admin manages onboarding calls" ON public.tenant_onboarding_calls;
CREATE POLICY "super admin manages onboarding calls" ON public.tenant_onboarding_calls
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

REVOKE ALL ON public.tenant_onboarding_calls FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_onboarding_calls TO authenticated;
GRANT ALL ON public.tenant_onboarding_calls TO service_role;

CREATE OR REPLACE FUNCTION public.tenant_onboarding_calls_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenant_onboarding_calls_touch ON public.tenant_onboarding_calls;
CREATE TRIGGER trg_tenant_onboarding_calls_touch
  BEFORE UPDATE ON public.tenant_onboarding_calls
  FOR EACH ROW EXECUTE FUNCTION public.tenant_onboarding_calls_touch();

-- Who is offered the call: a V2 tenant in its first 30 days or on a trial,
-- plus the northwind canary so the team can see the card. Older tenants are
-- long past "first dashboard experience" and never see it.
CREATE OR REPLACE FUNCTION public.onboarding_call_eligible(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants t
     WHERE t.id = p_tenant_id
       AND (t.portal_experience = 'v2' OR t.slug = 'northwind')
       AND (
         t.slug = 'northwind'
         OR t.created_at > now() - interval '30 days'
         OR EXISTS (SELECT 1 FROM tenant_subscriptions s
                     WHERE s.tenant_id = t.id AND s.status = 'trialing')
       )
  )
$$;
REVOKE ALL ON FUNCTION public.onboarding_call_eligible(uuid) FROM PUBLIC, anon;

-- The portal card's one read: the row (or nulls) plus what the checklist needs.
CREATE OR REPLACE FUNCTION public.get_my_onboarding_call()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_row    tenant_onboarding_calls%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM tenant_onboarding_calls WHERE tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'eligible',          public.onboarding_call_eligible(v_tenant),
    'call_booked_at',    v_row.call_booked_at,
    'call_completed_at', v_row.call_completed_at,
    'site_previewed_at', v_row.site_previewed_at,
    'dismissed_at',      v_row.dismissed_at,
    'vehicle_count',     (SELECT count(*) FROM vehicles WHERE tenant_id = v_tenant),
    'has_logo',          (SELECT nullif(trim(logo_url), '') IS NOT NULL FROM tenants WHERE id = v_tenant)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_my_onboarding_call() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_onboarding_call() TO authenticated;

-- The portal card's one write. Steps: 'booked', 'site_previewed', 'dismissed',
-- 'unbooked' (the operator said they had booked and had not). Never touches
-- completed, the reminder or Brian's notes.
CREATE OR REPLACE FUNCTION public.mark_my_onboarding_call(p_step text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant' USING ERRCODE = '42501'; END IF;
  IF p_step NOT IN ('booked', 'unbooked', 'site_previewed', 'dismissed') THEN
    RAISE EXCEPTION 'Unknown step %', p_step USING ERRCODE = '22023';
  END IF;

  INSERT INTO tenant_onboarding_calls (tenant_id) VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE tenant_onboarding_calls SET
    call_booked_at    = CASE p_step WHEN 'booked' THEN coalesce(call_booked_at, now())
                                    WHEN 'unbooked' THEN NULL ELSE call_booked_at END,
    call_booked_via   = CASE p_step WHEN 'booked' THEN coalesce(call_booked_via, 'portal')
                                    WHEN 'unbooked' THEN NULL ELSE call_booked_via END,
    site_previewed_at = CASE WHEN p_step = 'site_previewed' THEN coalesce(site_previewed_at, now()) ELSE site_previewed_at END,
    dismissed_at      = CASE WHEN p_step = 'dismissed' THEN coalesce(dismissed_at, now()) ELSE dismissed_at END
  WHERE tenant_id = v_tenant;
END $$;
REVOKE ALL ON FUNCTION public.mark_my_onboarding_call(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_onboarding_call(text) TO authenticated;

-- Brian's tracker: every eligible tenant, with where it stands.
CREATE OR REPLACE FUNCTION public.admin_onboarding_calls()
RETURNS TABLE (
  tenant_id uuid, slug text, company_name text, contact_email text, tenant_created_at timestamptz,
  subscription_status text, trial_end timestamptz,
  call_booked_at timestamptz, call_booked_via text, call_completed_at timestamptz,
  site_previewed_at timestamptz, dismissed_at timestamptz, reminder_sent_at timestamptz,
  admin_notes text, vehicle_count bigint, has_logo boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.slug, t.company_name, t.contact_email, t.created_at,
         s.status::text, s.trial_end,
         c.call_booked_at, c.call_booked_via, c.call_completed_at,
         c.site_previewed_at, c.dismissed_at, c.reminder_sent_at, c.admin_notes,
         (SELECT count(*) FROM vehicles v WHERE v.tenant_id = t.id),
         nullif(trim(t.logo_url), '') IS NOT NULL
    FROM tenants t
    LEFT JOIN tenant_onboarding_calls c ON c.tenant_id = t.id
    LEFT JOIN LATERAL (
      SELECT ts.status, ts.trial_end FROM tenant_subscriptions ts
       WHERE ts.tenant_id = t.id ORDER BY ts.created_at DESC LIMIT 1
    ) s ON true
   WHERE public.onboarding_call_eligible(t.id) OR c.tenant_id IS NOT NULL
   ORDER BY t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_onboarding_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_calls() TO authenticated;

COMMIT;
