-- ============================================================================
-- Secure read access to public.app_users
--
-- THE BUG, IN ONE SENTENCE: app_users has six RLS policies and RLS was never
-- switched on, so all six are inert and `GRANT ALL ... TO anon` is the whole
-- access model.
--
-- Verified against the live project (hviqoaokxvlancmftwuo) with nothing but the
-- PUBLIC anon key and no user session:
--
--   GET /rest/v1/app_users?select=email,tenant_id,auth_user_id  -> 200, 78 rows
--   GET /rest/v1/app_users?email=eq.<address>                   -> 200, matched
--   GET /rest/v1/app_users?tenant_id=eq.<uuid>                  -> 200, matched
--   PATCH /rest/v1/app_users?id=eq.<uuid>                       -> 204 (allowed)
--   DELETE /rest/v1/app_users?id=eq.<uuid>                      -> 204 (allowed)
--
-- The last two were probed with an all-zero uuid so they could match no row;
-- no data was read into them and none was changed. They are recorded because
-- they prove the exposure was never read-only.
--
-- A policy on a table with RLS disabled is stored and ignored by Postgres. That
-- is the entire root cause. Nothing about the policies themselves was wrong.
--
-- ---------------------------------------------------------------------------
-- STATE BEFORE THIS MIGRATION  (snapshot; the rollback file depends on it)
--
--   RLS:      DISABLED
--   Grants:   ALL -> anon, authenticated, service_role
--   Policies: users_read_self             SELECT  PUBLIC  auth.uid() = auth_user_id
--             super_admin_read_all        SELECT  PUBLIC  is_super_admin()
--             p_update_own_password_flag  UPDATE  authenticated
--                                                 USING/CHECK auth_user_id = auth.uid()
--             super_admin_manage_all         INSERT  PUBLIC  CHECK is_super_admin()
--             super_admin_manage_all_update  UPDATE  PUBLIC  is_super_admin()
--             super_admin_manage_all_delete  DELETE  PUBLIC  is_super_admin()
--
--   (Source: supabase/migrations/20251219083413_remote_schema.sql lines
--    8188-8260 and 9101-9103. No later migration alters them.)
--
-- ---------------------------------------------------------------------------
-- WHY "OWN ROW ONLY" WOULD HAVE BROKEN THE PORTAL
--
-- Simply enabling RLS is not enough, and this is the part that needed the
-- audit rather than the instinct. The existing SELECT policies cover exactly
-- two cases — your own row, and a super admin — but four shipped code paths
-- read OTHER PEOPLE'S rows inside the caller's own tenant:
--
--   apps/portal/src/app/(dashboard)/users/page.tsx:86           list tenant staff
--   apps/portal/src/app/(dashboard)/settings/users/page.tsx:57  list tenant staff
--   apps/portal/src/hooks/use-audit-logs.ts:127                 actor filter list
--   apps/portal/src/lib/services/notification-service.ts:169    notify tenant admins
--
-- Every one of them runs in the browser under the caller's own session, so
-- enabling RLS without a same-tenant read policy would have turned the portal's
-- Users page into an empty table and silently stopped admin notifications. The
-- fourth is why this policy is not restricted to admin roles: getAdminUserIds()
-- is called from notification paths that any role can trigger, and narrowing it
-- by role would break notifications for ops, viewer and manager users. Today
-- every authenticated user can read every row in the table; scoping them to
-- their own tenant is already a large tightening, and narrowing further by role
-- is a separate change that needs each role's flows traced first.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS CHECKED AND NEEDS NOTHING
--
--   Turo extension  reads app_users?auth_user_id=eq.<uid> as the signed-in user
--                   -> covered by users_read_self, unchanged.
--   Portal login    apps/portal/src/stores/auth-store.ts:87,249, same shape.
--   Admin console   apps/admin/store/authStore.ts:36,78, same shape. Its
--                   cross-tenant reads (admins page, tenant detail, todo
--                   dialogs) are super-admin-only screens -> super_admin_read_all.
--   Sales agents    apps/admin/components/admin/Sidebar.tsx:52 gives a
--                   sales-agent-without-super-admin ONLY the Sales group, so
--                   their only app_users read is their own row. No policy needed.
--   Avatar upload   apps/portal/src/components/shared/layout/user-menu.tsx:82
--                   updates its own row -> p_update_own_password_flag.
--   Edge functions  every one that touches app_users builds a service-role
--                   client (createServiceClient() / SUPABASE_SERVICE_ROLE_KEY),
--                   and service_role bypasses RLS. Includes
--                   turo-bridge-ingest and _shared/tenant-auth.ts.
--   Booking app     references app_users only in generated types. No queries.
--   Bonzah partner  apps/bonzah/store/authStore.ts:35,63 -- both own-row reads
--     portal        by auth_user_id -> users_read_self. (This app is not listed
--                   in CLAUDE.md and was found by a repo-wide sweep rather than
--                   the app-by-app pass; recorded so the next audit starts from
--                   a complete list.)
--
-- ---------------------------------------------------------------------------
-- OUT OF SCOPE, AND REAL: the same probe found anon can also read `tenants`,
-- `customers`, `rentals`, `vehicles` and `audit_logs`. Those are NOT touched
-- here — each needs its own consumer audit, and a blind fix would break the
-- booking site, which legitimately reads some of them anonymously. Recorded in
-- the canonical TURO_DRIVE247_EXTENSION_IMPLEMENTATION.md AT THE REPOSITORY
-- ROOT (not beside this file) so it is not lost.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE FIX. Everything else in this file only matters because of this line.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- Deliberately NOT "FORCE ROW LEVEL SECURITY". The three helper functions the
-- policies below call are SECURITY DEFINER owned by postgres, which also owns
-- this table; forcing RLS would subject their internal reads to these same
-- policies and produce infinite recursion. Table-owner exemption is what makes
-- is_super_admin() and get_user_tenant_id() safe to call from here, and it is
-- the pattern every other table in this project already relies on.

