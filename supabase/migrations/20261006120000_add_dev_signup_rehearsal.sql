-- =============================================================================
-- dev_signup_rehearsal — the super-admin Developer page's one row.
--
-- Lets a developer rehearse the REAL self-serve signup (Google / password →
-- payment → provisioning → first run) over and over with one email address,
-- instead of burning a fresh Google account per run.
--
--   email              the ONE address the rehearsal applies to. Every other
--                      signup ignores this table completely.
--   link_to_northwind  true  → signup-provision adopts the existing `northwind`
--                              canary instead of inserting a new tenant.
--                      false → it provisions a brand-new tenant, like a customer.
--   stripe_mode        'test' | 'live' — overrides SIGNUP_STRIPE_MODE for that
--                      one address, locked at the start of each signup.
--   portal_command     a one-shot instruction for the northwind portal tab
--                      ({ id, action, at }) — first-run reset, quick tour.
--   portal_previews    the preview switches that used to live on portal /dev
--                      (empty states, skeletons, messages, billing). The portal
--                      copies them into its own localStorage; they only take
--                      effect under `next dev`.
--
-- Singleton (id = 1). Writes are service-role only, through the
-- `dev-signup-rehearsal` edge function, which checks for a super admin. Reads:
-- super admins, and staff of the northwind tenant (the portal bridge reads
-- portal_command / portal_previews from there).
--
-- Additive only: a new table, nothing existing is touched (V2_PLAN §4).
-- Applied via the Management API — NEVER `supabase db push`.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dev_signup_rehearsal (
  id                smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email             text        NOT NULL DEFAULT 'ilyasghulam35@gmail.com',
  link_to_northwind boolean     NOT NULL DEFAULT true,
  stripe_mode       text        NOT NULL DEFAULT 'test' CHECK (stripe_mode IN ('test', 'live')),
  portal_command    jsonb,
  portal_previews   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_reset_at     timestamptz,
  last_reset_result jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

INSERT INTO public.dev_signup_rehearsal (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dev_signup_rehearsal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dev_signup_rehearsal_read ON public.dev_signup_rehearsal;
CREATE POLICY dev_signup_rehearsal_read ON public.dev_signup_rehearsal
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.app_users au
      JOIN public.tenants t ON t.id = au.tenant_id
      WHERE au.auth_user_id = auth.uid()
        AND t.slug = 'northwind'
    )
  );

REVOKE ALL ON public.dev_signup_rehearsal FROM anon;
GRANT SELECT ON public.dev_signup_rehearsal TO authenticated;
