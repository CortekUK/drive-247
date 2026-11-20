-- "City and state" on the signup and on the Book a demo form, plus the rental
-- company name on Book a demo. Idempotent: safe to run twice.
--
-- Asked so the team can look a business up online and find another number to
-- call when the first one does not answer.
--
--   signup_attribution.city_state   signup answer, free text ("Houston, TX")
--   contact_requests.city_state     Book a demo answer (company name already
--                                   has its own column, company_name)
--   admin_onboarding_calls()        + city_state, at the end
--
-- Deliberately NOT on tenants: tenants.address is the business's real address
-- (the booking site shows it), and this is only a hint for the team. The
-- Onboarding calls tab reads it through signup_attribution.tenant_id, which
-- signup-provision sets.
--
-- Apply BEFORE deploying signup-begin / signup-begin-oauth / signup-attribution
-- and before the admin Contacts page goes out. The signup writes carry on
-- without the column (they retry without it), but the answer is only kept
-- once it exists.

BEGIN;

-- ---------------------------------------------------------------------------
-- The answers
-- ---------------------------------------------------------------------------
ALTER TABLE public.signup_attribution
  ADD COLUMN IF NOT EXISTS city_state text;

ALTER TABLE public.contact_requests
  ADD COLUMN IF NOT EXISTS city_state text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signup_attribution_city_state_length'
  ) THEN
    ALTER TABLE public.signup_attribution
      ADD CONSTRAINT signup_attribution_city_state_length
      CHECK (city_state IS NULL OR char_length(city_state) <= 80);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_requests_city_state_length'
  ) THEN
    ALTER TABLE public.contact_requests
      ADD CONSTRAINT contact_requests_city_state_length
      CHECK (city_state IS NULL OR char_length(city_state) <= 120);
  END IF;
END $$;

COMMENT ON COLUMN public.signup_attribution.city_state IS
  'Signup answer "City and state", free text (e.g. Houston, TX). For the team to look the business up; not the tenant''s address.';
COMMENT ON COLUMN public.contact_requests.city_state IS
  'Book a demo answer "City and state", free text (e.g. Houston, TX).';

-- ---------------------------------------------------------------------------
-- Bryan's Onboarding calls tab: the same output as 20261120120000, plus the
-- city and state from the signup. New columns go at the end.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_onboarding_calls();
CREATE FUNCTION public.admin_onboarding_calls()
RETURNS TABLE (
  tenant_id uuid, slug text, company_name text, contact_email text, phone text,
  tenant_created_at timestamptz, subscription_status text, trial_end timestamptz,
  call_booked_at timestamptz, call_booked_via text, call_scheduled_for timestamptz,
  call_completed_at timestamptz, call_cancelled_at timestamptz, call_missed_at timestamptz,
  site_previewed_at timestamptz, dismissed_at timestamptz,
  welcome_sent_at timestamptz, reminder_sent_at timestamptz, follow_up_sent_at timestamptz,
  admin_notes text, vehicle_count bigint, has_logo boolean,
  fleet_size text, exit_offer_seen_at timestamptz,
  city_state text
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
         nullif(trim(t.logo_url), '') IS NOT NULL,
         coalesce(t.fleet_size, sa.fleet_size),
         sa.exit_offer_seen_at,
         cs.city_state
    FROM tenants t
    LEFT JOIN tenant_onboarding_calls c ON c.tenant_id = t.id
    LEFT JOIN LATERAL (
      SELECT ts.status, ts.trial_end FROM tenant_subscriptions ts
       WHERE ts.tenant_id = t.id ORDER BY ts.created_at DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT sa1.phone FROM signup_attribution sa1
       WHERE sa1.tenant_id = t.id AND nullif(trim(sa1.phone), '') IS NOT NULL
       ORDER BY sa1.created_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT sa2.fleet_size, sa2.exit_offer_seen_at FROM signup_attribution sa2
       WHERE sa2.tenant_id = t.id
       ORDER BY sa2.created_at DESC LIMIT 1
    ) sa ON true
    LEFT JOIN LATERAL (
      SELECT nullif(trim(sa3.city_state), '') AS city_state FROM signup_attribution sa3
       WHERE sa3.tenant_id = t.id AND nullif(trim(sa3.city_state), '') IS NOT NULL
       ORDER BY sa3.created_at DESC LIMIT 1
    ) cs ON true
   WHERE public.onboarding_call_eligible(t.id) OR c.tenant_id IS NOT NULL
   ORDER BY t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_onboarding_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_calls() TO authenticated;

COMMIT;