-- ---------------------------------------------------------------------------
-- 2. GRANTS. RLS constrains rows; grants decide who may address the table at
--    all. anon should never have been able to.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.app_users FROM anon;

-- Re-issue authenticated's grant narrowed to the four verbs the applications
-- actually use. GRANT ALL additionally carries TRUNCATE, which is NOT subject
-- to row level security — a table-wide delete that every policy above would
-- have watched go past. PostgREST cannot emit TRUNCATE, so this closes a door
-- rather than a breach, but it is the kind of door worth closing while here.
-- SELECT/INSERT/UPDATE/DELETE behaviour is unchanged; the policies decide them.
REVOKE ALL ON TABLE public.app_users FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO authenticated;

-- service_role keeps ALL and bypasses RLS. Every edge function depends on it.
GRANT ALL ON TABLE public.app_users TO service_role;

-- ---------------------------------------------------------------------------
-- 3. THE ONE POLICY THAT WAS MISSING.
--
--    Existing policies are left exactly as they are. They were never the
--    problem, and re-creating them would put six working rules at risk to fix
--    one that was absent.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS app_users_read_same_tenant ON public.app_users;

CREATE POLICY app_users_read_same_tenant
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (
    -- get_user_tenant_id() is SECURITY DEFINER (defined in
    -- 20251222150000_fix_super_admin_rls.sql:28), so its own read of app_users
    -- runs as the owner and does not re-enter this policy. That is what keeps
    -- this from recursing.
    tenant_id IS NOT NULL
    AND tenant_id = public.get_user_tenant_id()
  );

COMMENT ON POLICY app_users_read_same_tenant ON public.app_users IS
  'Staff may read the staff list of their OWN tenant, and no other. Required by '
  'the portal Users pages, the audit-log actor filter and admin notification '
  'routing, all of which read colleague rows from the browser. tenant_id IS NOT '
  'NULL is load-bearing: super admins carry tenant_id NULL, and without it a '
  'NULL = NULL comparison would still be NULL rather than true, but the '
  'condition states the intent rather than relying on that.';

COMMIT;

-- ============================================================================
-- RESULTING ACCESS MATRIX
--
--   anon (no session)      no access whatsoever. The grant is gone, so the
--                          request is refused before any policy is consulted.
--   authenticated, self    own row: SELECT (users_read_self),
--                          UPDATE (p_update_own_password_flag)
--   authenticated, tenant  SELECT rows sharing their tenant_id
--                          (app_users_read_same_tenant)
--   authenticated, other   nothing. No policy grants a cross-tenant row to a
--     tenant               non-super-admin.
--   super admin            SELECT/INSERT/UPDATE/DELETE all rows
--                          (super_admin_read_all, super_admin_manage_all*)
--   service_role           unrestricted, bypasses RLS. Edge functions only.
--                          The key is never shipped to a browser or extension.
--
-- VERIFY AFTER DEPLOYING (anon key only, no session):
--   curl -s -H "apikey: $ANON" \
--     "$URL/rest/v1/app_users?select=email,tenant_id,auth_user_id"
--   Expect 401/permission denied. A 200 with [] would ALSO be wrong here --
--   that would mean the grant survived and only RLS is filtering.
--
-- ROLLBACK: supabase/migrations/20260904120000_secure_app_users_read_access.ROLLBACK.sql
-- ============================================================================
