-- QA I1.13 (2026-11-14): another company's admin could read Northwind's Bonzah
-- policies over the REST API: bonzah_insurance_policies had sensible policies
-- (staff = own tenant, customer = own policies) but row security was OFF, so
-- none of them applied.
-- Switching it on needs two more rules so nothing that works today breaks:
--   * the portal's buy-insurance dialog UPDATEs extension_id from the browser
--     (staff, own tenant), and
--   * super admins (tenant_id NULL) must still read every tenant's policies.
-- Unchanged on purpose: the existing anon SELECT/INSERT policies (the booking
-- site buys cover as an anonymous visitor) and service_role (edge functions).
-- Rollback: 20261114150000_bonzah_policies_rls.ROLLBACK.sql

DROP POLICY IF EXISTS "Staff can update tenant policies" ON public.bonzah_insurance_policies;
CREATE POLICY "Staff can update tenant policies" ON public.bonzah_insurance_policies
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT app_users.tenant_id FROM app_users WHERE app_users.auth_user_id = auth.uid()) OR is_super_admin())
  WITH CHECK (tenant_id IN (SELECT app_users.tenant_id FROM app_users WHERE app_users.auth_user_id = auth.uid()) OR is_super_admin());

DROP POLICY IF EXISTS "Super admins can read all bonzah policies" ON public.bonzah_insurance_policies;
CREATE POLICY "Super admins can read all bonzah policies" ON public.bonzah_insurance_policies
  FOR SELECT TO authenticated
  USING (is_super_admin());

ALTER TABLE public.bonzah_insurance_policies ENABLE ROW LEVEL SECURITY;
