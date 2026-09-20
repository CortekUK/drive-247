-- notifications_v2_platform — storage behind the SYSTEM set of Notifications v2,
-- the copy of the page that lives in the SUPER ADMIN dashboard (apps/admin).
--
-- The operator portal already has the main set (customer ↔ the rental company),
-- stored per tenant in ops/notifications_v2.sql. The lead asked for a second set
-- for ourselves (docs/notifications-v2/meeting-transcript-en.md §3.5, 07:30–08:30
-- and 16:39–16:48: "exactly the same thing we'll build for ourselves in the super
-- admin dashboard"), with three directions:
--     super admin → admin        we do something, the operator is told
--     admin → super admin        an operator does something, we are told
--     super admin → everyone     all operators AND all of their customers
--
--   platform_notification_settings  one row per (notification, channel): on/off
--                                   plus our own template. PLATFORM scope, so
--                                   unlike the tenant table there is NO
--                                   tenant_id — these settings are Drive247's,
--                                   the same for every tenant, and the primary
--                                   key is (notification_key, channel). A NULL
--                                   column means "use the catalog default", a
--                                   missing row means "all defaults", and Reset
--                                   is a DELETE. The catalog itself lives in
--                                   code (apps/admin/lib/notifications-v2/catalog.ts).
--
-- There is no platform sender table. A system email is from us and always goes
-- out as today's real platform sender, "Drive 247 <noreply@drive-247.com>"
-- (supabase/functions/_shared/resend-service.ts:324-325), so there is nothing
-- per-tenant to store and nothing an operator could impersonate.
--
-- Spec: docs/notifications-v2/build-spec.md and the admin's own contract
-- apps/admin/lib/notifications-v2/types.ts (PlatformNotificationSettingRow).
-- Readers and writers:
--   apps/admin/hooks/use-platform-notification-settings.ts
--   supabase/functions/notification-test-v2/index.ts   (scope: 'platform')
-- The TypeScript twin of every limit below is
-- apps/admin/lib/notifications-v2/settings-model.ts (EMAIL_SUBJECT_MAX,
-- IN_APP_TITLE_MAX, IN_APP_BODY_MAX, PUSH_OPTION_KEYS) and ./push-display.ts
-- (PUSH_TITLE_MAX, PUSH_BODY_MAX). They are the same numbers as the tenant
-- table's, deliberately: one page's worth of rules, two scopes. Change one,
-- change all three.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- STATUS: NOT APPLIED
-- ═════════════════════════════════════════════════════════════════════════════
-- Written on Sep 20 2026 and NOT applied to any database. Production writes are
-- the lead's (build-spec "What needs approval before it goes live"). Apply it
-- deliberately, as ONE request, with someone watching, then replace this note
-- with the date and the read-only VERIFY results:
--
--   1. Apply ops/notifications_v2.sql FIRST. This file is the second half of the
--      same ticket and REFUSES to run without it (see PRECONDITION below): it
--      hangs its trigger on that file's public.notifications_v2_stamp(), and the
--      platform Send test counts against that file's notification_test_sends_v2.
--   2. Run the PRE-FLIGHT queries below (read-only) and compare with "expect".
--   3. Send this whole file as one query through the Management API. The file
--      carries its own BEGIN/COMMIT, so a failure anywhere rolls all of it back:
--
--        jq -Rs '{query: .}' ops/notifications_v2_platform.sql > /tmp/nv2p.json
--        curl -sS -X POST \
--          "https://api.supabase.com/v1/projects/hviqoaokxvlancmftwuo/database/query" \
--          -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--          -H "Content-Type: application/json" \
--          --data @/tmp/nv2p.json
--
--      (Same endpoint as scripts/v1-check/shared.mjs. Staging is project
--      ksmreaadhbirzakkxqrq: apply there first if you want a dress rehearsal.)
--   4. Run the VERIFY queries at the bottom (read-only).
--   5. Regenerate the Supabase types into all three apps (CLAUDE.md).
--
-- Shipping the admin page code first is safe; shipping the TEST FUNCTION's
-- platform path first is not:
--   * the admin hook treats a missing table (PostgREST PGRST205, Postgres 42P01)
--     as "not switched on yet": the page shows every catalog default and Save
--     says storage is not on yet, instead of failing;
--   * notification-test-v2 FAILS CLOSED on the rate limit, and a platform test
--     send additionally needs the NULL tenant this file allows (below).
-- Nothing sends real notifications from this table yet (build-spec D18): live
-- sending keeps running exactly as today until the runtime phase is approved.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE ONLY (V2_PLAN §4, §6) — WITH ONE DELIBERATE EXCEPTION, FLAGGED HERE
--
-- Creates: 1 table, its CHECKs, 1 trigger (on the NEW table), RLS policies on
-- the new table, grants. No new function: the stamp trigger reuses
-- public.notifications_v2_stamp() from ops/notifications_v2.sql rather than
-- defining a second copy, so that function keeps exactly one owner.
--
-- THE EXCEPTION, the only statement here that touches an object this file did
-- not create:
--
--     ALTER TABLE public.notification_test_sends_v2 ALTER COLUMN tenant_id DROP NOT NULL;
--
-- Why it is needed: the platform Send test shares ONE rate-limit budget with the
-- tenant one (20 tests per user per rolling hour, counted by app_user_id in that
-- log table — notification-test-v2/rate-limit.ts). A platform test has no tenant
-- to name, so its log row carries tenant_id NULL, exactly as push_subscriptions
-- and push_notification_log already do for the platform audience (migration
-- 20260820140000_add_platform_activity_push.sql:21,28). A second log table would
-- give a super admin a second budget of 20, which is the opposite of the point.
--
-- Why it is safe:
--   * notification_test_sends_v2 does NOT EXIST in any database — it is created
--     by ops/notifications_v2.sql, which is also NOT APPLIED, by this same
--     ticket, days old. There are no rows and no readers to break.
--   * dropping NOT NULL only widens what the column accepts; every existing
--     statement, index, FK and policy keeps working unchanged.
--   * the FK to tenants is unaffected (a NULL FK is always satisfied), and the
--     table's read policy already handles it correctly: `au.tenant_id = <NULL>`
--     is never true, so tenant staff cannot see platform rows, and only the
--     policy's `OR public.is_super_admin()` branch can.
--   * it is guarded and re-runnable (it runs only while the column is NOT NULL).
-- If a reviewer would rather not widen that column, say so: the alternative is a
-- second log table plus a two-table rate-limit read, and a per-user budget that
-- is 20 + 20 instead of 20.
--
-- Changes nothing else that exists: no ALTER on any other table, no column on
-- public.tenants, no trigger on any pre-existing table, no change to any
-- existing function or policy. v1 does not know this table exists, and neither
-- does the operator portal: nothing in apps/portal reads or writes it.
-- Re-running is harmless: IF NOT EXISTS, or DROP-then-CREATE on objects only
-- this file creates. A re-run does NOT alter the CHECKs of a table that already
-- exists: change those with an explicit ALTER. Target PG15.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHO CAN DO WHAT
--
--   anon            nothing (no table privilege).
--   authenticated   includes RENTERS (booking customer auth) and every
--                   operator's staff. Rows are reached only through the super
--                   admin predicate, so all of them see and write NOTHING. This
--                   table is platform-level: there is no tenant scoping to do,
--                   and no operator has any business reading the templates we
--                   send them.
--     read/write    an ACTIVE super admin, and nobody else.
--   service_role    everything (the edge functions).
--
-- The predicate is `public.is_super_admin() AND <the caller's app_users row is
-- active>`. is_super_admin() is SECURITY DEFINER and reads app_users directly
-- (20251222150000_fix_super_admin_rls.sql), so it does not depend on app_users'
-- RLS — but it does NOT check is_active, and a deactivated account must not be
-- able to rewrite the templates we send to every operator. The EXISTS half runs
-- as the caller and so relies on them being able to read their OWN app_users row
-- (app_users_select_policy: auth.uid() = auth_user_id). Pre-flight query 5
-- checks that. Deliberately NOT get_user_tenant_id(): one of its two repo bodies
-- trusts user_metadata.impersonated_tenant_id, which any signed-in user can
-- write (ops/tenant_notes.sql header) — and there is no tenant here anyway.
--
-- RLS is the second lock, not the first (V2_PLAN §5): the admin hook only runs
-- inside the super-admin dashboard, and the edge function re-checks
-- app_users.is_super_admin itself before it sends a platform test.
--
-- Grants follow ops/notifications_v2.sql: REVOKE ALL first (Supabase's default
-- privileges hand `authenticated` TRUNCATE, which ignores RLS), then explicit
-- grants.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT (read-only; run before applying)
-- ═════════════════════════════════════════════════════════════════════════════
--   -- 1. server and encoding
--   SELECT current_setting('server_version'), current_setting('server_encoding');   -- 15.x, UTF8
--
--   -- 2. the name is free
--   SELECT to_regclass('public.platform_notification_settings');                    -- NULL
--
--   -- 3. ops/notifications_v2.sql HAS been applied (this file's precondition):
--   --    the stamp function and the test-send log both exist
--   SELECT to_regprocedure('public.notifications_v2_stamp()'),
--          to_regclass('public.notification_test_sends_v2');                        -- both NOT NULL
--
--   -- 4. the column this file widens, and what it holds today
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'notification_test_sends_v2'
--      AND column_name = 'tenant_id';                                               -- 'NO' (becomes 'YES')
--   SELECT count(*) FROM public.notification_test_sends_v2;                         -- expect 0
--
--   -- 5. the caller can read their OWN app_users row (the active-account half of
--   --    the policy runs as the caller). Expect a SELECT policy whose qual
--   --    includes auth.uid() = auth_user_id. If app_users RLS is OFF, reads are
--   --    open and the predicate still works.
--   SELECT c.relname, c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.app_users'::regclass;
--   SELECT tablename, policyname, cmd, roles, qual FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'app_users' AND cmd IN ('SELECT','ALL');
--
--   -- 6. is_super_admin() exists and reads app_users (either repo body works)
--   SELECT pg_get_functiondef('public.is_super_admin()'::regprocedure);
--
--   -- 7. who this table will be writable by at all
--   SELECT id, email, is_active FROM public.app_users
--    WHERE is_super_admin IS TRUE ORDER BY is_active DESC, email;                   -- informational
--
--   -- 8. the default-privilege trap this file revokes against
--   SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl
--    WHERE defaclnamespace = 'public'::regnamespace;                                -- informational

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0. PRECONDITION: ops/notifications_v2.sql first
-- ═════════════════════════════════════════════════════════════════════════════
-- Applying this file alone would leave the platform page half-built: its rows
-- would never be stamped with who changed them, and its Send test would refuse
-- every request (no counter table = fail closed). Refusing here, inside the
-- transaction, leaves the database exactly as it was.
DO $$
BEGIN
  IF to_regprocedure('public.notifications_v2_stamp()') IS NULL
     OR to_regclass('public.notification_test_sends_v2') IS NULL THEN
    RAISE EXCEPTION 'Apply ops/notifications_v2.sql first: this file needs public.notifications_v2_stamp() and public.notification_test_sends_v2.'
      USING ERRCODE = '42P01';
  END IF;
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'public.is_super_admin() is missing; every policy in this file depends on it.'
      USING ERRCODE = '42883';
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. TABLE
-- ═════════════════════════════════════════════════════════════════════════════

-- Per notification, per channel — platform scope, so no tenant_id.
-- `notification_key` is the catalog key (SystemNotificationItem.key): snake_case,
-- never renamed once shipped. Limits are checked on the text with its ends
-- trimmed, the way the page counts (validateTemplate), plus a hard cap on the
-- raw length so whitespace cannot be used to store something huge. Every CHECK
-- below is the tenant table's, renamed tns_* → pns_*.
CREATE TABLE IF NOT EXISTS public.platform_notification_settings (
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
  PRIMARY KEY (notification_key, channel),
  CONSTRAINT pns_key          CHECK (notification_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  CONSTRAINT pns_channel      CHECK (channel IN ('email', 'push', 'in_app')),
  CONSTRAINT pns_subject      CHECK (subject IS NULL OR (
                                     channel = 'email'
                                 AND subject !~ '[\x0A\x0D]'
                                 AND char_length(btrim(subject, E' \t')) <= 200
                                 AND char_length(subject) <= 1000)),
  CONSTRAINT pns_title        CHECK (title IS NULL OR (
                                     channel IN ('push', 'in_app')
                                 AND char_length(btrim(title, E' \t\r\n')) <= 100
                                 AND char_length(title) <= 1000)),
  CONSTRAINT pns_body         CHECK (body IS NULL OR CASE channel
                                   WHEN 'email'  THEN octet_length(body) <= 102400
                                   WHEN 'push'   THEN char_length(btrim(body, E' \t\r\n')) <= 300 AND char_length(body) <= 3000
                                   WHEN 'in_app' THEN char_length(btrim(body, E' \t\r\n')) <= 500 AND char_length(body) <= 5000
                                   ELSE false END),
  -- An object, {} off the push channel, only the four known keys, each a
  -- boolean. The CASE guards `-`, which raises on a non-object.
  CONSTRAINT pns_push_options CHECK (CASE WHEN jsonb_typeof(push_options) = 'object' THEN
                                     (channel = 'push' OR push_options = '{}'::jsonb)
                                 AND (push_options - 'requireInteraction' - 'silent' - 'replacePrevious' - 'openInApp') = '{}'::jsonb
                                 AND coalesce(jsonb_typeof(push_options -> 'requireInteraction'), 'boolean') = 'boolean'
                                 AND coalesce(jsonb_typeof(push_options -> 'silent'), 'boolean') = 'boolean'
                                 AND coalesce(jsonb_typeof(push_options -> 'replacePrevious'), 'boolean') = 'boolean'
                                 AND coalesce(jsonb_typeof(push_options -> 'openInApp'), 'boolean') = 'boolean'
                                 ELSE false END)
);

-- No index beyond the primary key: the page reads the whole table (a few dozen
-- rows at most, one per notification per channel) and every write names the
-- whole key. The platform test sends are found by the tenant file's
-- (app_user_id, created_at DESC) index, which does not mention tenant_id and so
-- covers NULL-tenant rows unchanged.

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. TRIGGER (on the NEW table only)
-- ═════════════════════════════════════════════════════════════════════════════

-- updated_at, and updated_by from the caller's own session (never a value the
-- browser sent). Defined by ops/notifications_v2.sql, reused here as-is: it
-- reads nothing tenant-specific, so it stamps this table identically.
DROP TRIGGER IF EXISTS pns_stamp ON public.platform_notification_settings;
CREATE TRIGGER pns_stamp BEFORE INSERT OR UPDATE ON public.platform_notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.notifications_v2_stamp();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. RLS
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.platform_notification_settings ENABLE ROW LEVEL SECURITY;

-- One predicate, repeated per command in the house style: an ACTIVE super admin.
-- (Split per command rather than one FOR ALL policy so a later change to, say,
-- who may DELETE is a one-policy edit and shows up in the VERIFY count.)

DROP POLICY IF EXISTS platform_notification_settings_super_admin_read ON public.platform_notification_settings;
CREATE POLICY platform_notification_settings_super_admin_read ON public.platform_notification_settings
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    AND EXISTS (SELECT 1 FROM public.app_users au
                 WHERE au.auth_user_id = auth.uid()
                   AND au.is_active IS TRUE)
  );

DROP POLICY IF EXISTS platform_notification_settings_super_admin_insert ON public.platform_notification_settings;
CREATE POLICY platform_notification_settings_super_admin_insert ON public.platform_notification_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    AND EXISTS (SELECT 1 FROM public.app_users au
                 WHERE au.auth_user_id = auth.uid()
                   AND au.is_active IS TRUE)
  );

