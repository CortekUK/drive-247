-- portal_announcements — what a Drive247 super admin tells tenants' portal staff.
--
-- Two kinds in one table:
--   feature  a card on the v2 dashboard's "On your desk" band (paper illustration,
--            heading, one line) that opens a slides dialog (1-10 slides). v2 canary only;
--            the gate lives in the portal, not here.
--   system   a notice in EVERY tenant portal, v1 and v2 chrome: a dialog or a
--            full-width banner, soft (closable) or hard (blocks until the super
--            admin deactivates it or the tenant leaves the smart filter).
-- Authored at /admin/announcements (apps/admin/components/announcements/**), read
-- by apps/portal/src/hooks/use-portal-announcements.ts. The TypeScript twin of
-- every limit, pattern and predicate below is
-- apps/{portal/src,admin}/lib/announcements/contract.ts. Change one, change both.
--
-- APPLIED TO PRODUCTION on Sep 17 2026 through the Management API, as one
-- transaction, after the PGlite suite (462 checks) and an adversarial review.
-- Verified read-only afterwards: 3 tables with RLS, 13 functions, EXECUTE grants
-- (anon none), 10 policies, the portal-announcement-media bucket. A rolled-back
-- smoke test saved a targeted announcement as a super admin, the targeted
-- tenant's staff read it, and another tenant's staff did not.
-- It is written to be re-runnable, but a re-run does NOT alter the CHECK
-- constraints of the existing tables: change those with an explicit ALTER.
--
-- CHANGED SINCE THAT APPLY (Sep 17 2026, round 4): admin_portal_announcement_stats
-- gained APPENDED columns that include super admins (see the function). Its
-- RETURNS TABLE changed, so it is DROPped and re-CREATEd, and the grants in
-- section 5 must run in the same transaction. Either re-run this whole file, or
-- run just that function block plus its two section-5 grant lines inside one
-- BEGIN/COMMIT (the suite applies both ways over the previous file, T19). Until
-- then the admin reads the old nine columns and falls back to the staff-only
-- counts (normalizeAdminAnnouncementStats).
--
-- Shipping the code first is safe. Until this runs, `get_portal_announcements`
-- does not exist, the portal treats that like any read error and renders NOTHING
-- (no card, no banner, no dialog), and the admin page says "Announcements are not
-- installed in this database yet".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE ONLY
--
-- Creates: 3 tables (portal_announcements, portal_announcement_tenants,
-- portal_announcement_user_state), their triggers, indexes, RLS policies and
-- functions, one storage bucket (portal-announcement-media) and its 4 policies
-- on storage.objects. Changes nothing that exists:
--   * `feature_announcements`, `customer_announcement_views`,
--     `feature_announcement_stats` and the old `announcement-media` bucket are
--     untouched. The booking app reads `feature_announcements` for RENTERS of
--     every tenant with no audience filter; operator-facing content therefore
--     lives in tables renters cannot read at all, so it cannot leak there by
--     construction.
--   * No column on `public.tenants` (anon column grants: a grantless new column
--     takes booking sites down). No trigger on any pre-existing table.
-- Re-running is harmless: IF NOT EXISTS, CREATE OR REPLACE, or DROP-then-CREATE
-- on objects only this file creates. Target is PG15: no PG16+ syntax.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHO CAN DO WHAT
--
--   anon                 nothing (no table privilege, no EXECUTE).
--   authenticated        `authenticated` includes RENTERS (booking customer
--                        auth), so there is NO tenant-staff policy on any table:
--                        staff read only through get_portal_announcements and
--                        write only through record_portal_announcement_event,
--                        both SECURITY DEFINER and both checking the caller
--                        against app_users for the tenant passed in. The targets
--                        table would otherwise tell any signed-in user which
--                        tenants are in trouble.
--   super admin          full table access through RLS (list, inline Active
--                        toggle, delete) plus the admin_* RPCs (save, reorder,
--                        smart-filter matches, stats), and listing/writing the
--                        image bucket. The RPCs read app_users.is_super_admin
--                        themselves rather than calling public.is_super_admin()
--                        (see admin_save_portal_announcement). Like that
--                        function, they do not check app_users.is_active.
--   service_role         everything.
-- Grants follow supabase/migrations/20260904120000_secure_app_users_read_access.sql
-- (REVOKE ALL first: Supabase's default privileges hand `authenticated` TRUNCATE,
-- which ignores RLS). Every function revokes from PUBLIC AND anon: revoking from
-- PUBLIC alone leaves anon's default EXECUTE in place.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW TO RUN THE PGLITE SUITE (Postgres 18 in WASM; nothing installs into the repo)
--
--   SP=/tmp/claude-1000/-home-haseeb-raza-Desktop-drive-247/ad8712cc-75e1-4de3-aadb-4b70c3f20c6e/scratchpad/ann
--   cd $SP/sql && ln -sfn ../pglite/node_modules node_modules && bash run.sh
--
-- It applies stub-supabase.sql and then this file TWICE as a non-superuser owner,
-- and prints one PASS/FAIL line per check (grants, renter/staff/super-admin
-- isolation, ordering, the is_due matrix, events, the 37 smart-filter fixtures,
-- CHECK parity with the TypeScript validator, every RPC, cascades, storage).
-- Exit code 0 = failures=0.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- READ-ONLY PRODUCTION PRE-CHECKS (run before applying; $SP/sql/prod-prechecks.sql)
--
--   SELECT current_setting('server_version');
--   SELECT current_setting('server_encoding');                             -- UTF8 (the not-blank class uses \u escapes)
--   SELECT pg_get_functiondef('public.is_super_admin()'::regprocedure);   -- either repo body works (suite T18)
--   SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);  -- informational; not used here
--   SELECT to_regclass('public.portal_announcements'),
--          to_regclass('public.portal_announcement_tenants'),
--          to_regclass('public.portal_announcement_user_state');           -- all NULL
--   SELECT id FROM storage.buckets WHERE id = 'portal-announcement-media';  -- no row
--   SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'announcement-media';  -- informational
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND (qual ILIKE '%announcement-media%' OR with_check ILIKE '%announcement-media%');  -- informational
--   SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--      AND proname LIKE ANY (ARRAY['%portal_announcement%', 'admin_%portal_announcement%']);  -- no row
--   SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl
--    WHERE defaclnamespace = 'public'::regnamespace;                      -- confirms the default-privilege trap

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═════════════════════════════════════════════════════════════════════════════

-- NOT BLANK, THE WAY JAVASCRIPT MEANS IT. btrim() strips only ASCII spaces, but
-- the contract normalisers trim with String.prototype.trim, which also strips
-- NBSP, U+1680, U+2000-U+200A, U+2028/U+2029, U+202F, U+205F, U+3000 and U+FEFF,
-- and then DROP a row whose title, summary, body or every slide is empty. A title
-- of only NBSP would be stored, vanish from the admin list and every portal, and
-- block the admin's drag (reorder needs every id of the kind). So each required
-- text below must also contain one character outside that class, which is exactly
-- JS's trim set (the suite sweeps the code space). The editor never sends such a
-- value (draftToSaveArgs trims first); this stops a raw RPC call or a direct write.
--
-- Pure validator for a feature's slides, used by pa_feature_shape. It must exist
-- before the table. Never dropped by a re-run (the CHECK depends on it).
-- EXECUTE is granted to authenticated because a super admin's direct PostgREST
-- UPDATE (the inline Active toggle) re-evaluates every CHECK as `authenticated`.
-- TS twin: validateSaveArgs slide rules + ANNOUNCEMENT_IMAGE_URL_RE.
CREATE OR REPLACE FUNCTION public.portal_announcement_slides_valid(p_slides jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_slides IS NULL OR jsonb_typeof(p_slides) <> 'array' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_slides) AS e(v)
    WHERE NOT CASE WHEN jsonb_typeof(e.v) <> 'object' THEN false ELSE coalesce((
          (e.v - 'heading' - 'body' - 'image_url') = '{}'::jsonb   -- `-` raises on scalars, hence the CASE guard
      AND jsonb_typeof(e.v->'heading') = 'string'
      AND char_length(btrim(e.v->>'heading')) >= 1 AND char_length(e.v->>'heading') <= 60
      AND (e.v->>'heading') ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
      AND (e.v->>'heading') !~ '[\x01-\x1F\x7F]'
      AND jsonb_typeof(e.v->'body') = 'string'
      AND char_length(btrim(e.v->>'body', E' \n')) >= 1 AND char_length(e.v->>'body') <= 400
      AND (e.v->>'body') ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
      AND (e.v->>'body') !~ '[\x01-\x09\x0B-\x1F\x7F]'
      AND (   e.v->'image_url' IS NULL OR jsonb_typeof(e.v->'image_url') = 'null'
           OR (jsonb_typeof(e.v->'image_url') = 'string'
               AND char_length(e.v->>'image_url') <= 500
               AND (e.v->>'image_url') ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/portal-announcement-media/feature/(card|slide)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'))
    ), false) END) END;
$$;

-- The content. Plain text only everywhere (no HTML: the old body_html path was
-- rendered unsanitised). Per-kind shape is enforced by pa_feature_shape /
-- pa_system_shape, and required text by the not-blank class above, so a row the
-- portal cannot render cannot be stored.
CREATE TABLE IF NOT EXISTS public.portal_announcements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL,
  title             text NOT NULL,
  -- feature: the one-line description under the heading. system: NULL.
  summary           text,
  -- system: the message (may contain \n). feature: NULL.
  body              text,
  -- feature: the card illustration, an object this system uploaded. system: NULL.
  image_url         text,
  -- feature: 1-10 {heading, body, image_url} (was 2-3 until Sep 17 2026). system: [].
  slides            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Both NULL or both set; the URL is an in-portal path (never a scheme, never //host).
  cta_label         text,
  cta_url           text,
  -- system only.
  display           text,
  blocking          text NOT NULL DEFAULT 'soft',
  tone              text,
  -- Who receives it: every tenant, the rows in portal_announcement_tenants, or a
  -- smart filter evaluated LIVE at read time (no stored membership, no cron).
  audience          text NOT NULL DEFAULT 'all',
  segment_key       text,
  -- NULL = show once. 1/3/7 = auto-open again that many 24-hour periods after
  -- the user's last dismissal. Hard items ignore frequency, so it must be NULL.
  repeat_after_days integer,
  -- Drag order within a kind (and within hard/soft for system). New rows are
  -- appended last by pa_before_insert.
  sort_order        integer NOT NULL,                 -- BEFORE INSERT trigger fills NULL
  -- Bumped only when the admin saves with "Show it again to everyone who already
  -- closed it"; state rows of an older revision count as never dismissed.
  revision          integer NOT NULL DEFAULT 1,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by        uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pa_kind            CHECK (kind IN ('feature','system')),
  CONSTRAINT pa_blocking        CHECK (blocking IN ('soft','hard')),
  CONSTRAINT pa_display         CHECK (display IS NULL OR display IN ('dialog','banner')),
  CONSTRAINT pa_tone            CHECK (tone IS NULL OR tone IN ('info','success','warning','critical')),
  CONSTRAINT pa_audience        CHECK (audience IN ('all','selected','segment')),
  CONSTRAINT pa_segment_key     CHECK (segment_key IS NULL OR segment_key IN ('stripe_connect_not_connected','bonzah_not_active','uae_migration_pending')),
  CONSTRAINT pa_segment_iff     CHECK ((audience = 'segment') = (segment_key IS NOT NULL)),
  CONSTRAINT pa_repeat          CHECK (repeat_after_days IS NULL OR repeat_after_days IN (1,3,7)),
  CONSTRAINT pa_hard_no_repeat  CHECK (blocking = 'soft' OR repeat_after_days IS NULL),
  -- Drive247 switches Bonzah on, not the tenant: a hard blocker on that filter
  -- would lock tenants out with nothing they can do about it.
  CONSTRAINT pa_hard_segment    CHECK (NOT (blocking = 'hard' AND segment_key IS NOT DISTINCT FROM 'bonzah_not_active')),
  CONSTRAINT pa_revision        CHECK (revision >= 1),
  CONSTRAINT pa_title           CHECK (char_length(btrim(title)) >= 1 AND title !~ '[\x01-\x1F\x7F]'
                                       AND title ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
                                       AND char_length(title) <= CASE WHEN kind = 'feature' THEN 60 ELSE 80 END),
  CONSTRAINT pa_cta_pair        CHECK ((cta_url IS NULL) = (cta_label IS NULL)),
  CONSTRAINT pa_cta_label       CHECK (cta_label IS NULL OR (char_length(btrim(cta_label)) >= 1 AND char_length(cta_label) <= 30
                                       AND cta_label !~ '[\x01-\x1F\x7F]'
                                       AND cta_label ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]')),
  -- TS twin: isInPortalPath.
  CONSTRAINT pa_cta_url         CHECK (cta_url IS NULL OR (
                                         char_length(cta_url) BETWEEN 1 AND 300
                                     AND left(cta_url, 1) = '/'
                                     AND substr(cta_url, 2, 1) NOT IN ('/', E'\\')
                                     AND strpos(cta_url, E'\\') = 0
                                     AND cta_url !~ '[\x01-\x20\x7F]'
                                     AND split_part(split_part(cta_url, '#', 1), '?', 1) !~ '(^|/)\.\.?(/|$)')),
  CONSTRAINT pa_feature_shape   CHECK (kind <> 'feature' OR (
                                         blocking = 'soft' AND display IS NULL AND tone IS NULL AND body IS NULL
                                     AND summary IS NOT NULL AND char_length(btrim(summary)) >= 1 AND char_length(summary) <= 120
                                     AND summary !~ '[\x01-\x1F\x7F]'
                                     AND summary ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
                                     AND image_url IS NOT NULL AND char_length(image_url) <= 500
                                     AND image_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/portal-announcement-media/feature/(card|slide)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
                                     AND CASE WHEN jsonb_typeof(slides) = 'array' THEN jsonb_array_length(slides) BETWEEN 1 AND 10 ELSE false END
                                     AND public.portal_announcement_slides_valid(slides))),
  CONSTRAINT pa_system_shape    CHECK (kind <> 'system' OR (
                                         display IS NOT NULL AND tone IS NOT NULL
                                     AND summary IS NULL AND image_url IS NULL AND slides = '[]'::jsonb
                                     AND body IS NOT NULL AND char_length(btrim(body, E' \n')) >= 1
                                     AND body !~ '[\x01-\x09\x0B-\x1F\x7F]'
                                     AND body ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
                                     AND char_length(body) <= CASE WHEN display = 'banner' THEN 200 ELSE 400 END))
);
-- Slides were 2-3 until Sep 17 2026 (user: slides must be freely added and deleted).
-- CREATE TABLE IF NOT EXISTS keeps an existing table's old CHECK, so rebuild it.
ALTER TABLE public.portal_announcements DROP CONSTRAINT IF EXISTS pa_feature_shape;
ALTER TABLE public.portal_announcements ADD CONSTRAINT pa_feature_shape CHECK (kind <> 'feature' OR (
                                         blocking = 'soft' AND display IS NULL AND tone IS NULL AND body IS NULL
                                     AND summary IS NOT NULL AND char_length(btrim(summary)) >= 1 AND char_length(summary) <= 120
                                     AND summary !~ '[\x01-\x1F\x7F]'
                                     AND summary ~ '[^\x09-\x0D\x20\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
                                     AND image_url IS NOT NULL AND char_length(image_url) <= 500
                                     AND image_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/portal-announcement-media/feature/(card|slide)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
                                     AND CASE WHEN jsonb_typeof(slides) = 'array' THEN jsonb_array_length(slides) BETWEEN 1 AND 10 ELSE false END
                                     AND public.portal_announcement_slides_valid(slides)));

-- The reader's scan: active rows in display order.
CREATE INDEX IF NOT EXISTS portal_announcements_live_idx ON public.portal_announcements (kind, blocking, sort_order) WHERE is_active;

-- audience = 'selected' only. Replaced wholesale by admin_save_portal_announcement.
CREATE TABLE IF NOT EXISTS public.portal_announcement_tenants (
  announcement_id uuid NOT NULL REFERENCES public.portal_announcements(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS portal_announcement_tenants_tenant_idx ON public.portal_announcement_tenants (tenant_id);

-- Per app_user PER TENANT: a super admin (tenant_id NULL) visiting several
-- tenants keeps separate state in each. Written only by
-- record_portal_announcement_event. No localStorage anywhere.
CREATE TABLE IF NOT EXISTS public.portal_announcement_user_state (
  announcement_id    uuid NOT NULL REFERENCES public.portal_announcements(id) ON DELETE CASCADE,
  app_user_id        uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The announcement revision these timestamps belong to.
  revision           integer NOT NULL DEFAULT 1,
  shown_count        integer NOT NULL DEFAULT 0,
  first_shown_at     timestamptz,
  last_shown_at      timestamptz,
  card_opened_at     timestamptz,
  -- Starts the repeat clock. Also set by "don't show again" and by a CTA click on a soft item.
  dismissed_at       timestamptz,
  dont_show_again_at timestamptz,
  cta_clicked_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_user_id, tenant_id, announcement_id)
);
CREATE INDEX IF NOT EXISTS portal_announcement_user_state_announcement_idx ON public.portal_announcement_user_state (announcement_id);

-- Triggers live on the NEW table only.
-- Append new rows last in their kind, so a new announcement never jumps ahead of
-- rows the admin has already dragged into order (reorder writes 10, 20, 30...).
-- SECURITY DEFINER so max() reads as the owner, without RLS. Run as the caller,
-- a super admin's direct INSERT evaluates the table policy, and so
-- public.is_super_admin(), under this function's empty search_path; the pg_dump
-- body of is_super_admin() (no SET search_path, unqualified app_users) raises
-- 42P01 there. The result is the same either way: a super admin sees every row.
-- EXECUTE stays revoked (a trigger does not need it).
CREATE OR REPLACE FUNCTION public.portal_announcements_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.sort_order IS NULL THEN
    NEW.sort_order := coalesce((SELECT max(a.sort_order) FROM public.portal_announcements a WHERE a.kind = NEW.kind), 0) + 10;
  END IF;
  RETURN NEW;
END $$;

-- A feature cannot become a system notice (or back): the shapes, the state and
-- the order all belong to one kind. updated_at is stamped here rather than by
-- the shared set_updated_at(), so this file depends on nothing it does not create.
CREATE OR REPLACE FUNCTION public.portal_announcements_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'announcement kind cannot change' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pa_before_insert ON public.portal_announcements;
CREATE TRIGGER pa_before_insert BEFORE INSERT ON public.portal_announcements
  FOR EACH ROW EXECUTE FUNCTION public.portal_announcements_before_insert();
DROP TRIGGER IF EXISTS pa_before_update ON public.portal_announcements;
CREATE TRIGGER pa_before_update BEFORE UPDATE ON public.portal_announcements
  FOR EACH ROW EXECUTE FUNCTION public.portal_announcements_before_update();

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. INTERNAL FUNCTIONS (service_role only; called from the definer RPCs below)
-- ═════════════════════════════════════════════════════════════════════════════

-- The smart filters. Each arm is the SAME rule the portal already shows that
-- tenant, so the admin's match list and the tenant's own screen never disagree:
--   stripe_connect_not_connected  the red Connect-Stripe banner
--       (apps/portal/src/components/banners/sources/connect-stripe-banner.tsx:98-100),
--       minus Square tenants, who have no Stripe to connect
--   bonzah_not_active             !isBonzahSellable(t) (apps/portal/src/lib/bonzah.ts:28-33)
--   uae_migration_pending         deriveMigrationView(t).enrolledIncomplete
--       (apps/portal/src/hooks/migration-view.ts:87-88); `subscription_account`
--       DEFAULTS to 'uae', so the enrolment test is what stops it matching everyone
-- NULL-proof on every column; a missing tenant or an unknown key is false, never NULL.
-- Evaluated on every read: a tenant that fixes the condition drops out on its
-- next poll, one that newly matches starts receiving the item. No cron.
DROP FUNCTION IF EXISTS public.portal_announcement_segment_match(uuid, text);
CREATE FUNCTION public.portal_announcement_segment_match(p_tenant_id uuid, p_segment_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT CASE p_segment_key
      WHEN 'stripe_connect_not_connected' THEN
            coalesce(t.payment_provider, 'stripe') <> 'square'
        AND t.stripe_mode IS NOT DISTINCT FROM 'test'
        AND coalesce(t.own_stripe_account_id, '') = ''
      WHEN 'bonzah_not_active' THEN
        NOT (     t.integration_bonzah IS TRUE
              AND (   t.bonzah_mode IS NOT DISTINCT FROM 'live'
                   OR t.bonzah_sandbox_override IS TRUE))
      WHEN 'uae_migration_pending' THEN
            (   t.migration_blocker IS NOT DISTINCT FROM 'soft'
             OR t.migration_blocker IS NOT DISTINCT FROM 'hard')
        AND NOT (     coalesce(t.own_stripe_account_id, '') <> ''
                  AND t.subscription_account IS NOT DISTINCT FROM 'uae')
      ELSE false
    END
    FROM public.tenants t WHERE t.id = p_tenant_id
  ), false);
$$;

-- The app_users row allowed to act for p_tenant_id, or NULL. The tenant is the
-- portal's hostname slug and nothing in the portal checks the signed-in user
-- belongs to it, so this is the check. Staff: active and of that tenant. Super
-- admin (tenant_id NULL): active, any existing tenant. Renters (no app_users
-- row), Bonzah partners and sales agents (tenant NULL, not super admin): NULL.
-- Never get_user_tenant_id(): one of its repo bodies trusts user_metadata.
DROP FUNCTION IF EXISTS public.portal_announcement_caller(uuid);
CREATE FUNCTION public.portal_announcement_caller(p_tenant_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT au.id FROM public.app_users au
  WHERE au.auth_user_id = auth.uid()
    AND au.is_active IS TRUE
    AND (au.tenant_id = p_tenant_id OR au.is_super_admin IS TRUE)
    AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id)
  LIMIT 1;
$$;

-- Does the audience include this tenant? Ignores is_active (the admin stats count
-- audiences of inactive rows too). Missing announcement: false.
DROP FUNCTION IF EXISTS public.portal_announcement_targets(uuid, uuid);
CREATE FUNCTION public.portal_announcement_targets(p_announcement_id uuid, p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT CASE a.audience
      WHEN 'all'      THEN true
      WHEN 'selected' THEN EXISTS (SELECT 1 FROM public.portal_announcement_tenants pt
                                   WHERE pt.announcement_id = a.id AND pt.tenant_id = p_tenant_id)
      WHEN 'segment'  THEN public.portal_announcement_segment_match(p_tenant_id, a.segment_key)
      ELSE false
    END
    FROM public.portal_announcements a WHERE a.id = p_announcement_id
  ), false);
$$;

-- Active AND targeted. The reader and the event writer both use this one
-- predicate, so nobody can write state for an item they could not have seen.
DROP FUNCTION IF EXISTS public.portal_announcement_applies(uuid, uuid);
CREATE FUNCTION public.portal_announcement_applies(p_announcement_id uuid, p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT a.is_active AND public.portal_announcement_targets(a.id, p_tenant_id)
    FROM public.portal_announcements a WHERE a.id = p_announcement_id
  ), false);
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. PORTAL RPCs (authenticated; the caller is checked inside)
-- ═════════════════════════════════════════════════════════════════════════════

-- Everything that applies to p_tenant_id right now, in display order, with this
-- user's state. p_kinds = ['system'] outside the v2 dashboard canary, so a client
-- bug cannot render a feature on a v1 tenant. Not permitted = zero rows (no
-- error, so no oracle). Never returns audience, segment_key or targets:
-- targeting is not disclosed to tenants.
--
-- is_due (what the portal auto-opens / shows as a banner):
--   hard system                                  always
--   no state row, or state of an older revision  yes
--   "don't show again"                           no
--   never dismissed                              yes (opened then reloaded without closing = not acknowledged)
--   show once                                    no
--   repeat N                                     once dismissed_at is N x 24 hours old
-- The repeat clock is `hours => 24 * N`, not `days => N`: timestamptz minus a
-- days interval follows the session TimeZone across DST (23 or 25 hours), and
-- the rule is 24-hour multiples on the server clock. Identical under UTC.
DROP FUNCTION IF EXISTS public.get_portal_announcements(uuid, text[]);
CREATE FUNCTION public.get_portal_announcements(p_tenant_id uuid, p_kinds text[] DEFAULT NULL)
RETURNS TABLE (
  id                 uuid,
  kind               text,
  title              text,
  summary            text,
  body               text,
  image_url          text,
  slides             jsonb,
  cta_label          text,
  cta_url            text,
  display            text,
  blocking           text,
  tone               text,
  repeat_after_days  integer,
  sort_order         integer,
  revision           integer,
  last_shown_at      timestamptz,
  dismissed_at       timestamptz,
  dont_show_again_at timestamptz,
  is_due             boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH caller AS (
    SELECT public.portal_announcement_caller(p_tenant_id) AS app_user_id
  )
  SELECT
    a.id, a.kind, a.title, a.summary, a.body, a.image_url, a.slides,
    a.cta_label, a.cta_url, a.display, a.blocking, a.tone,
    a.repeat_after_days, a.sort_order, a.revision,
    s.last_shown_at,
    CASE WHEN s.revision = a.revision THEN s.dismissed_at END,
    CASE WHEN s.revision = a.revision THEN s.dont_show_again_at END,
    CASE
      WHEN a.kind = 'system' AND a.blocking = 'hard'          THEN true
      WHEN s.app_user_id IS NULL OR s.revision <> a.revision  THEN true
      WHEN s.dont_show_again_at IS NOT NULL                   THEN false
      WHEN s.dismissed_at IS NULL                             THEN true
      WHEN a.repeat_after_days IS NULL                        THEN false
      ELSE s.dismissed_at <= now() - make_interval(hours => 24 * a.repeat_after_days)
    END
  FROM caller c
  JOIN public.portal_announcements a ON c.app_user_id IS NOT NULL
  LEFT JOIN public.portal_announcement_user_state s
         ON s.announcement_id = a.id
        AND s.app_user_id = c.app_user_id
        AND s.tenant_id = p_tenant_id
  WHERE a.is_active
    AND public.portal_announcement_applies(a.id, p_tenant_id)
    AND (p_kinds IS NULL OR a.kind = ANY (p_kinds))
  ORDER BY (a.kind = 'system') DESC, (a.blocking = 'hard') DESC, a.sort_order, a.created_at, a.id;
$$;

-- One user event. Order matters and is part of the security model:
--   1. unknown event                  22023
--   2. caller not permitted           42501
--   3. not active / not targeted / missing: silent no-op, checked BEFORE anything
--      that depends on hard vs soft, so the response never reveals whether an id
--      exists or what it is
--   4. ignored events: dismissing a hard item (it cannot be closed), a card open
--      on a system item (it has no card); "don't show again" on a system soft
--      item counts as a plain dismissal
--   5. upsert the state row; a row from an older revision starts clean
--   6. apply. A CTA click on a soft item also dismisses it (pressing the button
--      is closing the dialog); on a hard item it is only recorded.
DROP FUNCTION IF EXISTS public.record_portal_announcement_event(uuid, uuid, text);
CREATE FUNCTION public.record_portal_announcement_event(p_announcement_id uuid, p_tenant_id uuid, p_event text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller   uuid;
  v_kind     text;
  v_blocking text;
  v_revision integer;
  v_hard     boolean;
  v_event    text := p_event;
BEGIN
  IF p_event IS NULL OR p_event NOT IN ('shown', 'card_opened', 'dismissed', 'dont_show_again', 'cta_clicked') THEN
    RAISE EXCEPTION 'unknown announcement event' USING ERRCODE = '22023';
  END IF;

  v_caller := public.portal_announcement_caller(p_tenant_id);
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  IF NOT public.portal_announcement_applies(p_announcement_id, p_tenant_id) THEN
    RETURN;
  END IF;

  SELECT a.kind, a.blocking, a.revision INTO v_kind, v_blocking, v_revision
  FROM public.portal_announcements a WHERE a.id = p_announcement_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_hard := v_kind = 'system' AND v_blocking = 'hard';

  IF v_hard AND v_event IN ('dismissed', 'dont_show_again') THEN
    RETURN;
  END IF;
  IF v_kind = 'system' AND v_event = 'card_opened' THEN
    RETURN;
  END IF;
  IF v_kind = 'system' AND v_event = 'dont_show_again' THEN
    v_event := 'dismissed';
  END IF;

  INSERT INTO public.portal_announcement_user_state AS s (announcement_id, app_user_id, tenant_id, revision)
  VALUES (p_announcement_id, v_caller, p_tenant_id, v_revision)
  ON CONFLICT (app_user_id, tenant_id, announcement_id) DO UPDATE
    SET revision = EXCLUDED.revision, dismissed_at = NULL, dont_show_again_at = NULL
    WHERE s.revision <> EXCLUDED.revision;

  UPDATE public.portal_announcement_user_state AS s SET
    shown_count        = CASE WHEN v_event = 'shown' THEN s.shown_count + 1 ELSE s.shown_count END,
    first_shown_at     = CASE WHEN v_event = 'shown' THEN coalesce(s.first_shown_at, now()) ELSE s.first_shown_at END,
    last_shown_at      = CASE WHEN v_event = 'shown' THEN now() ELSE s.last_shown_at END,
    card_opened_at     = CASE WHEN v_event = 'card_opened' THEN now() ELSE s.card_opened_at END,
    dismissed_at       = CASE WHEN v_event IN ('dismissed', 'dont_show_again')
                                OR (v_event = 'cta_clicked' AND NOT v_hard) THEN now()
                              ELSE s.dismissed_at END,
    dont_show_again_at = CASE WHEN v_event = 'dont_show_again' THEN now() ELSE s.dont_show_again_at END,
    cta_clicked_at     = CASE WHEN v_event = 'cta_clicked' THEN now() ELSE s.cta_clicked_at END,
    updated_at         = now()
  WHERE s.app_user_id = v_caller
    AND s.tenant_id = p_tenant_id
    AND s.announcement_id = p_announcement_id;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. ADMIN RPCs (super admin only)
-- ═════════════════════════════════════════════════════════════════════════════

-- Create (p_id NULL) or replace one announcement AND its targets in one
-- transaction, so a 'selected' row can never exist without its tenants.
-- p_row is SaveAnnouncementRow, already normalised by draftToSaveArgs; values
-- are stored as given and the CHECKs reject anything malformed (23514). Unknown
-- keys are ignored. An edit never re-shows the item to people who closed it
-- unless p_reshow (the editor's explicit checkbox) bumps the revision.
DROP FUNCTION IF EXISTS public.admin_save_portal_announcement(uuid, jsonb, uuid[], boolean);
CREATE FUNCTION public.admin_save_portal_announcement(
  p_id         uuid,
  p_row        jsonb,
  p_tenant_ids uuid[]  DEFAULT '{}',
  p_reshow     boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller   uuid;
  v_id       uuid;
  v_audience text;
  v_slides   jsonb;
BEGIN
  -- public.is_super_admin(), inlined with its own body, schema-qualified (as the
  -- trax support RPCs read app_users). The repo has two bodies for that function
  -- and which one is live is unknown: remote_schema.sql:2189 has no SET
  -- search_path and reads an unqualified app_users, so calling it from this
  -- function's search_path = '' raises 42P01 and the whole admin page breaks.
  IF NOT coalesce((SELECT au.is_super_admin FROM public.app_users au WHERE au.auth_user_id = auth.uid() LIMIT 1), false) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_row IS NULL OR jsonb_typeof(p_row) <> 'object' THEN
    RAISE EXCEPTION 'announcement row must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT au.id INTO v_caller FROM public.app_users au WHERE au.auth_user_id = auth.uid() LIMIT 1;

  v_audience := p_row->>'audience';
  -- A missing key and a JSON null both mean "no slides".
  v_slides := CASE WHEN coalesce(jsonb_typeof(p_row->'slides'), 'null') = 'null' THEN '[]'::jsonb ELSE p_row->'slides' END;

  IF v_audience = 'selected' THEN
    IF p_tenant_ids IS NULL OR cardinality(p_tenant_ids) = 0 THEN
      RAISE EXCEPTION 'choose at least one tenant' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_tenant_ids) AS u(tenant_id)
               WHERE u.tenant_id IS NULL
                  OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = u.tenant_id)) THEN
      RAISE EXCEPTION 'unknown tenant' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.portal_announcements (
      kind, title, summary, body, image_url, slides, cta_label, cta_url,
      display, blocking, tone, audience, segment_key, repeat_after_days, is_active,
      created_by, updated_by
    ) VALUES (
      p_row->>'kind', p_row->>'title', p_row->>'summary', p_row->>'body', p_row->>'image_url', v_slides,
      p_row->>'cta_label', p_row->>'cta_url',
      p_row->>'display', p_row->>'blocking', p_row->>'tone', p_row->>'audience', p_row->>'segment_key',
      (p_row->>'repeat_after_days')::int, coalesce((p_row->>'is_active')::boolean, true),
      v_caller, v_caller
    )
    RETURNING portal_announcements.id INTO v_id;
  ELSE
    UPDATE public.portal_announcements AS a SET
      kind              = p_row->>'kind',
      title             = p_row->>'title',
      summary           = p_row->>'summary',
      body              = p_row->>'body',
      image_url         = p_row->>'image_url',
      slides            = v_slides,
      cta_label         = p_row->>'cta_label',
      cta_url           = p_row->>'cta_url',
      display           = p_row->>'display',
      blocking          = p_row->>'blocking',
      tone              = p_row->>'tone',
      audience          = p_row->>'audience',
      segment_key       = p_row->>'segment_key',
      repeat_after_days = (p_row->>'repeat_after_days')::int,
      is_active         = coalesce((p_row->>'is_active')::boolean, true),
      revision          = a.revision + CASE WHEN p_reshow IS TRUE THEN 1 ELSE 0 END,
      updated_by        = v_caller
    WHERE a.id = p_id
    RETURNING a.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'announcement not found' USING ERRCODE = '22023';
    END IF;
  END IF;

  DELETE FROM public.portal_announcement_tenants pt WHERE pt.announcement_id = v_id;
  IF v_audience = 'selected' THEN
    INSERT INTO public.portal_announcement_tenants (announcement_id, tenant_id)
    SELECT DISTINCT v_id, u.tenant_id FROM unnest(p_tenant_ids) AS u(tenant_id);
  END IF;

  RETURN v_id;
END $$;

-- Persist a drag. p_ids must be EVERY announcement of p_kind exactly once, in
-- display order (System: all Hard in section order, then all Soft), so a stale
-- or partial list from a second browser tab is refused instead of leaving
-- colliding or half-applied positions.
DROP FUNCTION IF EXISTS public.admin_reorder_portal_announcements(text, uuid[]);
CREATE FUNCTION public.admin_reorder_portal_announcements(p_kind text, p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- public.is_super_admin(), inlined: see admin_save_portal_announcement.
  IF NOT coalesce((SELECT au.is_super_admin FROM public.app_users au WHERE au.auth_user_id = auth.uid() LIMIT 1), false) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('feature', 'system') THEN
    RAISE EXCEPTION 'unknown announcement kind' USING ERRCODE = '22023';
  END IF;
  IF p_ids IS NULL THEN
    RAISE EXCEPTION 'announcement ids are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS u(id) WHERE u.id IS NULL) THEN
    RAISE EXCEPTION 'announcement ids cannot be null' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT u.id) FROM unnest(p_ids) AS u(id)) <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'duplicate announcement id' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_ids) <> (SELECT count(*) FROM public.portal_announcements a WHERE a.kind = p_kind) THEN
    RAISE EXCEPTION 'send every announcement of this kind, in order' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_ids) AS u(id)
             WHERE NOT EXISTS (SELECT 1 FROM public.portal_announcements a WHERE a.id = u.id AND a.kind = p_kind)) THEN
    RAISE EXCEPTION 'announcement is not of this kind' USING ERRCODE = '22023';
  END IF;

  UPDATE public.portal_announcements AS a
  SET sort_order = (o.ord * 10)::integer
  FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
  WHERE a.id = o.id;
END $$;

-- "Who matches this smart filter right now", for the editor's live match list.
-- Every status: the admin labels suspended tenants as unreachable.
DROP FUNCTION IF EXISTS public.admin_portal_announcement_segment_tenants(text);
CREATE FUNCTION public.admin_portal_announcement_segment_tenants(p_segment_key text)
RETURNS TABLE (tenant_id uuid, slug text, company_name text, status text, tenant_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- public.is_super_admin(), inlined: see admin_save_portal_announcement.
  IF NOT coalesce((SELECT au.is_super_admin FROM public.app_users au WHERE au.auth_user_id = auth.uid() LIMIT 1), false) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_segment_key IS NULL
     OR p_segment_key NOT IN ('stripe_connect_not_connected', 'bonzah_not_active', 'uae_migration_pending') THEN
    RAISE EXCEPTION 'unknown smart filter' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT t.id, t.slug, t.company_name, t.status, t.tenant_type
  FROM public.tenants t
  WHERE public.portal_announcement_segment_match(t.id, p_segment_key)
  ORDER BY t.company_name, t.id;
END $$;

-- Reach per announcement (active or not), for the admin list.
--   audience_tenants   tenants the audience matches right now, any status
--   reachable_tenants  of those, status 'active' (the only portals that load)
--   *_users            distinct app_users with that timestamp set (any revision)
--
-- WHO IS COUNTED. The first six user/tenant columns (shown_users ... cta_users)
-- EXCLUDE super admins: support sessions share one Global Master Admin row and
-- would inflate adoption. Their state is still stored so support is not re-shown
-- every item on every load.
-- The columns after them were APPENDED on Sep 17 2026: until then every view in
-- production was a super admin's, so the admin list read "Seen by 0 users" for
-- items people had plainly seen. The list now shows everyone and says how many
-- of them were super admins:
--   *_all_*            everyone, super admins included
--   *_super_admin_*    the super-admin part of the matching *_all_* column
-- For every user column, *_all_users = <old column> + <super-admin part>
-- (is_super_admin IS TRUE vs IS NOT TRUE splits app_users exactly; suite T13).
-- shown_all_tenants counts distinct tenants anyone saw it in, so a super admin
-- who looked at it in a tenant no staff member has opened adds that tenant.
--
-- The columns are in RETURNS TABLE order = AdminAnnouncementStats in the
-- contract; the admin reads them by name. A RETURNS TABLE change cannot be made
-- with CREATE OR REPLACE, hence DROP + CREATE; DROP also removes the grants, so
-- section 5's REVOKE FROM PUBLIC, anon / GRANT EXECUTE TO authenticated,
-- service_role must run in the same transaction (this file does both).
DROP FUNCTION IF EXISTS public.admin_portal_announcement_stats();
CREATE FUNCTION public.admin_portal_announcement_stats()
RETURNS TABLE (
  announcement_id           uuid,
  audience_tenants          integer,
  reachable_tenants         integer,
  shown_users               integer,
  shown_tenants             integer,
  card_opened_users         integer,
  dismissed_users           integer,
  dont_show_again_users     integer,
  cta_users                 integer,
  shown_all_users           integer,
  shown_all_tenants         integer,
  shown_super_admin_users   integer,
  card_opened_all_users     integer,
  dismissed_all_users       integer,
  cta_all_users             integer,
  cta_super_admin_users     integer,
  dont_show_again_all_users integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- public.is_super_admin(), inlined: see admin_save_portal_announcement.
  IF NOT coalesce((SELECT au.is_super_admin FROM public.app_users au WHERE au.auth_user_id = auth.uid() LIMIT 1), false) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    (SELECT count(*) FROM public.tenants t
      WHERE public.portal_announcement_targets(a.id, t.id))::integer,
    (SELECT count(*) FROM public.tenants t
      WHERE t.status = 'active' AND public.portal_announcement_targets(a.id, t.id))::integer,
    coalesce(u.n_shown, 0),
    coalesce(u.n_shown_tenants, 0),
    coalesce(u.n_card_opened, 0),
    coalesce(u.n_dismissed, 0),
    coalesce(u.n_dont_show_again, 0),
    coalesce(u.n_cta, 0),
    coalesce(u.n_shown_all, 0),
    coalesce(u.n_shown_tenants_all, 0),
    coalesce(u.n_shown_super, 0),
    coalesce(u.n_card_opened_all, 0),
    coalesce(u.n_dismissed_all, 0),
    coalesce(u.n_cta_all, 0),
    coalesce(u.n_cta_super, 0),
    coalesce(u.n_dont_show_again_all, 0)
  FROM public.portal_announcements a
  LEFT JOIN LATERAL (
    SELECT
      -- Staff only (the original columns).
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.first_shown_at IS NOT NULL     AND NOT u2.is_super))::integer AS n_shown,
      (count(DISTINCT s.tenant_id)   FILTER (WHERE s.first_shown_at IS NOT NULL     AND NOT u2.is_super))::integer AS n_shown_tenants,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.card_opened_at IS NOT NULL     AND NOT u2.is_super))::integer AS n_card_opened,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.dismissed_at IS NOT NULL       AND NOT u2.is_super))::integer AS n_dismissed,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.dont_show_again_at IS NOT NULL AND NOT u2.is_super))::integer AS n_dont_show_again,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.cta_clicked_at IS NOT NULL     AND NOT u2.is_super))::integer AS n_cta,
      -- Everyone.
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.first_shown_at IS NOT NULL))::integer     AS n_shown_all,
      (count(DISTINCT s.tenant_id)   FILTER (WHERE s.first_shown_at IS NOT NULL))::integer     AS n_shown_tenants_all,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.card_opened_at IS NOT NULL))::integer     AS n_card_opened_all,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.dismissed_at IS NOT NULL))::integer       AS n_dismissed_all,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.dont_show_again_at IS NOT NULL))::integer AS n_dont_show_again_all,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.cta_clicked_at IS NOT NULL))::integer     AS n_cta_all,
      -- Super admins only.
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.first_shown_at IS NOT NULL AND u2.is_super))::integer AS n_shown_super,
      (count(DISTINCT s.app_user_id) FILTER (WHERE s.cta_clicked_at IS NOT NULL AND u2.is_super))::integer AS n_cta_super
    FROM public.portal_announcement_user_state s
    JOIN public.app_users au ON au.id = s.app_user_id
    CROSS JOIN LATERAL (SELECT au.is_super_admin IS TRUE AS is_super) u2
    WHERE s.announcement_id = a.id
  ) u ON true
  ORDER BY (a.kind = 'system') DESC, (a.blocking = 'hard') DESC, a.sort_order, a.created_at, a.id;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. RLS, GRANTS
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.portal_announcements           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_announcement_tenants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_announcement_user_state ENABLE ROW LEVEL SECURITY;

-- No tenant-staff policy on any of the three: staff go through the RPCs.
DROP POLICY IF EXISTS portal_announcements_super_admin_all ON public.portal_announcements;
CREATE POLICY portal_announcements_super_admin_all ON public.portal_announcements
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS portal_announcements_service_all ON public.portal_announcements;
CREATE POLICY portal_announcements_service_all ON public.portal_announcements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS portal_announcement_tenants_super_admin_all ON public.portal_announcement_tenants;
CREATE POLICY portal_announcement_tenants_super_admin_all ON public.portal_announcement_tenants
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS portal_announcement_tenants_service_all ON public.portal_announcement_tenants;
CREATE POLICY portal_announcement_tenants_service_all ON public.portal_announcement_tenants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- State is written only by record_portal_announcement_event.
DROP POLICY IF EXISTS portal_announcement_user_state_super_admin_read ON public.portal_announcement_user_state;
CREATE POLICY portal_announcement_user_state_super_admin_read ON public.portal_announcement_user_state
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS portal_announcement_user_state_service_all ON public.portal_announcement_user_state;
CREATE POLICY portal_announcement_user_state_service_all ON public.portal_announcement_user_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.portal_announcements, public.portal_announcement_tenants, public.portal_announcement_user_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_announcements, public.portal_announcement_tenants TO authenticated;
GRANT SELECT ON public.portal_announcement_user_state TO authenticated;
GRANT ALL ON public.portal_announcements, public.portal_announcement_tenants, public.portal_announcement_user_state TO service_role;

REVOKE ALL ON FUNCTION public.portal_announcement_slides_valid(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_announcement_slides_valid(jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.portal_announcements_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_announcements_before_update() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.portal_announcement_segment_match(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_announcement_caller(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_announcement_targets(uuid, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_announcement_applies(uuid, uuid)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_announcement_segment_match(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_announcement_caller(uuid)              TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_announcement_targets(uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_announcement_applies(uuid, uuid)       TO service_role;

REVOKE ALL ON FUNCTION public.get_portal_announcements(uuid, text[])                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_portal_announcement_event(uuid, uuid, text)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_portal_announcement(uuid, jsonb, uuid[], boolean)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reorder_portal_announcements(text, uuid[])                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_portal_announcement_segment_tenants(text)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_portal_announcement_stats()                               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_portal_announcements(uuid, text[])                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_portal_announcement_event(uuid, uuid, text)           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_portal_announcement(uuid, jsonb, uuid[], boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reorder_portal_announcements(text, uuid[])             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_portal_announcement_segment_tenants(text)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_portal_announcement_stats()                            TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. STORAGE: card and slide illustrations
-- ═════════════════════════════════════════════════════════════════════════════
-- A NEW bucket rather than the old one: the old bucket's public flag and
-- policies exist only in production and could not be verified. Anyone can load
-- an image by its public URL (the portal renders plain <img> tags); only super
-- admins list or write. PNG/JPEG/WebP only,
-- never SVG (script-capable in a public bucket); 2 MB = IMAGE_MAX_BYTES. Object
-- paths are feature/{card|slide}/{uuid}.{png|jpg|webp}, which is the only URL
-- shape the CHECKs above accept. Shape mirrors
-- supabase/migrations/20260502191209_add_admin_todos.sql:93-109.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-announcement-media', 'portal-announcement-media', true, 2097152, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Read is scoped to super admins, unlike the todo-images precedent. Storage
-- serves /object/public/... for a public bucket as its own superuser, without
-- RLS, so images render for everyone regardless. The SELECT policy is only
-- needed by the uploader (upload is INSERT ... RETURNING, remove() a DELETE
-- that reads the rows); unscoped, it would let anyone holding the public anon
-- key list every object name, including art for unsaved and inactive items.
DROP POLICY IF EXISTS portal_announcement_media_read ON storage.objects;
CREATE POLICY portal_announcement_media_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'portal-announcement-media' AND public.is_super_admin());

DROP POLICY IF EXISTS portal_announcement_media_insert ON storage.objects;
CREATE POLICY portal_announcement_media_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'portal-announcement-media' AND public.is_super_admin());

DROP POLICY IF EXISTS portal_announcement_media_update ON storage.objects;
CREATE POLICY portal_announcement_media_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'portal-announcement-media' AND public.is_super_admin())
  WITH CHECK (bucket_id = 'portal-announcement-media' AND public.is_super_admin());

DROP POLICY IF EXISTS portal_announcement_media_delete ON storage.objects;
CREATE POLICY portal_announcement_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'portal-announcement-media' AND public.is_super_admin());

COMMENT ON TABLE public.portal_announcements IS
  'Super-admin announcements for tenant portal staff: feature cards (v2 dashboard) and system dialogs/banners (every portal). Authored at /admin/announcements. Not read by the booking app.';
COMMENT ON TABLE public.portal_announcement_tenants IS
  'Target tenants of portal_announcements rows with audience = ''selected''.';
COMMENT ON TABLE public.portal_announcement_user_state IS
  'Per app_user per tenant view/dismissal state for portal_announcements. Written only by record_portal_announcement_event.';

-- New RPCs must be callable the moment this commits. Supabase's DDL watcher
-- normally reloads PostgREST's schema cache on its own; this makes it explicit
-- (delivered on COMMIT), so the admin page never reports PGRST202 "not installed"
-- for a file that is in fact applied.
NOTIFY pgrst, 'reload schema';

COMMIT;
