-- Close the tenant-update RLS hole exploited by the Own Stripe migration.
--
-- `allow_all_tenants_update` allowed ANY authenticated principal (incl. a
-- self-registered booking customer) to UPDATE ANY tenant row — which, combined
-- with the new tenants.payment_model column, is a revenue-hijack vector
-- (flip a victim tenant to 'own' + bind an attacker Stripe account).
--
-- Replace it with a scoped policy: super admins, or an app_user updating THEIR
-- OWN tenant. get_user_tenant_id() resolves via app_users, so booking
-- customers (customer_users only) get NULL and match no row. This preserves
-- the portal settings page (tenant admins editing their own tenant) while
-- removing cross-tenant and customer write access.

DROP POLICY IF EXISTS allow_all_tenants_update ON public.tenants;

CREATE POLICY tenants_update_own_or_super
  ON public.tenants
  FOR UPDATE
  USING (is_super_admin() OR id = get_user_tenant_id())
  WITH CHECK (is_super_admin() OR id = get_user_tenant_id());
