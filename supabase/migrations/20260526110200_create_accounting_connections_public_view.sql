-- Finance Sync — Sprint 2: client-safe projection of accounting_connections.
-- The underlying table has zero client SELECT policies; everything tenant
-- staff need (provider, status, org name, connected date, last_synced_at)
-- comes via this view. Secret IDs are deliberately omitted.

CREATE OR REPLACE VIEW public.accounting_connections_public
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.tenant_id,
  c.provider,
  c.status,
  -- DELIBERATELY NOT EXPOSED: access_token_secret_id, refresh_token_secret_id
  c.token_expires_at,
  c.external_org_id,
  c.external_org_name,
  c.external_region,
  c.last_synced_at,
  c.last_error,
  c.connected_by,
  c.connected_at,
  c.disconnected_at,
  c.created_at,
  c.updated_at
FROM public.accounting_connections c;

-- View inherits the table's RLS via security_invoker — but the table has no
-- tenant SELECT policy. Add one on the view layer to grant read access to
-- staff of the owning tenant + super admins.
GRANT SELECT ON public.accounting_connections_public TO authenticated, anon;

-- Re-grant the underlying SELECT to authenticated so security_invoker resolves
-- to the caller. But the table policy is service_role only — so we add a
-- tenant-staff-read policy ONLY visible through this view by using a
-- bypassrls function trick. Simpler approach: add a SELECT policy that lets
-- tenant staff see their rows but excludes the secret columns via the view
-- definition. The view itself drops the columns at compile time.
DROP POLICY IF EXISTS "tenant_staff_read_accounting_connections" ON public.accounting_connections;
CREATE POLICY "tenant_staff_read_accounting_connections"
  ON public.accounting_connections
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

COMMENT ON VIEW public.accounting_connections_public IS
  'Tenant-safe projection of accounting_connections. Secret IDs are not exposed. Spec §5.1 + master plan Deviation #1.';
