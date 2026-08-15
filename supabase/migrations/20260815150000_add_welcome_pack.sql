-- =============================================================================
-- Welcome Pack — schema
--
-- A complete, super-admin-authored onboarding document for rental operators.
-- Read in apps/portal at /welcome, authored in apps/admin, content stored
-- globally (ONE Drive247 pack, not per tenant).
--
--   welcome_pack_settings     singleton: title, intro, first-login behaviour
--   welcome_pack_groups       chapters
--   welcome_pack_sections     pages within a chapter (markdown body)
--   welcome_pack_faqs         Q&A, optionally attached to a chapter
--   welcome_pack_reads        per-user read receipts (one row per section)
--   welcome_pack_completions  per-user "I have read the pack" acknowledgement
--
-- ---------------------------------------------------------------------------
-- SECURITY NOTE — why reads are gated on app_users, not on `authenticated`
-- ---------------------------------------------------------------------------
-- Renters authenticate against the SAME Supabase project as portal staff (the
-- booking app signs customers in via customer_users -> auth.users). They
-- therefore hold the `authenticated` role too.
--
-- A policy of `FOR SELECT TO authenticated USING (true)` — the shape used by
-- the existing global content tables — would expose this entire document,
-- including commercial and referral terms, to every renter holding the public
-- anon key. Every read policy below is gated on the caller existing in
-- app_users via is_portal_user().
-- ---------------------------------------------------------------------------
--
-- `required_flag` names a BOOLEAN column on `tenants`. When set, the item is
-- hidden from operators without that capability, so the pack never explains a
-- feature the tenant does not have. Resolution is client-side and FAILS OPEN:
-- an unresolvable flag shows the content rather than blanking it.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Helper — is the caller a portal (staff) user at all?
--    Mirrors is_super_admin() / is_sales_agent() / is_bonzah_partner().
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_portal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users WHERE auth_user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_portal_user() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. Settings (singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_pack_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_title           text NOT NULL DEFAULT 'Welcome to Drive247',
  doc_subtitle        text,
  intro_md            text,
  -- Show the (dismissible) first-login prompt pointing operators at the pack.
  show_on_first_login boolean NOT NULL DEFAULT true,
  -- Bump after a substantial rewrite to re-prompt everyone. A user whose
  -- completion row carries an older version is prompted again.
  version             integer NOT NULL DEFAULT 1,
  -- Exactly one row, enforced structurally.
  singleton           boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welcome_pack_settings_singleton_chk CHECK (singleton = true),
  CONSTRAINT welcome_pack_settings_singleton_uq UNIQUE (singleton)
);

-- -----------------------------------------------------------------------------
-- 2. Chapters
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_pack_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text,
  -- lucide-react icon name, resolved against an allow-list in the portal so a
  -- typo degrades to a default icon instead of crashing the page.
  icon         text,
  sort_order   integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Sections
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_pack_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.welcome_pack_groups(id) ON DELETE CASCADE,
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  summary       text,
  body_md       text NOT NULL DEFAULT '',
  icon          text,
  -- Boolean column on `tenants` this section requires. NULL = always shown.
  required_flag text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS welcome_pack_sections_group_idx
  ON public.welcome_pack_sections (group_id, sort_order);

-- -----------------------------------------------------------------------------
-- 4. FAQs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_pack_faqs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid REFERENCES public.welcome_pack_groups(id) ON DELETE SET NULL,
  question      text NOT NULL,
  answer_md     text NOT NULL DEFAULT '',
  required_flag text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS welcome_pack_faqs_group_idx
  ON public.welcome_pack_faqs (group_id, sort_order);

-- -----------------------------------------------------------------------------
-- 5. Read receipts + completion
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_pack_reads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  section_id  uuid NOT NULL REFERENCES public.welcome_pack_sections(id) ON DELETE CASCADE,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT welcome_pack_reads_uq UNIQUE (app_user_id, section_id)
);

CREATE INDEX IF NOT EXISTS welcome_pack_reads_user_idx
  ON public.welcome_pack_reads (app_user_id);

CREATE TABLE IF NOT EXISTS public.welcome_pack_completions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id  uuid NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE CASCADE,
  version      integer NOT NULL DEFAULT 1,
  completed_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6. updated_at triggers — existing helper, never moddatetime
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_welcome_pack_settings_updated_at ON public.welcome_pack_settings;
CREATE TRIGGER set_welcome_pack_settings_updated_at
  BEFORE UPDATE ON public.welcome_pack_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_welcome_pack_groups_updated_at ON public.welcome_pack_groups;
CREATE TRIGGER set_welcome_pack_groups_updated_at
  BEFORE UPDATE ON public.welcome_pack_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_welcome_pack_sections_updated_at ON public.welcome_pack_sections;
CREATE TRIGGER set_welcome_pack_sections_updated_at
  BEFORE UPDATE ON public.welcome_pack_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_welcome_pack_faqs_updated_at ON public.welcome_pack_faqs;
CREATE TRIGGER set_welcome_pack_faqs_updated_at
  BEFORE UPDATE ON public.welcome_pack_faqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.welcome_pack_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_pack_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_pack_sections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_pack_faqs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_pack_reads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.welcome_pack_completions ENABLE ROW LEVEL SECURITY;

-- --- settings ---------------------------------------------------------------
DROP POLICY IF EXISTS welcome_pack_settings_read ON public.welcome_pack_settings;
CREATE POLICY welcome_pack_settings_read
  ON public.welcome_pack_settings FOR SELECT TO authenticated
  USING (public.is_portal_user());

