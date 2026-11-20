-- APPLIED to production 2026-11-14 (QA I3.12, branch Insurance-testing)
--
-- A viewer could insert, update and delete AI Verifications straight through
-- the API: every write policy only checked the tenant. The portal now hides
-- Verify Insurance / Attach / Re-run / Delete from viewers (7bc5e58a); this makes
-- the database refuse those writes too. Reuses can_write_tenant_reviews(), the
-- "tenant staff who are not viewers, or a super admin" test from
-- 20261114120000_rental_reviews_writers_only. Edge functions use the service
-- role and are unaffected.
--
-- Rollback:
--   DROP POLICY "Tenant staff (not viewers) can insert verifications" ON public.insurance_verifications;
--   DROP POLICY "Tenant staff (not viewers) can update verifications" ON public.insurance_verifications;
--   DROP POLICY "Tenant staff (not viewers) can delete verifications" ON public.insurance_verifications;
--   CREATE POLICY insurance_verifications_insert ON public.insurance_verifications FOR INSERT
--     WITH CHECK ((tenant_id = get_user_tenant_id()) OR is_super_admin());
--   CREATE POLICY insurance_verifications_update ON public.insurance_verifications FOR UPDATE
--     USING ((tenant_id = get_user_tenant_id()) OR is_super_admin())
--     WITH CHECK ((tenant_id = get_user_tenant_id()) OR is_super_admin());
--   CREATE POLICY insurance_verifications_delete ON public.insurance_verifications FOR DELETE
--     USING ((tenant_id = get_user_tenant_id()) OR is_super_admin());

DROP POLICY IF EXISTS insurance_verifications_insert ON public.insurance_verifications;
DROP POLICY IF EXISTS insurance_verifications_update ON public.insurance_verifications;
DROP POLICY IF EXISTS insurance_verifications_delete ON public.insurance_verifications;

CREATE POLICY "Tenant staff (not viewers) can insert verifications" ON public.insurance_verifications
  FOR INSERT WITH CHECK (public.can_write_tenant_reviews(tenant_id));
CREATE POLICY "Tenant staff (not viewers) can update verifications" ON public.insurance_verifications
  FOR UPDATE USING (public.can_write_tenant_reviews(tenant_id)) WITH CHECK (public.can_write_tenant_reviews(tenant_id));
CREATE POLICY "Tenant staff (not viewers) can delete verifications" ON public.insurance_verifications
  FOR DELETE USING (public.can_write_tenant_reviews(tenant_id));
