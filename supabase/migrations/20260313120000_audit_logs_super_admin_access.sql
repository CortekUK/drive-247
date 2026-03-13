-- Allow super admins to read all audit logs across tenants
CREATE POLICY "super_admin_view_all_audit_logs"
ON audit_logs FOR SELECT TO authenticated
USING (is_super_admin());
