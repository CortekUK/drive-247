-- Ensure super admins can read ALL tenants (including inactive ones)
-- The existing policies only allow reading active tenants or same-tenant data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenants'
    AND policyname = 'super_admin_read_all_tenants'
  ) THEN
    CREATE POLICY "super_admin_read_all_tenants"
    ON tenants FOR SELECT TO authenticated
    USING (is_super_admin());
  END IF;
END
$$;
