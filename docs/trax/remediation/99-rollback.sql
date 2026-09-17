-- Rollback for the isolation stages. EMERGENCY USE ONLY.
--
-- Running this returns the database to the exposed state described in
-- docs/trax/db-isolation-remediation.md: every tenant's customers, rentals,
-- payments, invoices and ledger readable and writable with the public key.
-- Use it to restore a broken checkout or portal while a fix is prepared — not as
-- a resting state. Roll back one stage at a time, starting with the one just
-- applied, and re-run the regression list afterwards.

-- ── Rollback of stage 1 (RLS + policies) ────────────────────────────────────
begin;

alter table public.customers disable row level security;
alter table public.rentals disable row level security;
alter table public.payments disable row level security;
alter table public.invoices disable row level security;
alter table public.ledger_entries disable row level security;
alter table public.payment_applications disable row level security;

-- Policies added by stage 1 (the pre-existing ones are left alone).
drop policy if exists payments_customer_read on public.payments;
drop policy if exists invoices_customer_read on public.invoices;
drop policy if exists ledger_staff on public.ledger_entries;
drop policy if exists ledger_customer_read on public.ledger_entries;
drop policy if exists applications_staff on public.payment_applications;
drop policy if exists customers_public_insert on public.customers;
drop policy if exists rentals_public_insert on public.rentals;
drop policy if exists invoices_public_insert on public.invoices;
drop policy if exists ledger_public_insert on public.ledger_entries;
drop policy if exists customers_service on public.customers;
drop policy if exists rentals_service on public.rentals;
drop policy if exists payments_service on public.payments;
drop policy if exists invoices_service on public.invoices;
drop policy if exists ledger_service on public.ledger_entries;
drop policy if exists applications_service on public.payment_applications;
drop policy if exists vehicles_service on public.vehicles;

-- NOTE: the blanket policies stage 1 dropped are NOT recreated here. They were
-- the defect. With RLS disabled above, the tables behave as they did before
-- stage 1 regardless. If a specific workflow genuinely depended on one, restore
-- that single policy deliberately and record why.

commit;

-- ── Rollback of stage 0 (destructive grants) ────────────────────────────────
-- Only if something is proven to need browser DELETE/TRUNCATE, which nothing
-- should. Prefer fixing the caller.
-- begin;
-- grant delete on public.customers, public.rentals, public.payments, public.invoices,
--   public.ledger_entries, public.payment_applications, public.payg_accruals,
--   public.rental_extensions, public.vehicles to anon;
-- commit;
