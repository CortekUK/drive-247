-- =============================================================================
-- signup_attempts — support visibility + a real rate-limit ledger for the
-- self-serve inbound onboarding flow (supabase/functions/signup-*).
--
-- OPTIONAL. Every signup function degrades gracefully when this table is
-- absent: _shared/signup-state.ts catches PostgREST's missing-relation error
-- (42P01 / PGRST205) and falls back to public.login_attempts with a
-- "signup:<scope>:<key>" username, then fails OPEN with a single console.warn.
-- A missing table must never produce a user-visible error, so nothing in the
-- code may ever hard-depend on it.
--
-- WHY IT EARNS ITS KEEP
-- ---------------------
--  1. It is the only place a human can answer "who paid and never finished?":
--
--       SELECT a.*
--       FROM   public.signup_attempts a
--       WHERE  a.scope = 'payment_intent' AND a.outcome = 'ok'
--       AND    NOT EXISTS (
--                SELECT 1 FROM public.signup_attempts p
--                WHERE  p.auth_user_id = a.auth_user_id
--                AND    p.scope = 'provision' AND p.outcome = 'ok');
--
--     Those people hold a live subscription and no portal. They can self-serve
--     (returning to drive-247.com resumes them straight into step 3), but
--     someone has to be able to SEE them.
--
--  2. The fallback ledger is bypassable. public.login_attempts has
--     RLS USING (true) and GRANT ALL TO anon, so anyone holding the anon key
--     can delete rows and walk past the throttle. This table is service_role
--     only, which makes the throttle an actual control rather than a speed bump.
--
-- The `outcome` values are load-bearing, not decorative: checkThrottle counts
-- ONLY the gate rows ('allowed' / 'blocked'), so the richer 'ok' / 'error'
-- audit rows written later in the same request never eat into a caller's own
-- rate-limit budget.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.signup_attempts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- 'begin' | 'slug_check' | 'payment_intent' | 'provision'
  scope                  text NOT NULL,
  ip_address             text,
  email                  text,
  -- ON DELETE SET NULL, not CASCADE: if an auth user is ever removed we still
  -- want the record that money was taken against that address.
  auth_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_id                text,
  -- 'allowed' | 'blocked' (gate rows, counted by the throttle)
  -- 'ok'      | 'error'   (outcome rows, for support only)
  outcome                text NOT NULL,
  error_code             text,
  stripe_customer_id     text,
  stripe_subscription_id text,
  tenant_id              uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.signup_attempts IS
  'Self-serve signup ledger: rate-limit counter (outcome allowed/blocked) plus a support audit trail (outcome ok/error). Written only by the signup-* edge functions with the service role.';

-- The throttle always filters (scope, key, created_at) — one index per key kind.
CREATE INDEX IF NOT EXISTS idx_signup_attempts_ip
  ON public.signup_attempts (ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_email
  ON public.signup_attempts (lower(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_auth_user
  ON public.signup_attempts (auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_attempts_created
  ON public.signup_attempts (created_at DESC);

ALTER TABLE public.signup_attempts ENABLE ROW LEVEL SECURITY;

-- The edge functions. This is the only writer.
DROP POLICY IF EXISTS "service_role manages signup attempts" ON public.signup_attempts;
CREATE POLICY "service_role manages signup attempts"
  ON public.signup_attempts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Support. Read-only, and super admins only — these rows carry email addresses
-- and Stripe ids for people who are not yet anyone's tenant, so there is no
-- tenant_id to scope them by.
DROP POLICY IF EXISTS "super admins can read signup attempts" ON public.signup_attempts;
CREATE POLICY "super admins can read signup attempts"
  ON public.signup_attempts FOR SELECT
  USING (is_super_admin());
