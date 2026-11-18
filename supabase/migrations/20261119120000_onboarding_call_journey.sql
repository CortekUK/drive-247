-- Onboarding call, part 3: the full email journey and call outcomes.
--
--   - welcome_sent_at / follow_up_sent_at: the emails either side of the 24h reminder;
--   - call_cancelled_at / call_missed_at: what happened to a booking, kept after the
--     booking is cleared so the customer can book again and Bryan can still see it;
--   - booking_notified_for: the call time Bryan was last emailed about, so a repeated
--     webhook does not email him twice;
--   - admin_onboarding_calls() returns all of that, plus a phone number to call;
--   - pg_cron runs every 5 minutes so the welcome email arrives right after signup.

BEGIN;

ALTER TABLE public.tenant_onboarding_calls
  ADD COLUMN IF NOT EXISTS welcome_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS call_cancelled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS call_missed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS booking_notified_for timestamptz;

-- Return type changes, so drop and recreate.
DROP FUNCTION IF EXISTS public.admin_onboarding_calls();
CREATE FUNCTION public.admin_onboarding_calls()
RETURNS TABLE (
  tenant_id uuid, slug text, company_name text, contact_email text, phone text,
  tenant_created_at timestamptz, subscription_status text, trial_end timestamptz,
  call_booked_at timestamptz, call_booked_via text, call_scheduled_for timestamptz,
  call_completed_at timestamptz, call_cancelled_at timestamptz, call_missed_at timestamptz,
  site_previewed_at timestamptz, dismissed_at timestamptz,
  welcome_sent_at timestamptz, reminder_sent_at timestamptz, follow_up_sent_at timestamptz,
  admin_notes text, vehicle_count bigint, has_logo boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Super admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.slug, t.company_name, t.contact_email,
         coalesce(nullif(trim(t.contact_phone), ''), nullif(trim(t.phone), ''), a.phone),
         t.created_at, s.status::text, s.trial_end,
         c.call_booked_at, c.call_booked_via, c.call_scheduled_for,
         c.call_completed_at, c.call_cancelled_at, c.call_missed_at,
         c.site_previewed_at, c.dismissed_at,
         c.welcome_sent_at, c.reminder_sent_at, c.follow_up_sent_at,
         c.admin_notes,
         (SELECT count(*) FROM vehicles v WHERE v.tenant_id = t.id),
         nullif(trim(t.logo_url), '') IS NOT NULL
    FROM tenants t
    LEFT JOIN tenant_onboarding_calls c ON c.tenant_id = t.id
    LEFT JOIN LATERAL (
      SELECT ts.status, ts.trial_end FROM tenant_subscriptions ts
       WHERE ts.tenant_id = t.id ORDER BY ts.created_at DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT sa.phone FROM signup_attribution sa
       WHERE sa.tenant_id = t.id AND nullif(trim(sa.phone), '') IS NOT NULL
       ORDER BY sa.created_at DESC LIMIT 1
    ) a ON true
   WHERE public.onboarding_call_eligible(t.id) OR c.tenant_id IS NOT NULL
   ORDER BY t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_onboarding_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_calls() TO authenticated;

-- The function decides who is due and sends each email once, so extra runs are harmless.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'onboarding-call-reminder';
SELECT cron.schedule(
  'onboarding-call-reminder',
  '*/5 * * * *',
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
