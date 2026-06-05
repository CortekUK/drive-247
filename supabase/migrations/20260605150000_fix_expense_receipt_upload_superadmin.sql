-- Fix: the tenant-scoped upload policy for expense-receipts didn't allow super
-- admins (tenant_id NULL → get_user_tenant_id() is NULL), so uploading a receipt
-- failed with "new row violates row-level security policy". Add the same
-- is_super_admin() bypass the read/delete policies already have.

DROP POLICY IF EXISTS "Authenticated upload expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated upload expense-receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (
      (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      OR public.is_super_admin()
    )
  );
