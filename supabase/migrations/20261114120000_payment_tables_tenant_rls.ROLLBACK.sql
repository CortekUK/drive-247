-- Rollback for 20261114120000_payment_tables_tenant_rls.sql: back to RLS off, as before.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments', 'ledger_entries', 'invoices', 'payment_applications'] LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS r812_staff_own_tenant ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS r812_customer_own_tenants ON public.%I', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS ledger_entries_open_as_before ON public.ledger_entries;
DROP FUNCTION IF EXISTS public.rls_staff_tenant_ok(uuid);
DROP FUNCTION IF EXISTS public.rls_customer_tenant_ok(uuid);
