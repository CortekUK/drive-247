-- ============================================================================
-- First-run wizard: one row per tenant, written once.
--
-- Step 5 of the new signup flow (landing → account → pay → go to portal →
-- WIZARD → dashboard). The portal asks a newly signed-up operator a handful of
-- questions the first time they land on {slug}.portal.drive-247.com, then never
-- again. The existence of a row here IS the "seen it" flag.
--
-- WHY NOT `tenants.setup_completed_at`
-- ------------------------------------
-- That column already exists and already means something else: the Setup Hub /
-- go-live concept (`use-setup-status.ts`, `setup-hub.tsx`, `go-live-banner.tsx`)
-- sets it when Stripe Connect is active AND Bonzah is configured. It is read by
-- the trial countdown, the "You're Live!" banner, the 30s setup poll and the
-- admin onboarding digest. Reusing it would be wrong in both directions:
--   - the wizard would appear or vanish based on integration state rather than
--     on whether it had been answered, and
--   - finishing the wizard would stamp a column that tells the admin onboarding
--     tab and the go-live banner this tenant is LIVE, which it is not.
-- Two different facts, so two different places. They are not duplicates.
--
-- WHY A TABLE, NOT A jsonb COLUMN ON `tenants`
-- --------------------------------------------
--   - `tenants` already carries 269 columns, 73 of them boolean, many orphaned.
--   - `anon` holds COLUMN-level SELECT grants on `tenants`, not a table grant
--     (20260723090000_lock_down_tenants_rls.sql). A new column without its own
--     GRANT makes Postgres refuse the WHOLE row for any select that names it —
--     which is how every tenant's login page loses its branding at once.
--     TenantContext has a three-rung fallback ladder specifically because that
--     has already happened in production.
--   - A separate table is read only under an authenticated session, so it can
--     never reach that path, and it carries the answers and the flag together.
--
-- Answers live in ONE jsonb column keyed by question id, deliberately: the
-- question list is `apps/portal/src/lib/first-run-questions.ts` and is meant to
-- be swapped without a schema change. `question_set_version` records which list
-- a row was answering, so old answers stay interpretable after a swap.
--
-- ADDITIVE ONLY. Creates one table; touches nothing that exists.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_first_run (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One row per tenant, ever. The UNIQUE constraint is what makes the client's
  -- upsert idempotent, so a double-submit or a retry cannot create a second row.
  tenant_id             UUID        NOT NULL UNIQUE
                                    REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- { [question id]: string | string[] }. Empty when the operator skipped.
  answers               JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- Which version of FIRST_RUN_QUESTIONS these answers were given against.
  question_set_version  INTEGER     NOT NULL DEFAULT 1,

  -- TRUE when the operator chose "Skip for now" rather than answering. The row
  -- still exists, so the wizard still never returns — we simply know the
  -- answers are absent by choice rather than missing by accident.
  was_skipped           BOOLEAN     NOT NULL DEFAULT false,

  -- The staff account that went through it. SET NULL rather than CASCADE: the
  -- fact that onboarding happened must survive that person leaving.
  completed_by          UUID        REFERENCES public.app_users(id) ON DELETE SET NULL,

  completed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A jsonb column accepts scalars and arrays too; the readers all assume an
  -- object keyed by question id.
  CONSTRAINT tenant_first_run_answers_is_object
    CHECK (jsonb_typeof(answers) = 'object'),

  -- A skipped run carries no answers, and an answered one is not a skip.
  CONSTRAINT tenant_first_run_skip_has_no_answers
    CHECK (was_skipped = false OR answers = '{}'::jsonb),

  CONSTRAINT tenant_first_run_question_set_version_positive
    CHECK (question_set_version >= 1)
);

COMMENT ON TABLE public.tenant_first_run IS
  'First-run onboarding wizard, one row per tenant. The row existing is the "already seen" flag; answers are keyed by question id from apps/portal/src/lib/first-run-questions.ts. Distinct from tenants.setup_completed_at, which tracks Stripe/Bonzah go-live readiness.';

ALTER TABLE public.tenant_first_run ENABLE ROW LEVEL SECURITY;

-- Tenant staff read and write their OWN row; super admins see everything.
-- Same `get_user_tenant_id() OR is_super_admin()` shape every other
-- tenant-scoped table in this schema uses.
DROP POLICY IF EXISTS "Tenant users can view their own first-run row" ON public.tenant_first_run;
CREATE POLICY "Tenant users can view their own first-run row"
  ON public.tenant_first_run FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can insert their own first-run row" ON public.tenant_first_run;
CREATE POLICY "Tenant users can insert their own first-run row"
  ON public.tenant_first_run FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can update their own first-run row" ON public.tenant_first_run;
CREATE POLICY "Tenant users can update their own first-run row"
  ON public.tenant_first_run FOR UPDATE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Deleting a row re-arms the wizard for that tenant. Two policies:
--
--   - super admins, for support — the switch for "put northwind back to a
--     fresh signup";
--   - the tenant's OWN head admin, so the local-only /dev page's "Start as a
--     first-time operator" action works from the head_admin session it is
--     actually used from. Without this a tenant-role DELETE is a silent no-op
--     under RLS — PostgREST answers success with zero rows — which is exactly
--     the failure that page exists to make impossible. Scoped to the caller's
--     own tenant through get_user_tenant_id() and to the head_admin role
--     through has_role(), the same STABLE SECURITY DEFINER helpers the rest of
--     this schema's policies lean on.
--
-- Lesser roles (admin, manager, ops, viewer) still cannot clear the record:
-- the wizard is a one-time surface and re-arming it is an owner's decision.
DROP POLICY IF EXISTS "Super admins can delete a first-run row" ON public.tenant_first_run;
CREATE POLICY "Super admins can delete a first-run row"
  ON public.tenant_first_run FOR DELETE
  USING (is_super_admin());

DROP POLICY IF EXISTS "Head admins can delete their own tenant's first-run row" ON public.tenant_first_run;
CREATE POLICY "Head admins can delete their own tenant's first-run row"
  ON public.tenant_first_run FOR DELETE
  USING (tenant_id = get_user_tenant_id() AND has_role(auth.uid(), 'head_admin'));

-- Explicit, matching the RLS above. Supabase's default privileges usually cover
-- this, but a table whose absence silently blocks the dashboard's first paint
-- should not depend on a default.
GRANT SELECT, INSERT, UPDATE ON public.tenant_first_run TO authenticated;
GRANT DELETE ON public.tenant_first_run TO authenticated;

DROP TRIGGER IF EXISTS set_tenant_first_run_updated_at ON public.tenant_first_run;
CREATE TRIGGER set_tenant_first_run_updated_at
  BEFORE UPDATE ON public.tenant_first_run
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- tenant_id already has a unique index from the constraint above, which serves
-- the only query this table has ("has THIS tenant been through it?"), so no
-- further index is added.
