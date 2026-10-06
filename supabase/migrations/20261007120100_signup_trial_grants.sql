-- =============================================================================
-- APPLIED to production 2026-10-07 via the Management API.
-- Free trials for SPECIFIC new signups, chosen by a super admin.
--
-- Apply AFTER 20261007120000_signup_plan_trial_days.sql.
--
-- A super admin types the email a new operator will sign up with and the
-- number of days (admin → Signup Plans → Free trial). When someone signs up
-- with that email, they get that trial on whichever plan they pick — it
-- overrides the plan's own trial. Once their portal is built the grant is
-- marked used (with the company it went to) and cannot be used again.
--
-- APPLYING THIS IS INERT: the table starts empty.
-- =============================================================================

-- Trials may now be set up to 90 days (was 30), on a plan and on a person.
ALTER TABLE public.signup_plans DROP CONSTRAINT IF EXISTS signup_plans_trial_days_range;
ALTER TABLE public.signup_plans
  ADD CONSTRAINT signup_plans_trial_days_range CHECK (trial_days BETWEEN 0 AND 90);

CREATE TABLE IF NOT EXISTS public.signup_trial_grants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lower-cased and trimmed, the way signup compares it.
  email                text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  trial_days           integer NOT NULL CHECK (trial_days BETWEEN 1 AND 90),
  note                 text CHECK (note IS NULL OR length(note) <= 200),
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Set by signup-provision when the portal is built.
  used_at              timestamptz,
  used_tenant_id       uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  used_subscription_id text,
  -- Set when a super admin removes a grant nobody has used yet.
  revoked_at           timestamptz
);

-- One open grant per email: two would leave "which one applies" undefined.
CREATE UNIQUE INDEX IF NOT EXISTS signup_trial_grants_one_open_per_email
  ON public.signup_trial_grants (email)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.signup_trial_grants ENABLE ROW LEVEL SECURITY;

-- Super admins manage them from the admin app; the signup functions use the
-- service role. Nobody else can read who has been offered a trial.
DROP POLICY IF EXISTS "Super admins manage signup trial grants" ON public.signup_trial_grants;
CREATE POLICY "Super admins manage signup trial grants" ON public.signup_trial_grants
  FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

COMMENT ON TABLE public.signup_trial_grants IS
  'Free trials a super admin gives to specific new signups by email. Overrides the plan trial. Marked used when the tenant is provisioned.';

-- -----------------------------------------------------------------------------
-- Verify:
--   SELECT count(*) FROM public.signup_trial_grants;              -- 0
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'signup_plans_trial_days_range';             -- BETWEEN 0 AND 90
-- -----------------------------------------------------------------------------
