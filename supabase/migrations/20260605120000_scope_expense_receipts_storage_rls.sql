-- ============================================================
-- H2: Tenant-scope the expense-receipts storage bucket.
-- The original policies authorized on bucket_id alone, so any authenticated
-- user from any tenant could read/delete any receipt. Scope every policy to the
-- tenant folder (receipts are stored at "{tenant_id}/{file}"), matching the
-- isolation used everywhere else in the schema.
-- ============================================================

-- Upload: only into your own tenant folder.
DROP POLICY IF EXISTS "Authenticated upload expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated upload expense-receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  );

-- Read: only your own tenant's receipts (super admins may read all).
DROP POLICY IF EXISTS "Authenticated read expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated read expense-receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (
      (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      OR public.is_super_admin()
    )
  );

-- Delete: only your own tenant's receipts (super admins may delete all).
DROP POLICY IF EXISTS "Authenticated delete expense-receipts" ON storage.objects;
CREATE POLICY "Authenticated delete expense-receipts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (
      (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      OR public.is_super_admin()
    )
  );

-- Service role retains full access (edge functions / admin tooling).
DROP POLICY IF EXISTS "service_role manage expense-receipts" ON storage.objects;
CREATE POLICY "service_role manage expense-receipts"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'expense-receipts')
  WITH CHECK (bucket_id = 'expense-receipts');
