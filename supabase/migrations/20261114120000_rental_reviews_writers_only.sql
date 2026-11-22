-- APPLIED to production 2026-11-14 (R14 QA, branch Rental_testing-13nov)
--
-- rental_reviews let ANY user of the tenant insert, update and delete reviews:
-- the policies checked only tenant_id = get_user_tenant_id(). A VIEWER could
-- rewrite a customer's rating and comment straight through the API (QA R14.9:
-- a viewer changed R-90cae6's 8/10 to 1/10). Reading stays open to the tenant;
-- writing now needs an active staff member who is not a viewer (or a super
-- admin), the same line update_rental_terms_v2 draws.
--
-- Rollback: recreate the three write policies with the old expression
--   ((tenant_id = get_user_tenant_id()) OR is_super_admin())

CREATE OR REPLACE FUNCTION public.can_write_tenant_reviews(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users u
     WHERE u.auth_user_id = auth.uid()
       AND COALESCE(u.is_active, true)
       AND (u.is_super_admin IS TRUE
            OR (u.tenant_id = p_tenant_id AND COALESCE(u.role, '') <> 'viewer'))
  );
$$;

DROP POLICY IF EXISTS "Tenant users can insert reviews for their tenant" ON public.rental_reviews;
DROP POLICY IF EXISTS "Tenant users can update reviews for their tenant" ON public.rental_reviews;
DROP POLICY IF EXISTS "Tenant users can delete reviews for their tenant" ON public.rental_reviews;

CREATE POLICY "Tenant staff (not viewers) can insert reviews" ON public.rental_reviews
  FOR INSERT WITH CHECK (public.can_write_tenant_reviews(tenant_id));
CREATE POLICY "Tenant staff (not viewers) can update reviews" ON public.rental_reviews
  FOR UPDATE USING (public.can_write_tenant_reviews(tenant_id)) WITH CHECK (public.can_write_tenant_reviews(tenant_id));
CREATE POLICY "Tenant staff (not viewers) can delete reviews" ON public.rental_reviews
  FOR DELETE USING (public.can_write_tenant_reviews(tenant_id));
