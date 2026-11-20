-- Audit logs: row security back on; each tenant reads its own rows (QA B9.10, 2026-11-11)
--
-- Found while testing checklist B9 "Audit logs" on the Northwind portal: the
-- public anon key alone, with nobody signed in, read every tenant's audit_logs
-- (1,615 Northwind rows, staff emails and user agents included), and a head
-- admin of one tenant read another tenant's rows through the API. Two things
-- had gone wrong on the live table:
--
--   1. Row level security was OFF (pg_class.relrowsecurity = false), although
--      20260104130000_create_audit_logs_complete.sql enabled it and
--      20260104120000_add_audit_logs_insert_policy.sql forced it. No migration
--      disables it, so it was switched off by hand at some point. With it off
--      no policy applies at all, and anon reads the whole table.
--   2. Even with it on, two policies from the first schema dump were wider than
--      the table: p_audit_read let any active admin or head admin of ANY tenant
--      read ALL rows, and p_audit_insert let anyone, signed in or not, insert
--      any row.
--
-- The portal only ever showed a tenant its own rows because its query filters
-- by tenant_id. That is a convenience, not a boundary.
--
-- After this migration:
--   reads    own tenant (get_user_tenant_id), or a super admin
--   inserts  own tenant or a super admin (super admins act inside a tenant's
--            portal and carry tenant_id NULL themselves); the service role; and
--            the sign-in page's "login_failed" row, which is written before
--            anyone is signed in and carries no tenant
--
-- Edge functions use the service role, which bypasses row security, as does
-- the postgres role that owns the SECURITY DEFINER functions reading this
-- table (evaluate_tenant_health, get_tenant_health_activity, block_customer,
-- ...): none of them change behaviour. Both helper functions are SECURITY
-- DEFINER, so the policies never recurse into app_users' own row security.

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p_audit_read" ON public.audit_logs;
DROP POLICY IF EXISTS "p_audit_insert" ON public.audit_logs;

-- Reads --------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their tenant audit logs" ON public.audit_logs;
CREATE POLICY "Users can view their tenant audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "super_admin_view_all_audit_logs" ON public.audit_logs;
CREATE POLICY "super_admin_view_all_audit_logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Writes -------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert audit logs for their tenant" ON public.audit_logs;
CREATE POLICY "Users can insert audit logs for their tenant"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.audit_logs;
CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone may record a failed sign-in" ON public.audit_logs;
CREATE POLICY "Anyone may record a failed sign-in"
  ON public.audit_logs FOR INSERT TO anon
  WITH CHECK (action = 'login_failed');
