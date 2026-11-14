-- QA R8.12 (2026-11-14): another company's staff could read Northwind's payments and
-- ledger lines through the REST API, because row security was OFF on the money tables
-- (and ledger_entries had no policy at all).
--
-- What this does, and deliberately does not do:
--   * Staff (anyone with an app_users row) see and write only their OWN tenant's rows;
--     super admins see all. This closes the R8.12 hole.
--   * A signed-in customer READS only rows of the tenants they rent from.
--   * Anonymous callers (auth.uid() IS NULL) are left exactly as before: the public
--     booking site still inserts ledger_entries / invoices from the browser during an
--     anonymous checkout, and tightening that needs the checkout moved server-side
--     first. Service-role edge functions bypass RLS as always.
-- The existing permissive policies stay; these are RESTRICTIVE, so they only take away.
-- Rollback: 20261114120000_payment_tables_tenant_rls.ROLLBACK.sql

CREATE OR REPLACE FUNCTION public.rls_staff_tenant_ok(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN true
    WHEN EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid()) THEN
      COALESCE((SELECT is_super_admin FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1), false)
      OR p_tenant = (SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1)
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION public.rls_customer_tenant_ok(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN true
    WHEN EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid()) THEN true
    WHEN EXISTS (SELECT 1 FROM customer_users WHERE auth_user_id = auth.uid()) THEN
      p_tenant IN (
        SELECT c.tenant_id FROM customer_users cu JOIN customers c ON c.id = cu.customer_id
         WHERE cu.auth_user_id = auth.uid()
      )
    ELSE true
  END;
$$;

GRANT EXECUTE ON FUNCTION public.rls_staff_tenant_ok(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_customer_tenant_ok(uuid) TO anon, authenticated, service_role;

-- ledger_entries had RLS off and no policy: keep today's access for everyone, then restrict.
DROP POLICY IF EXISTS ledger_entries_open_as_before ON public.ledger_entries;
CREATE POLICY ledger_entries_open_as_before ON public.ledger_entries
  AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'ledger_entries', 'invoices', 'payment_applications'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS r812_staff_own_tenant ON public.%I', t);
    EXECUTE format('CREATE POLICY r812_staff_own_tenant ON public.%I AS RESTRICTIVE FOR ALL USING (public.rls_staff_tenant_ok(tenant_id)) WITH CHECK (public.rls_staff_tenant_ok(tenant_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS r812_customer_own_tenants ON public.%I', t);
    EXECUTE format('CREATE POLICY r812_customer_own_tenants ON public.%I AS RESTRICTIVE FOR SELECT USING (public.rls_customer_tenant_ok(tenant_id))', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