DROP POLICY IF EXISTS platform_notification_settings_super_admin_update ON public.platform_notification_settings;
CREATE POLICY platform_notification_settings_super_admin_update ON public.platform_notification_settings
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    AND EXISTS (SELECT 1 FROM public.app_users au
                 WHERE au.auth_user_id = auth.uid()
                   AND au.is_active IS TRUE)
  )
  WITH CHECK (
    public.is_super_admin()
    AND EXISTS (SELECT 1 FROM public.app_users au
                 WHERE au.auth_user_id = auth.uid()
                   AND au.is_active IS TRUE)
  );

DROP POLICY IF EXISTS platform_notification_settings_super_admin_delete ON public.platform_notification_settings;
CREATE POLICY platform_notification_settings_super_admin_delete ON public.platform_notification_settings
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    AND EXISTS (SELECT 1 FROM public.app_users au
                 WHERE au.auth_user_id = auth.uid()
                   AND au.is_active IS TRUE)
  );

DROP POLICY IF EXISTS platform_notification_settings_service_all ON public.platform_notification_settings;
CREATE POLICY platform_notification_settings_service_all ON public.platform_notification_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. GRANTS
-- ═════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON public.platform_notification_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_notification_settings TO authenticated;
GRANT ALL ON public.platform_notification_settings TO service_role;

