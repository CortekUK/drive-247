-- Stage 1 — stop cross-tenant READING, without breaking the public booking site.
-- NOT APPLIED. Review, run in staging, run the regression list in
-- docs/trax/db-isolation-remediation.md, then apply in a small window.
--
-- The deployed database ALREADY has the right policies on these tables
-- (`tenant_isolation_*`, "Users can view … for their tenant or super admin",
-- "Customers can read own rentals", `public_can_read_bookable_vehicles`). They do
-- nothing today because RLS is switched off, and because blanket policies sit
-- beside them — PERMISSIVE policies are OR-ed, so one `USING (true)` admits
-- everything.
--
-- So this stage: (1) drops the blanket policies, (2) adds only the policies that
-- are genuinely missing, (3) turns RLS on. Policy names below were read from the
-- live catalogue on 2026-09-18; re-run the inventory query at the end of this
-- file before applying, in case they have changed.
--
-- Anon INSERT is deliberately retained where the browser checkout writes
-- (customers, rentals, invoices, ledger_entries). Stage 2 moves those writes to
-- the server and removes the grants. This stage closes the severe part: any
-- visitor reading every tenant's records.

begin;

-- ── 1. Drop the blanket policies ────────────────────────────────────────────
drop policy if exists "Allow all operations for all users" on public.customers;
drop policy if exists "Allow full access for authenticated users" on public.customers;
drop policy if exists "Allow public read on customers" on public.customers;
drop policy if exists "Allow public update on customers" on public.customers;
drop policy if exists allow_all_select on public.customers;
drop policy if exists allow_all_update on public.customers;
drop policy if exists allow_all_delete on public.customers;
drop policy if exists allow_all_insert on public.customers;

drop policy if exists "Allow all operations for app users" on public.rentals;
drop policy if exists allow_all_select on public.rentals;
drop policy if exists allow_all_update on public.rentals;
drop policy if exists allow_all_delete on public.rentals;
drop policy if exists allow_all_insert on public.rentals;

drop policy if exists "Allow all operations for app users" on public.payments;
drop policy if exists allow_all_select on public.payments;
drop policy if exists allow_all_update on public.payments;
drop policy if exists allow_all_delete on public.payments;
drop policy if exists allow_all_insert on public.payments;

drop policy if exists "Allow authenticated users to manage invoices" on public.invoices;
drop policy if exists "Allow authenticated users to view invoices" on public.invoices;
drop policy if exists "Allow public select on invoices" on public.invoices;
drop policy if exists "Allow public to view invoices" on public.invoices;
drop policy if exists "Allow public update on invoices" on public.invoices;

drop policy if exists allow_all_select on public.vehicles;
drop policy if exists "Allow all operations for all users" on public.vehicles;

-- ── 2. Add only what is missing ─────────────────────────────────────────────
-- The customer portal reads payments, invoices and ledger rows for the signed-in
-- customer; rentals already has "Customers can read own rentals".
drop policy if exists payments_customer_read on public.payments;
create policy payments_customer_read on public.payments for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = payments.customer_id and cu.auth_user_id = auth.uid()));

drop policy if exists invoices_customer_read on public.invoices;
create policy invoices_customer_read on public.invoices for select to authenticated
  using (exists (select 1 from public.rentals r join public.customer_users cu on cu.customer_id = r.customer_id
                 where r.id = invoices.rental_id and cu.auth_user_id = auth.uid()));

-- ledger_entries and payment_applications have no usable policies at all today.
drop policy if exists ledger_staff on public.ledger_entries;
create policy ledger_staff on public.ledger_entries for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
drop policy if exists ledger_customer_read on public.ledger_entries;
create policy ledger_customer_read on public.ledger_entries for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = ledger_entries.customer_id and cu.auth_user_id = auth.uid()));
drop policy if exists applications_staff on public.payment_applications;
create policy applications_staff on public.payment_applications for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  with check (tenant_id = public.get_user_tenant_id() or public.is_super_admin());

-- The browser checkout keeps exactly the inserts it performs today (stage 2 removes these).
drop policy if exists customers_public_insert on public.customers;
create policy customers_public_insert on public.customers for insert to anon with check (tenant_id is not null);
drop policy if exists rentals_public_insert on public.rentals;
create policy rentals_public_insert on public.rentals for insert to anon with check (tenant_id is not null);
drop policy if exists invoices_public_insert on public.invoices;
create policy invoices_public_insert on public.invoices for insert to anon with check (tenant_id is not null);
drop policy if exists ledger_public_insert on public.ledger_entries;
create policy ledger_public_insert on public.ledger_entries for insert to anon with check (tenant_id is not null);

-- Server code (edge functions, webhooks, TRAX) uses the service role; make that explicit
-- so enabling RLS cannot surprise a background job.
drop policy if exists customers_service on public.customers;
create policy customers_service on public.customers for all to service_role using (true) with check (true);
drop policy if exists rentals_service on public.rentals;
create policy rentals_service on public.rentals for all to service_role using (true) with check (true);
drop policy if exists payments_service on public.payments;
create policy payments_service on public.payments for all to service_role using (true) with check (true);
drop policy if exists invoices_service on public.invoices;
create policy invoices_service on public.invoices for all to service_role using (true) with check (true);
drop policy if exists ledger_service on public.ledger_entries;
create policy ledger_service on public.ledger_entries for all to service_role using (true) with check (true);
drop policy if exists applications_service on public.payment_applications;
create policy applications_service on public.payment_applications for all to service_role using (true) with check (true);
drop policy if exists vehicles_service on public.vehicles;
create policy vehicles_service on public.vehicles for all to service_role using (true) with check (true);

-- ── 3. Turn RLS on ──────────────────────────────────────────────────────────
alter table public.customers enable row level security;
alter table public.rentals enable row level security;
alter table public.payments enable row level security;
alter table public.invoices enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.payment_applications enable row level security;
-- vehicles already has RLS enabled; dropping its blanket policy above is what
-- makes `public_can_read_bookable_vehicles` and `tenant_isolation_vehicles` bite.

commit;

-- ── Inventory / verification ────────────────────────────────────────────────
-- Before applying, confirm the policy names still match:
-- select tablename, policyname, permissive, roles::text, cmd, coalesce(qual,'') from pg_policies
--  where schemaname='public' and tablename in
--    ('customers','rentals','payments','invoices','ledger_entries','payment_applications','vehicles')
--  order by tablename, policyname;
--
-- After applying, expect rls_enabled = true for all seven:
-- select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relname in
--    ('customers','rentals','payments','invoices','ledger_entries','payment_applications','vehicles');
--
-- Then re-run the anon count probe from docs/trax/db-isolation-remediation.md:
-- customers, rentals, payments, invoices and ledger_entries must return 0 rows;
-- vehicles must return only website-visible ones.
