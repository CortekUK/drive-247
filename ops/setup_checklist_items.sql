-- setup_checklist_items — the handful of features an operator has to sit down
-- with once, each carrying a link to the video or the written guide that
-- explains it.
--
-- NOT APPLIED BY THE CODE THAT ACCOMPANIES IT. Same reasoning as
-- ops/first_run_questions.sql and ops/platform_legal_documents.sql: schema
-- changes for this project go through the Supabase MCP tools, and that server
-- was unreachable in the session that wrote this. Apply it deliberately, then
-- delete this note.
--
-- Shipping the code first is safe. `useSetupChecklist()` falls back to
-- `SETUP_CHECKLIST_ITEMS` in apps/portal/src/lib/setup-checklist.ts on ANY
-- failure — missing table included — so until this runs the card shows exactly
-- the four rows seeded below.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS, in the words of the person who asked for it
--
-- "ye wali cheezon ka bada masla hai, kyunki meeting ke andar bhi ye cheez
--  clients ko samjhaayi nahi jaati... poora tamasha karna padta hai. ek hi
--  dafa ka kaam hai, ek dafa kar ke set kar ke rakh den."
--
-- Auto-extension, installments, pay-as-you-go and Bonzah are the four features
-- that cannot be explained in passing on a call — every new operator costs the
-- same live walkthrough, every time. Recording that walkthrough once and
-- hanging it off the dashboard is the whole idea. The rows below are that list.
--
-- It replaces a slice of the old Welcome Pack ("tod tod ke" — broken into
-- pieces). The Welcome Pack itself is NOT touched: it still lives in
-- welcome_pack_groups / _sections / _faqs, is still authored at
-- /admin/welcome-pack, and is still read by 16 operators across 14 tenants.
-- This is a second, much smaller surface, not a migration of that one.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS IS NOT
--
-- It is NOT per-tenant. The same four features are hard for everybody, so
-- there is no tenant_id — and therefore no tenant filter to get wrong
-- (V2_PLAN §5). It follows `feature_announcements` and `first_run_questions`
-- in that respect, not the `welcome_pack_*` tables' per-tenant read tracking.
--
-- There is deliberately NO per-tenant progress or "seen" state. A checkbox
-- would need a tenant_id and a read surface over it, which is a second table
-- and a per-tenant filter to get wrong, for a card whose job is to point at
-- four links. If ticking items off is wanted later it is a new table beside
-- this one, never a column on it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- V2_PLAN COMPLIANCE
--   §2  The portal reader is gated to the `northwind` canary by SLUG, in
--       apps/portal/src/hooks/use-setup-checklist.ts. Nothing here is gated —
--       the table is inert until something reads it.
--   §4  Additive only: one new table, one new function, no change to anything
--       that exists. Nothing is added to `public.tenants` (269 columns, 73
--       booleans, 242 column-level anon grants — a new column there refuses
--       the whole row for `anon` and takes every booking site down).
--   §5  No tenant_id, by design. Platform content, identical for every tenant.
--   §6  No triggers on pre-existing tables. `updated_at` is set by the writer
--       rather than by a trigger, for exactly that reason.

-- ─────────────────────────────────────────────────────────────────────────────
-- WHO MAY READ THIS — the helper, and why it is not `TO authenticated`
--
-- `authenticated` is NOT "portal staff". Renters sign in to apps/booking
-- through the same Supabase Auth project, so a customer holding a session is
-- `authenticated` too. A read policy scoped `TO authenticated` with a bare
-- `USING (is_published)` therefore hands this table to every renter on the
-- platform. That mistake is live in ops/first_run_questions.sql today and is
-- deliberately not copied here.
--
-- Portal staff are rows in `public.app_users`; renters are rows in
-- `public.customer_users` and have none. So "is this caller portal staff?" is
-- "does an active app_users row point at their auth.uid()?".
--
-- SECURITY DEFINER, mirroring `is_super_admin()`, for two reasons: the policy
-- must not depend on the caller holding SELECT on `app_users`, and a stable
-- function is evaluated once per query rather than re-planned per row.
-- `search_path` is pinned because a SECURITY DEFINER function without one is
-- resolvable against a caller-controlled schema.
CREATE OR REPLACE FUNCTION public.is_portal_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.is_active
  );
$$;

COMMENT ON FUNCTION public.is_portal_staff() IS
  'True when the caller is an active app_users row — i.e. operator staff or a super admin, NOT a renter. Renters authenticate through the same project but live in customer_users, so `TO authenticated` alone is not a staff check.';

