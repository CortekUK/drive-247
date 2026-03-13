-- Drop and recreate to ensure the policy exists correctly
DROP POLICY IF EXISTS "super_admin_read_all_tenants" ON tenants;

CREATE POLICY "super_admin_read_all_tenants"
ON tenants FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM app_users
    WHERE app_users.auth_user_id = auth.uid()
    AND app_users.is_super_admin = true
  )
);
