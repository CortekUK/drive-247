-- APPLIED to production 2026-11-18.
--
-- How each self-serve signup heard about Drive247, plus the optional phone
-- number from the same step.
--
-- Its own table rather than columns on `tenants`, for two reasons:
--   1. `tenants` is readable through public RLS policies (the booking sites
--      resolve their tenant from the browser), so a phone number cannot go there.
--   2. There is no tenant until the card step is finished, and the answers from
--      people who leave at the card are the ones this exists to keep.
--
-- Service role only: RLS is on with no policies, and the API roles have no grants.

CREATE TABLE IF NOT EXISTS public.signup_attribution (
  auth_user_id      uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email             text NOT NULL,
  heard_about       text,
  heard_about_other text,
  phone             text,
  tenant_id         uuid REFERENCES public.tenants (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_attribution_heard_about
  ON public.signup_attribution (heard_about);
CREATE INDEX IF NOT EXISTS idx_signup_attribution_tenant
  ON public.signup_attribution (tenant_id);

ALTER TABLE public.signup_attribution ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.signup_attribution FROM anon, authenticated;
GRANT ALL ON public.signup_attribution TO service_role;

COMMENT ON TABLE public.signup_attribution IS
  'Self-serve signup answers: how they heard about Drive247 and an optional phone. Service role only.';
