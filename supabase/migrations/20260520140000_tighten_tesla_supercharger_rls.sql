-- Tighten RLS on tesla_supercharger_charges.
--
-- Before: tenant users could INSERT, UPDATE, and DELETE charge rows directly
-- via the API. A tenant viewer could inject a fake $500 Supercharger fee
-- straight into a customer's ledger.
--
-- After:
--   * INSERT: only service_role (the sync-tesla-charges edge function) can
--     create rows. Service role bypasses RLS, so no policy is needed for it;
--     authenticated users have no INSERT policy and therefore cannot insert.
--   * DELETE: charges are audit data. Nobody can delete via the API. If a
--     row needs to be removed, it must be done via the service_role.
--   * UPDATE: tenant users keep the ability to mark charges waived / charged
--     (the Waive and Charge buttons in the portal update directly), but only
--     on rows in their own tenant.
--   * SELECT: tenant users keep read access to their own tenant's rows.

DROP POLICY IF EXISTS "Service role can insert supercharger charges" ON public.tesla_supercharger_charges;
DROP POLICY IF EXISTS "Tenant users can insert supercharger charges"  ON public.tesla_supercharger_charges;
DROP POLICY IF EXISTS "Service role can delete supercharger charges" ON public.tesla_supercharger_charges;
DROP POLICY IF EXISTS "Tenant users can delete supercharger charges"  ON public.tesla_supercharger_charges;

-- The other "Service role can update" policy was a redundant duplicate of the
-- tenant-user UPDATE policy with the same predicate. service_role bypasses RLS
-- anyway, so this one is pure noise.
DROP POLICY IF EXISTS "Service role can update supercharger charges" ON public.tesla_supercharger_charges;
