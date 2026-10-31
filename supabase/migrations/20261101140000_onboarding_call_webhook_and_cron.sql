-- APPLIED to production 2026-11-01.
-- Onboarding call, part 2: bookings arrive from LeadConnector on their own,
-- and the 24h reminder runs hourly.
--
--   - call_scheduled_for: when the call actually is (from the calendar);
--   - call_booked_via also allows 'calendar' (set by onboarding-call-booked);
--   - onboarding_call_events: every webhook LeadConnector sends, matched to a
--     tenant or not, so Brian can see a booking we could not place;
--   - the webhook's key lives in private.platform_config, never in a file;
--   - pg_cron: onboarding-call-reminder every hour at :15, same
--     x-platform-secret scheme as the other platform jobs.

BEGIN;

ALTER TABLE public.tenant_onboarding_calls ADD COLUMN IF NOT EXISTS call_scheduled_for timestamptz;

ALTER TABLE public.tenant_onboarding_calls DROP CONSTRAINT IF EXISTS tenant_onboarding_calls_call_booked_via_check;
ALTER TABLE public.tenant_onboarding_calls
  ADD CONSTRAINT tenant_onboarding_calls_call_booked_via_check
  CHECK (call_booked_via IN ('portal', 'admin', 'calendar'));

CREATE TABLE IF NOT EXISTS public.onboarding_call_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at  timestamptz NOT NULL DEFAULT now(),
  email        text,
  name         text,
  status       text,
  starts_at    timestamptz,
  tenant_id    uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  outcome      text NOT NULL,
  payload      jsonb
);
CREATE INDEX IF NOT EXISTS onboarding_call_events_received_idx ON public.onboarding_call_events (received_at DESC);

ALTER TABLE public.onboarding_call_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admin reads onboarding call events" ON public.onboarding_call_events;
CREATE POLICY "super admin reads onboarding call events" ON public.onboarding_call_events
  FOR SELECT TO authenticated USING (public.is_super_admin());
REVOKE ALL ON public.onboarding_call_events FROM anon;
GRANT SELECT ON public.onboarding_call_events TO authenticated;
GRANT ALL ON public.onboarding_call_events TO service_role;

-- The webhook's shared key: generated once, read only through this function.
INSERT INTO private.platform_config (key, value)
SELECT 'onboarding_call_webhook_key', encode(extensions.gen_random_bytes(24), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM private.platform_config WHERE key = 'onboarding_call_webhook_key');

CREATE OR REPLACE FUNCTION public.verify_onboarding_call_webhook_key(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT p_key IS NOT NULL AND length(p_key) >= 32 AND EXISTS (
    SELECT 1 FROM private.platform_config WHERE key = 'onboarding_call_webhook_key' AND value = p_key
  )
$$;
REVOKE ALL ON FUNCTION public.verify_onboarding_call_webhook_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_onboarding_call_webhook_key(text) TO service_role;

-- The portal card also shows when the call is.
CREATE OR REPLACE FUNCTION public.get_my_onboarding_call()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_row    tenant_onboarding_calls%ROWTYPE;
BEGIN
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM tenant_onboarding_calls WHERE tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'eligible',           public.onboarding_call_eligible(v_tenant),
    'call_booked_at',     v_row.call_booked_at,
    'call_scheduled_for', v_row.call_scheduled_for,
    'call_completed_at',  v_row.call_completed_at,
    'site_previewed_at',  v_row.site_previewed_at,
    'dismissed_at',       v_row.dismissed_at,
    'vehicle_count',      (SELECT count(*) FROM vehicles WHERE tenant_id = v_tenant),
    'has_logo',           (SELECT nullif(trim(logo_url), '') IS NOT NULL FROM tenants WHERE id = v_tenant)
  );
END $$;

-- 'unbooked' also forgets the calendar time.
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
    call_booked_at     = CASE p_step WHEN 'booked' THEN coalesce(call_booked_at, now())
                                     WHEN 'unbooked' THEN NULL ELSE call_booked_at END,
    call_booked_via    = CASE p_step WHEN 'booked' THEN coalesce(call_booked_via, 'portal')
                                     WHEN 'unbooked' THEN NULL ELSE call_booked_via END,
    call_scheduled_for = CASE WHEN p_step = 'unbooked' THEN NULL ELSE call_scheduled_for END,
    site_previewed_at  = CASE WHEN p_step = 'site_previewed' THEN coalesce(site_previewed_at, now()) ELSE site_previewed_at END,
    dismissed_at       = CASE WHEN p_step = 'dismissed' THEN coalesce(dismissed_at, now()) ELSE dismissed_at END
  WHERE tenant_id = v_tenant;
END $$;

-- Return type changes (call_scheduled_for), so drop and recreate.
DROP FUNCTION IF EXISTS public.admin_onboarding_calls();
CREATE FUNCTION public.admin_onboarding_calls()
RETURNS TABLE (
  tenant_id uuid, slug text, company_name text, contact_email text, tenant_created_at timestamptz,
  subscription_status text, trial_end timestamptz,
  call_booked_at timestamptz, call_booked_via text, call_scheduled_for timestamptz, call_completed_at timestamptz,
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
         c.call_booked_at, c.call_booked_via, c.call_scheduled_for, c.call_completed_at,
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

-- Hourly 24h reminder. The function itself decides who is due and sends each
-- tenant one email at most, so an extra run is harmless.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'onboarding-call-reminder';
SELECT cron.schedule(
  'onboarding-call-reminder',
  '15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/onboarding-call-reminder',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-platform-secret',
                 (SELECT value FROM private.platform_config WHERE key = 'platform_notify_secret')),
    body := '{}'::jsonb);
  $cron$
);

COMMIT;
