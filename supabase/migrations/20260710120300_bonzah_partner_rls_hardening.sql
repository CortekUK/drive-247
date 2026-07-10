-- Phase 6 hardening (partial): keep a Bonzah partner scoped to Bonzah data only.
--
-- IMPORTANT FINDING: RLS is currently DISABLED (relrowsecurity = false) on both
-- public.tenants and public.app_users platform-wide, so their policies are NOT
-- enforced — every authenticated user can already read all tenants / app_users.
-- Enabling RLS on those two tables is a high-risk, platform-wide change (booking,
-- portal and admin all read them heavily) and is intentionally NOT done here; it
-- needs a dedicated, separately-reviewed rollout.
--
-- The statements below are therefore FORWARD-LOOKING: they add
-- `AND NOT is_bonzah_partner()` to the partner-reachable SELECT policies on
-- tenants so that, the moment RLS is enabled on tenants, Bonzah partners are
-- excluded from the broad reads. They are a no-op today (RLS off) and a no-op for
-- every non-partner (is_bonzah_partner() is false for anon and all normal users).
-- Defense-in-depth for today lives in the console app, which only queries Bonzah
-- tables and no longer joins the tenants table.

-- 1. Broad authenticated read
DROP POLICY IF EXISTS allow_all_tenants_select ON public.tenants;
CREATE POLICY allow_all_tenants_select
  ON public.tenants FOR SELECT TO public
  USING (auth.uid() IS NOT NULL AND NOT is_bonzah_partner());

-- 2. Public active-tenant read
DROP POLICY IF EXISTS tenants_public_read_active ON public.tenants;
CREATE POLICY tenants_public_read_active
  ON public.tenants FOR SELECT TO anon, authenticated
  USING (status = 'active' AND NOT is_bonzah_partner());

-- 3. Legacy active-branding read
DROP POLICY IF EXISTS "Anyone can read active tenant branding" ON public.tenants;
CREATE POLICY "Anyone can read active tenant branding"
  ON public.tenants FOR SELECT TO anon, authenticated
  USING (status = 'active' AND NOT is_bonzah_partner());
