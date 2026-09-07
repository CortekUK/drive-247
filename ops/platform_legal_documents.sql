-- platform_legal_documents — the platform's Terms and Privacy Policy, editable
-- by a super admin instead of shipped as hardcoded JSX.
--
-- NOT APPLIED BY THE CODE THAT ACCOMPANIES IT. This file lives under ops/
-- rather than supabase/migrations/ on purpose: the standing rule for this
-- project is that schema changes go through the Supabase MCP tools, and the MCP
-- server was unreachable in the session that wrote this. Apply it deliberately,
-- with someone watching, and delete this note when it has landed.
--
-- Everything reading it already degrades to the hardcoded documents when the
-- table is absent (apps/web/src/lib/legal/legal-documents-server.ts returns null
-- on ANY failure), so shipping the code before this runs changes nothing on the
-- live site. That ordering is deliberate: the risky half is the DDL, and it can
-- be applied on its own schedule.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A NEW TABLE AND NOT `cms_pages`
--
-- `cms_pages` already holds rows for slugs 'terms' and 'privacy', and
-- apps/booking falls back to the GLOBAL row (tenant_id IS NULL) whenever a
-- tenant has none of its own — apps/booking/src/lib/legal-page-content.ts:105.
-- Those are a DIFFERENT CONTRACT: the rental terms between a renter and an
-- operator, currently under A2P 10DLC carrier review. Editing the platform's
-- Terms through that table would rewrite every tenant's rental terms as a side
-- effect. apps/booking/src/app/terms/page.tsx says so in its own header:
-- "Never cross-link them."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- V2_PLAN COMPLIANCE
--   §4  Additive only — a new table, which v1 does not know exists.
--   §4  The `tenants` grant trap does not apply: this is a new table, so the
--       anon GRANT below is a table-level grant on a table nothing else reads.
--   §5  No tenant_id, by design. This is PLATFORM content, identical for every
--       tenant, so there is no per-tenant filter to get wrong.

CREATE TABLE IF NOT EXISTS public.platform_legal_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'terms' | 'privacy'. Constrained rather than free text: these two slugs are
  -- read by name from apps/web, and a typo would silently serve the fallback.
  slug           text NOT NULL CHECK (slug IN ('terms', 'privacy')),

  -- The version string shown to readers and recorded against consent. Free text
  -- because it mirrors PLATFORM_TOS_VERSION in
  -- supabase/functions/_shared/platform-tos.ts, which is a date-ish label rather
  -- than a number.
  version        text NOT NULL,

  title          text NOT NULL,
  body_md        text NOT NULL DEFAULT '',

  -- Displayed under the title. Text, not `date`: it is prose shown to a reader
  -- ("1 March 2026"), and forcing a date type here would invite timezone
  -- arithmetic on something that is purely a label.
  effective_date text,

  -- Drafts are visible to super admins only, so a document can be staged in the
  -- admin app without the public site serving a half-written policy.
  is_published   boolean NOT NULL DEFAULT false,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- At most ONE published document per slug. Without this, two published rows for
-- 'terms' would make which one the public site serves depend on row order —
-- and the failure would be invisible until someone noticed the wrong policy.
-- Partial, so any number of drafts can be staged alongside the live one.
CREATE UNIQUE INDEX IF NOT EXISTS platform_legal_documents_published_slug
  ON public.platform_legal_documents (slug)
  WHERE is_published;

ALTER TABLE public.platform_legal_documents ENABLE ROW LEVEL SECURITY;

-- Read: ANON AND AUTHENTICATED, published rows only.
--
-- This is the one place this table's policies differ from welcome_pack_*, and
-- the difference is load-bearing: /terms and /privacy are read by people who are
-- not signed in — that is the entire point of a public policy page — so a
-- policy scoped `TO authenticated` would serve the fallback to every real
-- visitor while looking correct to anyone testing while logged in.
DROP POLICY IF EXISTS platform_legal_documents_read ON public.platform_legal_documents;
CREATE POLICY platform_legal_documents_read
  ON public.platform_legal_documents FOR SELECT TO anon, authenticated
  USING (is_published);

-- Super admins see everything, including drafts, and are the only role that may
-- write. `is_super_admin()` is the same helper welcome_pack_* uses.
DROP POLICY IF EXISTS platform_legal_documents_admin ON public.platform_legal_documents;
CREATE POLICY platform_legal_documents_admin
  ON public.platform_legal_documents FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS platform_legal_documents_service ON public.platform_legal_documents;
CREATE POLICY platform_legal_documents_service
  ON public.platform_legal_documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- The anon role needs the table privilege as well as the policy. RLS narrows
-- what a role may see; it does not grant the right to look in the first place.
GRANT SELECT ON public.platform_legal_documents TO anon;

COMMENT ON TABLE public.platform_legal_documents IS
  'Platform Terms of Service and Privacy Policy, authored by super admins in apps/admin and rendered by apps/web at /terms and /privacy. NOT tenant rental terms — those live in cms_pages and are a different contract.';
