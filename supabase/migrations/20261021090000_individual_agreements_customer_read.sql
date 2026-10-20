-- APPLIED to production 2026-10-21.
--
-- The customer portal's Agreements page lists an agreement sent to the
-- customer from the operator's Agreements tab ("Linked to: Customer") beside
-- their rental agreements, as the operator list does. Until now only staff
-- could read individual_agreements_v2, so those never reached the customer.
--
-- A signed-in customer reads ONLY the rows sent to them: the row's customer
-- and tenant must be their own customer_users link. Read only; staff policies
-- are unchanged.
drop policy if exists individual_agreements_v2_customer_select on public.individual_agreements_v2;
create policy individual_agreements_v2_customer_select
  on public.individual_agreements_v2
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.customer_users cu
      where cu.auth_user_id = auth.uid()
        and cu.customer_id = individual_agreements_v2.customer_id
        and cu.tenant_id = individual_agreements_v2.tenant_id
    )
  );