COMMENT ON TABLE public.platform_notification_settings IS
  'Notifications v2, SYSTEM set: Drive247''s own per-notification, per-channel on/off and template, edited in the super admin dashboard. Platform scope, so no tenant_id. NULL column = catalog default (apps/admin/lib/notifications-v2/catalog.ts); no row = all defaults; reset = DELETE. Super admins only. Not read by any live sender yet (build-spec D18).';

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. THE ONE EXCEPTION: a platform test send has no tenant
-- ═════════════════════════════════════════════════════════════════════════════
-- See "ADDITIVE ONLY" at the top. The platform Send test shares the tenant
-- budget (20 per user per rolling hour, counted by app_user_id), so its row goes
-- in the same log with tenant_id NULL — the same shape push_subscriptions and
-- push_notification_log already use for the platform audience. Guarded so a
-- re-run takes no lock; the table is empty and unapplied today, so this widens
-- a column that nothing has ever written.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'notification_test_sends_v2'
       AND column_name = 'tenant_id'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notification_test_sends_v2 ALTER COLUMN tenant_id DROP NOT NULL;
    RAISE NOTICE 'notification_test_sends_v2.tenant_id is now nullable (platform test sends).';
  END IF;
END $$;

COMMENT ON COLUMN public.notification_test_sends_v2.tenant_id IS
  'The tenant the test was sent as, or NULL for a platform (super admin) test — ops/notifications_v2_platform.sql. The rate limit is keyed on app_user_id, so both scopes share one budget.';