DROP POLICY IF EXISTS welcome_pack_settings_admin ON public.welcome_pack_settings;
CREATE POLICY welcome_pack_settings_admin
  ON public.welcome_pack_settings FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_settings_service ON public.welcome_pack_settings;
CREATE POLICY welcome_pack_settings_service
  ON public.welcome_pack_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- --- groups -----------------------------------------------------------------
-- Drafts are visible to super admins only, so content can be staged in the
-- admin app without operators seeing half-written pages.
DROP POLICY IF EXISTS welcome_pack_groups_read ON public.welcome_pack_groups;
CREATE POLICY welcome_pack_groups_read
  ON public.welcome_pack_groups FOR SELECT TO authenticated
  USING ((is_published AND public.is_portal_user()) OR public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_groups_admin ON public.welcome_pack_groups;
CREATE POLICY welcome_pack_groups_admin
  ON public.welcome_pack_groups FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_groups_service ON public.welcome_pack_groups;
CREATE POLICY welcome_pack_groups_service
  ON public.welcome_pack_groups FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- --- sections ---------------------------------------------------------------
DROP POLICY IF EXISTS welcome_pack_sections_read ON public.welcome_pack_sections;
CREATE POLICY welcome_pack_sections_read
  ON public.welcome_pack_sections FOR SELECT TO authenticated
  USING ((is_published AND public.is_portal_user()) OR public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_sections_admin ON public.welcome_pack_sections;
CREATE POLICY welcome_pack_sections_admin
  ON public.welcome_pack_sections FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_sections_service ON public.welcome_pack_sections;
CREATE POLICY welcome_pack_sections_service
  ON public.welcome_pack_sections FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- --- faqs -------------------------------------------------------------------
DROP POLICY IF EXISTS welcome_pack_faqs_read ON public.welcome_pack_faqs;
CREATE POLICY welcome_pack_faqs_read
  ON public.welcome_pack_faqs FOR SELECT TO authenticated
  USING ((is_published AND public.is_portal_user()) OR public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_faqs_admin ON public.welcome_pack_faqs;
CREATE POLICY welcome_pack_faqs_admin
  ON public.welcome_pack_faqs FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_faqs_service ON public.welcome_pack_faqs;
CREATE POLICY welcome_pack_faqs_service
  ON public.welcome_pack_faqs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- --- reads ------------------------------------------------------------------
-- A user reads and writes only their OWN receipts. Super admins read all, so
-- the admin panel can show who has actually been through the pack.
DROP POLICY IF EXISTS welcome_pack_reads_own ON public.welcome_pack_reads;
CREATE POLICY welcome_pack_reads_own
  ON public.welcome_pack_reads FOR ALL TO authenticated
  USING (
    app_user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    app_user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS welcome_pack_reads_admin_read ON public.welcome_pack_reads;
CREATE POLICY welcome_pack_reads_admin_read
  ON public.welcome_pack_reads FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_reads_service ON public.welcome_pack_reads;
CREATE POLICY welcome_pack_reads_service
  ON public.welcome_pack_reads FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- --- completions ------------------------------------------------------------
DROP POLICY IF EXISTS welcome_pack_completions_own ON public.welcome_pack_completions;
CREATE POLICY welcome_pack_completions_own
  ON public.welcome_pack_completions FOR ALL TO authenticated
  USING (
    app_user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    app_user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS welcome_pack_completions_admin_read ON public.welcome_pack_completions;
CREATE POLICY welcome_pack_completions_admin_read
  ON public.welcome_pack_completions FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS welcome_pack_completions_service ON public.welcome_pack_completions;
CREATE POLICY welcome_pack_completions_service
  ON public.welcome_pack_completions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 8. Readership view for the admin panel
--    security_invoker so the policies above decide who sees what.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_welcome_pack_readership
WITH (security_invoker = true) AS
SELECT
  u.id                            AS app_user_id,
  u.email,
  u.name,
  u.role,
  u.tenant_id,
  t.company_name,
  COUNT(r.id)                     AS sections_read,
  MAX(r.seen_at)                  AS last_read_at,
  (c.id IS NOT NULL)              AS completed,
  c.completed_at,
  c.version                       AS completed_version
FROM public.app_users u
LEFT JOIN public.tenants t                  ON t.id = u.tenant_id
LEFT JOIN public.welcome_pack_reads r       ON r.app_user_id = u.id
LEFT JOIN public.welcome_pack_completions c ON c.app_user_id = u.id
WHERE u.tenant_id IS NOT NULL
GROUP BY u.id, u.email, u.name, u.role, u.tenant_id,
         t.company_name, c.id, c.completed_at, c.version;

GRANT SELECT ON public.v_welcome_pack_readership TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. Seed the singleton settings row
-- -----------------------------------------------------------------------------
INSERT INTO public.welcome_pack_settings (doc_title, doc_subtitle, intro_md)
SELECT
  'Welcome to Drive247',
  'Everything your rental business runs on, in one place',
  E'You are holding the keys to a complete rental operation — a booking website your customers see, a portal you run the business from, and payments, insurance, contracts and messaging all wired together behind them.\n\nThis document explains every part of it. Read it end to end on your first day, then come back whenever something new comes up.\n\n**You are not on your own here.** Every operator on this platform started exactly where you are now.'
WHERE NOT EXISTS (SELECT 1 FROM public.welcome_pack_settings);