-- Stated, not inherited — the same reasoning as the table GRANTs below, and the
-- precedent is `is_super_admin()`, which grants this explicitly in
-- supabase/migrations/20251222150000_fix_super_admin_rls.sql:22.
--
-- `CREATE FUNCTION` grants EXECUTE to PUBLIC by default, so this is usually
-- redundant. It is here because of what "usually" costs if it is ever wrong: an
-- RLS policy is evaluated with the CALLER's privileges, so a missing EXECUTE
-- makes every portal read of this table fail with "permission denied for
-- function is_portal_staff" — and `useSetupChecklist()` swallows that into the
-- compiled fallback, so the card keeps rendering four rows and nothing anywhere
-- says the authored ones are being ignored.
GRANT EXECUTE ON FUNCTION public.is_portal_staff() TO authenticated;

CREATE TABLE IF NOT EXISTS public.setup_checklist_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable key for the row. Used by the compiled fallback in
  -- apps/portal/src/lib/setup-checklist.ts to line up with the authored row,
  -- and as the React key in the card. Treat it as permanent once shipped.
  item_key      text NOT NULL UNIQUE,

  -- The feature's name, as the operator would say it. One line.
  title         text NOT NULL,

  -- One or two lines saying why this one needs sitting down with. Shown under
  -- the title in the card, so it stays short.
  description   text,

  -- THE LINK PAIR. At least one must be present — see the CHECK below.
  -- `video_url` is the recorded walkthrough; `guide_url` is the written guide
  -- with screenshots that stands in until the video exists.
  --
  -- Either may be an in-portal path ('/settings?tab=payg') or an absolute URL.
  -- The card treats a leading '/' as in-portal and routes it; anything else
  -- opens in a new tab.
  video_url     text,
  guide_url     text,

  -- Order is a column, not array position: an admin reordering rows must not
  -- depend on how PostgREST happens to return them.
  sort_order    integer NOT NULL DEFAULT 0,

  -- Lets a row be drafted without appearing on a live operator's dashboard.
  is_published  boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- ───────────────────────────────────────────────────────────────────────────
  -- EVERY ROW CARRIES A LINK. This is the product rule, stated as a constraint
  -- rather than left to the admin form:
  --
  --   "yahan par KOI NA KOI EK LINK LAAZIMI HOGA. wo link ya video ka hoga, ya
  --    us GUIDE ka hoga jisme detail mein humne guide likhi hogi SCREENSHOT KE
  --    SAATH."
  --
  -- A row with neither is not a shorter row, it is a dead row — a feature named
  -- as hard with nothing behind it, which is worse than not listing it. The
  -- admin form refuses it too, but the form is one writer; this holds for a
  -- hand-written INSERT, a psql session and anything added later.
  --
  -- btrim/coalesce rather than a NULL check: '' and '   ' are what a form
  -- actually submits when someone clears a field, and both are just as dead as
  -- NULL.
  CONSTRAINT setup_checklist_items_has_a_link CHECK (
    coalesce(btrim(video_url), '') <> '' OR coalesce(btrim(guide_url), '') <> ''
  )
);

CREATE INDEX IF NOT EXISTS setup_checklist_items_order
  ON public.setup_checklist_items (sort_order)
  WHERE is_published;

ALTER TABLE public.setup_checklist_items ENABLE ROW LEVEL SECURITY;

-- Read: PORTAL STAFF ONLY — operator staff and super admins, published rows.
-- Not `TO authenticated` on its own; see the note on is_portal_staff() above.
-- Super admins additionally see drafts, so a row can be staged in apps/admin
-- without appearing on a live operator's dashboard.
--
-- No anon grant, deliberately: this card lives inside the portal, behind auth,
-- and is never shown to a logged-out visitor. (Contrast
-- platform_legal_documents, which needs anon precisely because /terms and
-- /privacy are public pages.)
DROP POLICY IF EXISTS setup_checklist_items_read ON public.setup_checklist_items;
CREATE POLICY setup_checklist_items_read
  ON public.setup_checklist_items FOR SELECT TO authenticated
  USING (
    (is_published AND public.is_portal_staff())
    OR public.is_super_admin()
  );

-- Write: SUPER ADMINS ONLY. The rows are authored at /admin/setup-checklist —
-- "ye wali jo cheez hai ye bhi controllable ho super admin se". Operator staff
-- read this table and never write it, so `is_portal_staff()` deliberately does
-- NOT appear here.
DROP POLICY IF EXISTS setup_checklist_items_admin ON public.setup_checklist_items;
CREATE POLICY setup_checklist_items_admin
  ON public.setup_checklist_items FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Write: edge functions and any server-side backfill, which bypass RLS by