-- The admin app reads this table through PostgREST on the next request, so the
-- schema cache must already know it. Supabase's DDL watcher normally reloads it;
-- this makes it explicit (delivered on COMMIT).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- VERIFY (read-only; run after applying)
-- ═════════════════════════════════════════════════════════════════════════════
--   -- 1. the table exists, RLS on (true)
--   SELECT c.relname, c.relrowsecurity FROM pg_class c
--    WHERE c.oid = 'public.platform_notification_settings'::regclass;
--
--   -- 2. the policies: 5 rows (4 authenticated + 1 service_role)
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'platform_notification_settings'
--    ORDER BY policyname;
--
--   -- 3. grants: anon nothing; authenticated may read and write (RLS then lets
--   --    only super admins through), and cannot TRUNCATE
--   --    (expect: f | t t | f)
--   SELECT has_table_privilege('anon','public.platform_notification_settings','SELECT')            AS anon_read,
--          has_table_privilege('authenticated','public.platform_notification_settings','SELECT')   AS auth_read,
--          has_table_privilege('authenticated','public.platform_notification_settings','INSERT')   AS auth_write,
--          has_table_privilege('authenticated','public.platform_notification_settings','TRUNCATE') AS auth_truncate;
--
--   -- 4. the stamp trigger sits on the new table, and the tenant file's three
--   --    triggers are untouched (4 rows: tns_stamp, tes_guard, tes_stamp, pns_stamp)
--   SELECT tgrelid::regclass, tgname FROM pg_trigger
--    WHERE NOT tgisinternal
--      AND tgfoid IN ('public.notifications_v2_stamp()'::regprocedure,
--                     'public.tenant_email_sender_guard()'::regprocedure)
--    ORDER BY 1, 2;
--
--   -- 5. the CHECKs landed (6 rows: pns_body, pns_channel, pns_key,
--   --    pns_push_options, pns_subject, pns_title)
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.platform_notification_settings'::regclass AND contype = 'c'
--    ORDER BY 1;
--
--   -- 6. the exception landed, and NOTHING else about that table changed
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'notification_test_sends_v2'
--      AND column_name = 'tenant_id';                                    -- 'YES'
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.notification_test_sends_v2'::regclass
--    ORDER BY conname;                                                   -- unchanged: 5 CHECKs + PK + 2 FKs
--
--   -- 7. empty, and PostgREST can see it (as anon: 401/permission denied;
--   --    as a signed-in super admin: 200 and [])
--   SELECT count(*) FROM public.platform_notification_settings;          -- 0
--
--   -- 8. optional rolled-back smoke test as a super admin. Put their
--   --    auth.users id in the claims, check the row lands, then ROLL BACK:
--   --   BEGIN;
--   --   SET LOCAL ROLE authenticated;
--   --   SELECT set_config('request.jwt.claims', '{"sub":"<auth_user_id>","role":"authenticated"}', true);
--   --   INSERT INTO public.platform_notification_settings (notification_key, channel, enabled)
--   --     VALUES ('smoke_test_key', 'email', true)
--   --     RETURNING notification_key, updated_by;                       -- 1 row, updated_by = their app_users.id
--   --   ROLLBACK;
--   --
--   --   -- and the same INSERT as a tenant head_admin must return 0 rows /
--   --   -- "new row violates row-level security policy".
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (only if asked; nothing else depends on these objects)
-- ═════════════════════════════════════════════════════════════════════════════
--   Undeploy notification-test-v2 first (it writes NULL-tenant rows into
--   notification_test_sends_v2), then, in one transaction:
--   DROP TABLE IF EXISTS public.platform_notification_settings;
--   -- Only if no NULL-tenant rows were written, and only if you also want the
--   -- platform Send test gone (the column is otherwise harmless left wide):
--   --   DELETE FROM public.notification_test_sends_v2 WHERE tenant_id IS NULL;
--   --   ALTER TABLE public.notification_test_sends_v2 ALTER COLUMN tenant_id SET NOT NULL;
--   NOTIFY pgrst, 'reload schema';
--   The admin page falls back to defaults on its own (missing table = defaults).
