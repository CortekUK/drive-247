-- Let Bonzah partners read onboarding submissions (needed by the partner
-- console). Mutations remain service_role-only via the bonzah-partner-review
-- edge function. Tenant-scoped narrowing of the tenants table read is handled
-- in Phase 6 hardening.
DROP POLICY IF EXISTS tenants_select_own_bonzah_onboarding ON public.bonzah_onboarding_submissions;
CREATE POLICY tenants_select_own_bonzah_onboarding
  ON public.bonzah_onboarding_submissions FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
    OR is_bonzah_partner()
  );