-- design and carry no auth.uid() for the two helpers above to resolve.
DROP POLICY IF EXISTS setup_checklist_items_service ON public.setup_checklist_items;
CREATE POLICY setup_checklist_items_service
  ON public.setup_checklist_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Table privileges, stated rather than inherited. Supabase's default
-- privileges on schema `public` usually cover a new table, but "usually" is a
-- bad thing to bet a silently-empty card on: without the privilege the portal
-- read fails, the hook falls back to the compiled list, and nothing anywhere
-- says the authored rows are being ignored.
-- The write privileges here are DELIBERATELY BROADER than who may actually
-- write, and that is the normal Supabase shape: the table privilege only says
-- "this role may attempt it", and RLS is what decides. Without them the admin
-- app cannot write at all — it holds a super admin's JWT and so acts as
-- `authenticated`, not `service_role` — and every save would fail with a
-- permission error that looks nothing like the policy it is really about.
-- `setup_checklist_items_admin` is the restriction: it demands
-- `is_super_admin()`, so an operator's staff account passes the grant and is
-- then refused by the policy, which is where the refusal belongs.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.setup_checklist_items TO authenticated;
GRANT ALL ON public.setup_checklist_items TO service_role;

-- ANON IS DELIBERATELY EXCLUDED. Nothing logged-out reads this card, and those
-- default privileges would otherwise hand the anon key a table privilege
-- nobody intended. RLS already closes it — there is no policy `TO anon`, and
-- RLS denies by default when no policy matches — so this is the second lock,
-- not the only one. (Contrast platform_legal_documents, which GRANTs to anon
-- precisely because /terms and /privacy are public pages.)
REVOKE ALL ON public.setup_checklist_items FROM anon;

COMMENT ON TABLE public.setup_checklist_items IS
  'The features an operator has to sit down with once — each with a video or a written guide. Authored by super admins in apps/admin, shown in the portal dashboard "On your desk" band. Platform-wide, not per-tenant.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: the four features named in the planning meeting, in the order they were
-- named. `ON CONFLICT DO NOTHING` keeps a re-run harmless.
--
-- ⚠️ THE guide_url VALUES BELOW ARE STANDING IN FOR GUIDES THAT DO NOT EXIST
-- YET. No walkthrough has been recorded and no written guide has been written,
-- so each row points at the screen the feature is actually configured on —
-- which is real, reachable today, and the place the operator would end up
-- anyway. The CHECK constraint is what stops a row shipping with nothing at
-- all; it cannot tell a real guide from a placeholder.
--
-- Replace them from /admin/setup-checklist the moment a real URL exists: put
-- the recording in `video_url` and the written guide in `guide_url`. Nothing
-- else has to change — the card renders whichever links are present.
--
-- Every path here was checked against apps/portal:
--   /settings?tab=auto-extend   settings/page.tsx  TabsContent value="auto-extend"
--   /settings?tab=installments  settings/page.tsx  TabsContent value="installments"
--   /settings?tab=payg          settings/page.tsx  TabsContent value="payg"
--   /settings?tab=insurance     settings/page.tsx  TabsContent value="insurance"
-- `?tab=` deep-linking is read by that page (useSearchParams, ~line 882).
--
-- `insurance` is the one to watch: it is hidden from the settings NAVIGATION
-- for lean tenants (lean-areas.ts, `settings-insurance`) but its BODY still
-- renders, because the Bonzah application wizard lives only there and the
-- /integrations Bonzah panel links back into it. So this deep link works for
-- the canary and for the other 56 tenants, which /integrations would not.

INSERT INTO public.setup_checklist_items
  (item_key, title, description, video_url, guide_url, sort_order, is_published)
VALUES
  ('auto_extension',
   'Auto-extension',
   'Rentals that renew themselves each period, charged upfront. Worth understanding what happens when a card fails and the rental pauses rather than lapsing.',
   NULL,
   '/settings?tab=auto-extend',
   10, true),

  ('installments',
   'Installments',
   'Splitting a rental into scheduled payments — how the plan is built, what happens when one payment is missed, and how the balance settles.',
   NULL,
   '/settings?tab=installments',
   20, true),

  ('payg',
   'Pay as you go',
   'The settings under pay-as-you-go are the fiddliest in the product. Go through them once with someone rather than guessing.',
   NULL,
   '/settings?tab=payg',
   30, true),

  ('bonzah',
   'Bonzah insurance',
   'Connecting Bonzah, what the quote actually covers, and how the balance and the low-balance alerts work.',
   NULL,
   '/settings?tab=insurance',
   40, true)
ON CONFLICT (item_key) DO NOTHING;
