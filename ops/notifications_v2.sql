-- notifications_v2 — storage behind the v2 Settings → Notifications page
-- (northwind canary only; the gate lives in the portal, not here).
--
--   tenant_notification_settings  one row per (tenant, notification, channel):
--                                 on/off plus the tenant's own template. A NULL
--                                 column means "use the catalog default"; a
--                                 missing row means "all defaults"; Reset is a
--                                 DELETE. The catalog itself lives in code
--                                 (apps/portal/src/lib/notifications-v2/catalog.ts).
--   tenant_email_sender           one row per tenant: display name, the part
--                                 before @drive-247.com, and an optional reply-to.
--   notification_test_sends_v2    one row per Send test, written by the
--                                 notification-test-v2 edge function. It is the
--                                 rate limit (20 per user per rolling hour) and
--                                 the audit trail of who sent what to whom.
--
-- Spec: docs/notifications-v2/build-spec.md (D11, D13, D18) and the shared
-- contract apps/portal/src/lib/notifications-v2/types.ts. Readers and writers:
--   apps/portal/src/hooks/use-notification-settings-v2.ts
--   apps/portal/src/hooks/use-email-sender-v2.ts
--   supabase/functions/notification-test-v2/index.ts
-- The TypeScript twin of every limit below is
-- apps/portal/src/lib/notifications-v2/settings-model.ts (EMAIL_SUBJECT_MAX,
-- PUSH_TITLE_MAX, PUSH_BODY_MAX, IN_APP_*_MAX, LOCAL_PART_PATTERN,
-- isValidLocalPart). Change one, change both.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- STATUS: NOT APPLIED
-- ═════════════════════════════════════════════════════════════════════════════
-- Written on Sep 19 2026 and NOT applied to any database. Production writes are
-- the lead's (build-spec "What needs approval before it goes live", item 1).
-- Apply it deliberately, as ONE request, with someone watching, then replace
-- this note with the date and the read-only VERIFY results:
--
--   1. Run the PRE-FLIGHT queries below (read-only) and compare with "expect".
--   2. Send this whole file as one query through the Management API. The file
--      carries its own BEGIN/COMMIT, so a failure anywhere rolls all of it back:
--
--        jq -Rs '{query: .}' ops/notifications_v2.sql > /tmp/nv2.json
--        curl -sS -X POST \
--          "https://api.supabase.com/v1/projects/hviqoaokxvlancmftwuo/database/query" \
--          -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--          -H "Content-Type: application/json" \
--          --data @/tmp/nv2.json
--
--      (Same endpoint as scripts/v1-check/shared.mjs. Staging is project
--      ksmreaadhbirzakkxqrq: apply there first if you want a dress rehearsal.)
--   3. Run the VERIFY queries at the bottom (read-only).
--   4. Regenerate the Supabase types into all three apps (CLAUDE.md), so the
--      three tables stop being `any` in the portal.
--
-- Shipping the code first is safe:
--   * the portal hooks treat a missing table (PostgREST PGRST205, Postgres
--     42P01) as "not switched on yet": the page shows every catalog default and
--     Save says storage is not on yet, instead of failing;
--   * notification-test-v2 allows the send and logs a warning when
--     notification_test_sends_v2 is missing (no rate limit until this runs).
-- Nothing sends real notifications from these tables yet (D18): live sending
-- keeps running exactly as today until the runtime phase is approved.
--
-- TESTED (Sep 19 2026), not applied: a PGlite suite (Postgres in WASM) applies
-- a Supabase-shaped stub, then this file TWICE as a non-superuser owner, and
-- checks 94 cases: grants (anon nothing, no TRUNCATE), tenant isolation for
-- admin / viewer / manager with and without the editor grant / ops / inactive
-- staff / renter / super admin, upsert ON CONFLICT under RLS, updated_by
-- stamping, every CHECK boundary, the slug rule, and that the triggers sit only
-- on the new tables. It lives in the session scratchpad, not the repo:
--   SP=/tmp/claude-1000/-home-haseeb-raza-Desktop-drive-247/2834209e-b75e-4bfa-8bb7-fbfd9c489c55/scratchpad/nv2sql
--   cd $SP && npm i @electric-sql/pglite@0.3 && node run.mjs      # exit 0 = all pass
-- Static checks that do live in the repo:
--   apps/portal/src/__tests__/lib/notifications-v2-sql.test.ts
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE ONLY (V2_PLAN §4, §6)
--
-- Creates: 3 tables, their CHECKs, 3 indexes, 2 trigger functions, 3 triggers
-- (all on the NEW tables), RLS policies on the new tables, grants.
-- Changes nothing that exists:
--   * no ALTER on any existing table, no column on public.tenants (anon column
--     grants: a grantless new column blanks every booking site), no trigger on
--     any pre-existing table, no change to any existing function or policy;
--   * email_templates, email_notification_prefs, lockbox_templates, org_settings,
--     notifications, push_* are untouched. v1 does not know these tables exist.
-- Re-running is harmless: IF NOT EXISTS, CREATE OR REPLACE, or DROP-then-CREATE
-- on objects only this file creates. A re-run does NOT alter the CHECKs of a
-- table that already exists: change those with an explicit ALTER. Target PG15.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHO CAN DO WHAT
--
--   anon            nothing (no table privilege, no EXECUTE).
--   authenticated   includes RENTERS (booking customer auth). Rows are reached
--                   only through the staff predicate, which needs an ACTIVE
--                   app_users row for the row's tenant, so a renter (no
--                   app_users row) sees and writes nothing.
--     read          active staff of the tenant, any role; or a super admin.
--     write         active staff of the tenant except `viewer`; a `manager`
--                   only with editor on `settings.reminders` (labelled
--                   "Notifications" in lib/permissions.ts; the same grant
--                   send-push and notification-test-v2 check); or a super admin.
--     test sends    read only (own tenant). Writes are service_role only: the
--                   edge function is the one writer, so the rate limit cannot
--                   be reset from a browser.
--   service_role    everything.
--
-- The staff predicate reads app_users directly and deliberately does NOT use
-- public.get_user_tenant_id(): one of its two repo bodies trusts
-- user_metadata.impersonated_tenant_id, which any signed-in user can write
-- (ops/tenant_notes.sql header). It runs as the caller, so it relies on the
-- caller being able to read their OWN app_users row (app_users_select_policy:
-- auth.uid() = auth_user_id) and their OWN manager_permissions rows ("Users can
-- read own permissions", 20260214100001). Pre-flight query 5 checks both.
--
-- RLS is the second lock, not the first (V2_PLAN §5): every portal query also
-- filters .eq('tenant_id', tenant.id), and the edge function resolves the
-- tenant from the caller's own app_users row.
--
-- Grants follow ops/portal_announcements.sql: REVOKE ALL first (Supabase's
-- default privileges hand `authenticated` TRUNCATE, which ignores RLS), then
-- explicit grants. Trigger functions revoke EXECUTE from PUBLIC, anon and
-- authenticated (a trigger does not need it).
--
-- ═════════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT (read-only; run before applying)
-- ═════════════════════════════════════════════════════════════════════════════
--   -- 1. server and encoding
--   SELECT current_setting('server_version'), current_setting('server_encoding');   -- 15.x, UTF8
--
--   -- 2. the names are free
--   SELECT to_regclass('public.tenant_notification_settings'),
--          to_regclass('public.tenant_email_sender'),
--          to_regclass('public.notification_test_sends_v2');                      -- all NULL
--   SELECT proname FROM pg_proc
--    WHERE pronamespace = 'public'::regnamespace
--      AND proname IN ('notifications_v2_stamp', 'tenant_email_sender_guard');     -- 0 rows
--
--   -- 3. the columns the policies and triggers read exist, with these types
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND ((table_name = 'app_users' AND column_name IN ('id','auth_user_id','tenant_id','is_active','role','is_super_admin'))
--        OR (table_name = 'manager_permissions' AND column_name IN ('app_user_id','tab_key','access_level'))
--        OR (table_name = 'tenants' AND column_name IN ('id','slug')))
--    ORDER BY 1, 2;                                                               -- 11 rows
--
--   -- 4. is_super_admin() exists and reads app_users (either repo body works)
--   SELECT pg_get_functiondef('public.is_super_admin()'::regprocedure);
--
--   -- 5. a caller can read their OWN app_users and manager_permissions rows
--   --    (the staff predicate runs as the caller). Expect RLS on for both and a
--   --    SELECT policy whose qual includes auth.uid() = auth_user_id / the
--   --    caller's own app_user_id. If app_users RLS is OFF, reads are open and
--   --    the predicate still works.
--   SELECT c.relname, c.relrowsecurity FROM pg_class c
--    WHERE c.oid IN ('public.app_users'::regclass, 'public.manager_permissions'::regclass);
--   SELECT tablename, policyname, cmd, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('app_users','manager_permissions')
--      AND cmd IN ('SELECT','ALL');
--
--   -- 6. the manager grant this file names really is the Notifications key
--   SELECT tab_key, access_level, count(*) FROM public.manager_permissions
--    WHERE tab_key = 'settings.reminders' GROUP BY 1, 2;                          -- informational
--
--   -- 7. the default-privilege trap this file revokes against
--   SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl
--    WHERE defaclnamespace = 'public'::regnamespace;                              -- informational
--
--   -- 8. the canary exists (nothing here is keyed on it; informational)
--   SELECT id, slug, push_notifications_enabled FROM public.tenants WHERE slug = 'northwind';

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═════════════════════════════════════════════════════════════════════════════

-- Per notification, per channel. `notification_key` is the catalog key
-- (NotificationItem.key): snake_case, never renamed once shipped.
-- Limits are checked on the text with its ends trimmed, the way the page
-- counts (validateTemplate), plus a hard cap on the raw length so whitespace
-- cannot be used to store something huge.
CREATE TABLE IF NOT EXISTS public.tenant_notification_settings (
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  channel          text NOT NULL,
  -- NULL = the catalog's defaultEnabled.
  enabled          boolean,
  -- email only. NULL = the catalog default subject.
  subject          text,
  -- push / in_app only. NULL = the catalog default title.
  title            text,
  -- email: the editor's HTML (sanitised again at send time); push / in_app:
  -- plain text. NULL = the catalog default body.
  body             text,
  -- push only: the options that differ from the catalog default
  -- ({requireInteraction, silent, replacePrevious, openInApp}, booleans).
  push_options     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Stamped by notifications_v2_stamp() from the caller's session; a value sent
  -- by the browser is overwritten.
  updated_by       uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, notification_key, channel),
  CONSTRAINT tns_key          CHECK (notification_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT tns_channel      CHECK (channel IN ('email', 'push', 'in_app')),
  CONSTRAINT tns_subject      CHECK (subject IS NULL OR (
                                     channel = 'email'
                                 AND subject !~ '[\x0A\x0D]'
                                 AND char_length(btrim(subject, E' \t')) <= 200
                                 AND char_length(subject) <= 1000)),
  CONSTRAINT tns_title        CHECK (title IS NULL OR (
                                     channel IN ('push', 'in_app')
                                 AND char_length(btrim(title, E' \t\r\n')) <= 100
                                 AND char_length(title) <= 1000)),
  CONSTRAINT tns_body         CHECK (body IS NULL OR CASE channel
                                   WHEN 'email'  THEN octet_length(body) <= 102400
                                   WHEN 'push'   THEN char_length(btrim(body, E' \t\r\n')) <= 300 AND char_length(body) <= 3000
                                   WHEN 'in_app' THEN char_length(btrim(body, E' \t\r\n')) <= 500 AND char_length(body) <= 5000
                                   ELSE false END),
  -- An object, {} off the push channel, only the four known keys, each a
  -- boolean. The CASE guards `-`, which raises on a non-object.
  CONSTRAINT tns_push_options CHECK (CASE WHEN jsonb_typeof(push_options) = 'object' THEN
                                     (channel = 'push' OR push_options = '{}'::jsonb)
                                 AND (push_options - 'requireInteraction' - 'silent' - 'replacePrevious' - 'openInApp') = '{}'::jsonb
                                 AND coalesce(jsonb_typeof(push_options -> 'requireInteraction'), 'boolean') = 'boolean'
                                 AND coalesce(jsonb_typeof(push_options -> 'silent'), 'boolean') = 'boolean'
                                 AND coalesce(jsonb_typeof(push_options -> 'replacePrevious'), 'boolean') = 'boolean'
                                 AND coalesce(jsonb_typeof(push_options -> 'openInApp'), 'boolean') = 'boolean'
                                 ELSE false END)
);

-- Sender identity. The domain is fixed (@drive-247.com, the only domain
-- verified with Resend today), so only the part before the @ is stored. That
-- part must be the tenant's slug or start with it (tenant_email_sender_guard),
-- so one tenant cannot send as another. No CC: the lead said to leave CC alone
-- (D13).
CREATE TABLE IF NOT EXISTS public.tenant_email_sender (
  tenant_id       uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- NULL = tenants.company_name.
  from_name       text,
  -- NULL = tenants.slug. e.g. 'coastline', 'coastline.bookings'.
  from_local_part text,
  -- NULL = no Reply-To header.
  reply_to        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT tes_from_name       CHECK (from_name IS NULL OR (
                                        char_length(btrim(from_name)) BETWEEN 1 AND 100
                                    AND from_name !~ '[\x01-\x1F\x7F]')),
  -- TS twin: LOCAL_PART_PATTERN plus isValidLocalPart's "no '..', no trailing '.'".
  CONSTRAINT tes_from_local_part CHECK (from_local_part IS NULL OR (
                                        from_local_part ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
                                    AND strpos(from_local_part, '..') = 0
                                    AND right(from_local_part, 1) <> '.')),
  -- TS twin: isValidEmail (one plausible address; no spaces, commas or brackets).
  CONSTRAINT tes_reply_to        CHECK (reply_to IS NULL OR (
                                        char_length(reply_to) <= 254
                                    AND reply_to ~ '^[^]\s@<>"''(),;:\\[]+@[^]\s@<>"''(),;:\\[]+\.[^]\s@<>"''(),;:\\[]{2,}$'))
);

-- One row per Send test that reached the send step (validation and rate-limit
-- rejections are not logged, so a locked-out user cannot extend their own
-- lockout). Written only by the notification-test-v2 edge function.
CREATE TABLE IF NOT EXISTS public.notification_test_sends_v2 (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_user_id      uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  notification_key text NOT NULL,
  channel          text NOT NULL,
  -- email: the address it went to. push: NULL (always the sender's own devices).
  recipient        text,
  status           text NOT NULL,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ntsv2_key       CHECK (notification_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT ntsv2_channel   CHECK (channel IN ('email', 'push')),
  CONSTRAINT ntsv2_status    CHECK (status IN ('sent', 'failed', 'no_devices')),
  CONSTRAINT ntsv2_recipient CHECK (recipient IS NULL OR char_length(recipient) <= 254),
  CONSTRAINT ntsv2_error     CHECK (error IS NULL OR char_length(error) <= 1000)
);

-- The rate-limit scan: this user's sends in the last hour.
CREATE INDEX IF NOT EXISTS notification_test_sends_v2_user_created_idx
  ON public.notification_test_sends_v2 (app_user_id, created_at DESC);
-- A tenant's recent test sends (support, audit).
CREATE INDEX IF NOT EXISTS notification_test_sends_v2_tenant_created_idx
  ON public.notification_test_sends_v2 (tenant_id, created_at DESC);
-- The pages read a tenant's rows by the PK prefix (tenant_id); the email sender
-- is keyed on tenant_id. No other index is needed.

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. TRIGGERS (on the NEW tables only)
-- ═════════════════════════════════════════════════════════════════════════════

-- updated_at, and updated_by from the caller's own session (never a value the
-- browser sent). A service_role or SQL-editor write has no auth.uid() and keeps
-- whatever updated_by it names. Stamped here rather than by the shared
-- set_updated_at(), so this file depends on nothing it does not create.
-- SECURITY DEFINER so the app_users lookup does not depend on app_users' RLS.
CREATE OR REPLACE FUNCTION public.notifications_v2_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_actor uuid;
BEGIN
  NEW.updated_at := now();
  IF v_uid IS NOT NULL THEN
    SELECT au.id INTO v_actor FROM public.app_users au WHERE au.auth_user_id = v_uid LIMIT 1;
    NEW.updated_by := v_actor;
  END IF;
  RETURN NEW;
END $$;

-- The sender's local part must be the tenant's slug, or the slug followed by
-- '.' or '_' and something more (coastline, coastline.bookings,
-- coastline_team). Never '-': slugs contain dashes, so tenant 'open' could
-- otherwise take 'open-bay', the default address of tenant 'open-bay'; '.' and '_'
-- cannot appear in a slug, so no two tenants' addresses can overlap. A CHECK
-- cannot read tenants, so this does. TS twin:
-- isValidLocalPart. Raises 23514 (check_violation), which the portal hook turns
-- into a plain sentence. The edge function re-checks at send time and falls
-- back to the slug, so a later slug rename cannot make a stored value send as
-- someone else.
CREATE OR REPLACE FUNCTION public.tenant_email_sender_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_slug text;
  v_len  integer;
BEGIN
  IF NEW.from_local_part IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT lower(btrim(t.slug)) INTO v_slug FROM public.tenants t WHERE t.id = NEW.tenant_id;
  v_len := char_length(coalesce(v_slug, ''));
  IF v_len = 0 OR NOT (
       NEW.from_local_part = v_slug
    OR (    left(NEW.from_local_part, v_len) = v_slug
        AND substr(NEW.from_local_part, v_len + 1, 1) IN ('.', '_')
        AND char_length(NEW.from_local_part) > v_len + 1)
  ) THEN
    RAISE EXCEPTION 'from_local_part must be the tenant slug or start with it'
      USING ERRCODE = '23514', CONSTRAINT = 'tes_from_local_part_slug';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tns_stamp ON public.tenant_notification_settings;
CREATE TRIGGER tns_stamp BEFORE INSERT OR UPDATE ON public.tenant_notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.notifications_v2_stamp();

DROP TRIGGER IF EXISTS tes_guard ON public.tenant_email_sender;
CREATE TRIGGER tes_guard BEFORE INSERT OR UPDATE ON public.tenant_email_sender
  FOR EACH ROW EXECUTE FUNCTION public.tenant_email_sender_guard();

DROP TRIGGER IF EXISTS tes_stamp ON public.tenant_email_sender;
CREATE TRIGGER tes_stamp BEFORE INSERT OR UPDATE ON public.tenant_email_sender
  FOR EACH ROW EXECUTE FUNCTION public.notifications_v2_stamp();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. RLS
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tenant_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_email_sender          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_test_sends_v2   ENABLE ROW LEVEL SECURITY;

-- ── tenant_notification_settings ────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_notification_settings_staff_read ON public.tenant_notification_settings;
CREATE POLICY tenant_notification_settings_staff_read ON public.tenant_notification_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_notification_settings.tenant_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_notification_settings_staff_insert ON public.tenant_notification_settings;
CREATE POLICY tenant_notification_settings_staff_insert ON public.tenant_notification_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_notification_settings.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_notification_settings_staff_update ON public.tenant_notification_settings;
CREATE POLICY tenant_notification_settings_staff_update ON public.tenant_notification_settings
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_notification_settings.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_notification_settings.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_notification_settings_staff_delete ON public.tenant_notification_settings;
CREATE POLICY tenant_notification_settings_staff_delete ON public.tenant_notification_settings
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_notification_settings.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_notification_settings_service_all ON public.tenant_notification_settings;
CREATE POLICY tenant_notification_settings_service_all ON public.tenant_notification_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── tenant_email_sender ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_email_sender_staff_read ON public.tenant_email_sender;
CREATE POLICY tenant_email_sender_staff_read ON public.tenant_email_sender
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_email_sender.tenant_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_email_sender_staff_insert ON public.tenant_email_sender;
CREATE POLICY tenant_email_sender_staff_insert ON public.tenant_email_sender
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_email_sender.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_email_sender_staff_update ON public.tenant_email_sender;
CREATE POLICY tenant_email_sender_staff_update ON public.tenant_email_sender
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_email_sender.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_email_sender.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_email_sender_staff_delete ON public.tenant_email_sender;
CREATE POLICY tenant_email_sender_staff_delete ON public.tenant_email_sender
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = tenant_email_sender.tenant_id
               AND au.role <> 'viewer'
               AND (au.role <> 'manager' OR EXISTS (
                     SELECT 1 FROM public.manager_permissions mp
                      WHERE mp.app_user_id = au.id
                        AND mp.tab_key = 'settings.reminders'
                        AND mp.access_level = 'editor')))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS tenant_email_sender_service_all ON public.tenant_email_sender;
CREATE POLICY tenant_email_sender_service_all ON public.tenant_email_sender
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── notification_test_sends_v2: staff read their tenant's; nobody else writes ──
DROP POLICY IF EXISTS notification_test_sends_v2_staff_read ON public.notification_test_sends_v2;
CREATE POLICY notification_test_sends_v2_staff_read ON public.notification_test_sends_v2
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users au
             WHERE au.auth_user_id = auth.uid()
               AND au.is_active IS TRUE
               AND au.tenant_id = notification_test_sends_v2.tenant_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS notification_test_sends_v2_service_all ON public.notification_test_sends_v2;
CREATE POLICY notification_test_sends_v2_service_all ON public.notification_test_sends_v2
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. GRANTS
-- ═════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON public.tenant_notification_settings, public.tenant_email_sender, public.notification_test_sends_v2 FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_notification_settings, public.tenant_email_sender TO authenticated;
GRANT SELECT ON public.notification_test_sends_v2 TO authenticated;
GRANT ALL ON public.tenant_notification_settings, public.tenant_email_sender, public.notification_test_sends_v2 TO service_role;

REVOKE ALL ON FUNCTION public.notifications_v2_stamp()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_email_sender_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.tenant_notification_settings IS
  'Notifications v2 (canary): per tenant, per notification, per channel on/off and template. NULL column = catalog default (apps/portal/src/lib/notifications-v2/catalog.ts); no row = all defaults; reset = DELETE. Not read by any live sender yet (build-spec D18).';
COMMENT ON TABLE public.tenant_email_sender IS
  'Notifications v2 (canary): the tenant''s email sender. Address = from_local_part@drive-247.com (must start with the tenant slug); NULLs mean today''s default "{company_name} <{slug}@drive-247.com>". Not read by any live sender yet (build-spec D18).';
COMMENT ON TABLE public.notification_test_sends_v2 IS
  'Notifications v2: one row per Send test, written only by the notification-test-v2 edge function. Rate limit (20 per user per rolling hour) and audit trail.';

-- The portal reads these tables through PostgREST on the next request, so the
-- schema cache must already know them. Supabase's DDL watcher normally reloads
-- it; this makes it explicit (delivered on COMMIT).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY (read-only; run after applying)
-- ═════════════════════════════════════════════════════════════════════════════
--   -- 1. three tables, RLS on (all true)
--   SELECT c.relname, c.relrowsecurity FROM pg_class c
--    WHERE c.oid IN ('public.tenant_notification_settings'::regclass,
--                    'public.tenant_email_sender'::regclass,
--                    'public.notification_test_sends_v2'::regclass);
--
--   -- 2. the policies: 5 + 5 + 2 = 12 rows
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('tenant_notification_settings','tenant_email_sender','notification_test_sends_v2')
--    ORDER BY 1, 2;
--
--   -- 3. grants: anon nothing; authenticated reads all three but writes only
--   --    the two settings tables (expect: f f f | t t t | t t f | f f)
--   SELECT has_table_privilege('anon','public.tenant_notification_settings','SELECT')          AS anon_tns,
--          has_table_privilege('anon','public.tenant_email_sender','SELECT')                   AS anon_tes,
--          has_table_privilege('anon','public.notification_test_sends_v2','SELECT')            AS anon_nts,
--          has_table_privilege('authenticated','public.tenant_notification_settings','SELECT') AS auth_tns_read,
--          has_table_privilege('authenticated','public.tenant_email_sender','SELECT')          AS auth_tes_read,
--          has_table_privilege('authenticated','public.notification_test_sends_v2','SELECT')   AS auth_nts_read,
--          has_table_privilege('authenticated','public.tenant_notification_settings','INSERT') AS auth_tns_write,
--          has_table_privilege('authenticated','public.tenant_email_sender','UPDATE')          AS auth_tes_write,
--          has_table_privilege('authenticated','public.notification_test_sends_v2','INSERT')   AS auth_nts_write,
--          has_table_privilege('authenticated','public.tenant_notification_settings','TRUNCATE') AS auth_truncate,
--          has_function_privilege('anon','public.notifications_v2_stamp()','EXECUTE')          AS anon_exec;
--
--   -- 4. the triggers sit on the new tables and nowhere else (3 rows)
--   SELECT tgrelid::regclass, tgname FROM pg_trigger
--    WHERE NOT tgisinternal
--      AND tgfoid IN ('public.notifications_v2_stamp()'::regprocedure,
--                     'public.tenant_email_sender_guard()'::regprocedure)
--    ORDER BY 1, 2;
--
--   -- 5. the CHECKs landed
--   SELECT conrelid::regclass, conname FROM pg_constraint
--    WHERE conrelid IN ('public.tenant_notification_settings'::regclass,
--                       'public.tenant_email_sender'::regclass,
--                       'public.notification_test_sends_v2'::regclass)
--      AND contype = 'c'
--    ORDER BY 1, 2;                                                   -- 6 + 3 + 5 = 14 rows
--
--   -- 6. empty, and PostgREST can see them (as anon: 401/permission denied;
--   --    as a signed-in northwind admin: 200 and [])
--   SELECT (SELECT count(*) FROM public.tenant_notification_settings) AS settings,
--          (SELECT count(*) FROM public.tenant_email_sender)          AS senders,
--          (SELECT count(*) FROM public.notification_test_sends_v2)   AS test_sends;
--
--   -- 7. optional rolled-back smoke test as a northwind staff user. Put their
--   --    auth.users id in the claims, check the row lands, then ROLL BACK:
--   --   BEGIN;
--   --   SET LOCAL ROLE authenticated;
--   --   SELECT set_config('request.jwt.claims', '{"sub":"<auth_user_id>","role":"authenticated"}', true);
--   --   INSERT INTO public.tenant_notification_settings (tenant_id, notification_key, channel, enabled)
--   --     SELECT id, 'smoke_test_key', 'email', true FROM public.tenants WHERE slug = 'northwind'
--   --     RETURNING tenant_id, updated_by;                           -- 1 row, updated_by = their app_users.id
--   --   ROLLBACK;
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (only if asked; nothing else depends on these objects)
-- ═════════════════════════════════════════════════════════════════════════════
--   Undeploy notification-test-v2 first (it writes notification_test_sends_v2),
--   then, in one transaction:
--   DROP TABLE IF EXISTS public.notification_test_sends_v2;
--   DROP TABLE IF EXISTS public.tenant_email_sender;
--   DROP TABLE IF EXISTS public.tenant_notification_settings;
--   DROP FUNCTION IF EXISTS public.tenant_email_sender_guard();
--   DROP FUNCTION IF EXISTS public.notifications_v2_stamp();
--   NOTIFY pgrst, 'reload schema';
--   The portal falls back to defaults on its own (missing table = defaults).
