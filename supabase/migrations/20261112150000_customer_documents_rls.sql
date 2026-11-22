-- APPLIED to production 2026-11-12 (I5.9 QA fix, branch Insurance-testing)
--
-- customer_documents had RLS OFF and one "Allow all ... true" policy, so any
-- logged-in user of ANY tenant (and the public anon key) could read every
-- tenant's customer documents: insurance certificates, policy numbers,
-- signed agreements and their file paths.
--
-- Who needs the table, and how they reach it:
--   * operator staff (portal)     -> authenticated, app_users.tenant_id
--   * super admins (admin app)    -> is_super_admin()
--   * a signed-in customer        -> authenticated, customer_users link
--   * edge functions / Next API   -> service_role (bypasses RLS)
-- Guests uploading during a booking only write to STORAGE until they sign
-- in at checkout (insurance-upload-dialog.tsx), so anon needs no access here.
--
-- Not covered here (separate work): the `customer-documents` storage bucket
-- is still public, and 750 rows store full public URLs that would break if it
-- were made private; `customers` / `rentals` still have RLS off.
--
-- Rollback:
--   ALTER TABLE public.customer_documents DISABLE ROW LEVEL SECURITY;
--   CREATE POLICY "Allow all operations for app users" ON public.customer_documents
--     FOR ALL TO public USING (true) WITH CHECK (true);

BEGIN;

DROP POLICY IF EXISTS "Allow all operations for app users" ON public.customer_documents;
DROP POLICY IF EXISTS cd_row_staff_all ON public.customer_documents;
DROP POLICY IF EXISTS cd_row_customer_select ON public.customer_documents;
DROP POLICY IF EXISTS cd_row_customer_insert ON public.customer_documents;
DROP POLICY IF EXISTS cd_row_customer_update ON public.customer_documents;
DROP POLICY IF EXISTS cd_row_customer_delete ON public.customer_documents;

-- Staff: their own tenant only. Super admins: everything.
CREATE POLICY cd_row_staff_all ON public.customer_documents
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- A customer: only rows filed against their own customer record, in that
-- record's tenant.
CREATE POLICY cd_row_customer_select ON public.customer_documents
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_users cu
     WHERE cu.auth_user_id = auth.uid()
       AND cu.customer_id = customer_documents.customer_id));

CREATE POLICY cd_row_customer_insert ON public.customer_documents
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.customer_users cu
      JOIN public.customers c ON c.id = cu.customer_id
     WHERE cu.auth_user_id = auth.uid()
       AND cu.customer_id = customer_documents.customer_id
       AND c.tenant_id = customer_documents.tenant_id));

CREATE POLICY cd_row_customer_update ON public.customer_documents
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_users cu
     WHERE cu.auth_user_id = auth.uid()
       AND cu.customer_id = customer_documents.customer_id))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.customer_users cu
      JOIN public.customers c ON c.id = cu.customer_id
     WHERE cu.auth_user_id = auth.uid()
       AND cu.customer_id = customer_documents.customer_id
       AND c.tenant_id = customer_documents.tenant_id));

-- A customer may delete only their own upload that is not filed against a
-- booking (the same rule the customer portal applies).
CREATE POLICY cd_row_customer_delete ON public.customer_documents
  FOR DELETE TO authenticated
  USING (customer_documents.rental_id IS NULL
     AND customer_documents.extension_id IS NULL
     AND EXISTS (
    SELECT 1 FROM public.customer_users cu
     WHERE cu.auth_user_id = auth.uid()
       AND cu.customer_id = customer_documents.customer_id));

ALTER TABLE public.customer_documents ENABLE ROW LEVEL SECURITY;

COMMIT;
