-- Signup: "How many cars do you rent out?", the card step's one-time 20% offer,
-- and "Email me a link to finish later". Idempotent: safe to run twice.
--
--   signup_attribution.fleet_size          the answer ("1-5" | "6-20" | "21+")
--   signup_attribution.exit_offer_seen_at  when "Not ready just yet?" was shown
--   tenants.fleet_size                     the answer, copied by signup-provision
--   signup_finish_later_tokens             the emailed link's token, HASHED
--   admin_onboarding_calls()               + fleet_size, exit_offer_seen_at
--
-- Apply BEFORE deploying signup-begin / signup-attribution / signup-provision /
-- signup-finish-later. Those writes carry on without the new columns, but the
-- answers are only kept once these exist, and signup-finish-later needs the
-- token table to send anything.

BEGIN;

-- ---------------------------------------------------------------------------
-- The answers
-- ---------------------------------------------------------------------------
ALTER TABLE public.signup_attribution
  ADD COLUMN IF NOT EXISTS fleet_size text,
  ADD COLUMN IF NOT EXISTS exit_offer_seen_at timestamptz;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS fleet_size text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signup_attribution_fleet_size_check'
  ) THEN
    ALTER TABLE public.signup_attribution
      ADD CONSTRAINT signup_attribution_fleet_size_check
      CHECK (fleet_size IS NULL OR fleet_size IN ('1-5', '6-20', '21+'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_fleet_size_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_fleet_size_check
      CHECK (fleet_size IS NULL OR fleet_size IN ('1-5', '6-20', '21+'));
  END IF;
END $$;

COMMENT ON COLUMN public.signup_attribution.fleet_size IS
  'Signup answer to "How many cars do you rent out?": 1-5 | 6-20 | 21+. Picks the plan (Starter / Growth / Scale).';
COMMENT ON COLUMN public.signup_attribution.exit_offer_seen_at IS
  'When the card step''s one-time "Not ready just yet?" 20% offer was first shown to this signup.';
COMMENT ON COLUMN public.tenants.fleet_size IS
  'Self-serve signup answer to "How many cars do you rent out?": 1-5 | 6-20 | 21+. Set by signup-provision.';

-- ---------------------------------------------------------------------------
-- "Email me a link to finish later"
--
-- Only the SHA-256 of the token is stored; the token itself exists only in the
-- email. A row signs in exactly one account (auth_user_id), until expires_at,
-- and never once that account's portal is built (checked by the function).
-- Service role only: RLS on, no policies, no grants to the API roles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_finish_later_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email         text NOT NULL,
  promo_code    text,
  expires_at    timestamptz NOT NULL,
  used_count    integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_finish_later_tokens_user
  ON public.signup_finish_later_tokens (auth_user_id, created_at DESC);

ALTER TABLE public.signup_finish_later_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.signup_finish_later_tokens FROM anon, authenticated;
GRANT ALL ON public.signup_finish_later_tokens TO service_role;

COMMENT ON TABLE public.signup_finish_later_tokens IS
  'Signup "Email me a link to finish later": SHA-256 of each emailed token, 7-day expiry. Written and read only by the signup-finish-later edge function (service role).';

-- ---------------------------------------------------------------------------
-- Bryan's Onboarding calls tab: the same output as 20261119120000, plus the
-- fleet size and whether the 20% offer was shown. New columns go at the end.
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
  fleet_size text, exit_offer_seen_at timestamptz
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
         sa.exit_offer_seen_at
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
   WHERE public.onboarding_call_eligible(t.id) OR c.tenant_id IS NOT NULL
   ORDER BY t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_onboarding_calls() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_calls() TO authenticated;

COMMIT;
