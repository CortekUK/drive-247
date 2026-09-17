# Database tenant-isolation: finding and staged remediation

**Status: NOT APPLIED.** This document and the SQL in `docs/trax/remediation/` are for review. Nothing here has been run against any database. The SQL deliberately lives outside `supabase/migrations/` so that a routine `supabase db push` cannot apply it by accident.

## 1. What was verified, where, and how

**Environment:** the deployed Supabase project `hviqoaokxvlancmftwuo` (the one `apps/*/integrations/supabase/client.ts` defaults to). Checked on 2026-09-18 through the Management API with read-only catalogue queries, plus one count-only probe with the **public anon key** that returns no rows. No business records were retrieved and nothing was modified.

This is the **deployed** state, not the repository's intent. Several migrations in the repo enable RLS and add tenant policies for these tables; the live database does not match them.

### Deployed row-level security

| Table | RLS enabled | Policies present |
|---|---|---|
| customers | **no** | 15 |
| rentals | **no** | 11 |
| payments | **no** | 10 |
| invoices | **no** | 8 |
| ledger_entries | **no** | 0 |
| payment_applications | **no** | 1 |
| vehicles | yes | 6 |
| pnl_entries, payg_accruals, rental_extensions, tenants, app_users | yes | 2–7 |

No table has `FORCE ROW LEVEL SECURITY`.

### Deployed grants

`anon` (the key published in the website and portal JavaScript) holds `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on: **customers, rentals, payments, invoices, ledger_entries, payment_applications, payg_accruals, rental_extensions, vehicles**. `authenticated` holds the same. Where RLS is off, grants alone decide access, so these are effective.

### Confirmed exposure (count-only probe with the public key)

| Table | Rows reachable | | Table | Rows reachable |
|---|---|---|---|---|
| customers | 608 | | invoices | 190 |
| rentals | 318 | | ledger_entries | 2,759 |
| payments | 1,295 | | vehicles | 492 |

Read **and** write, across every tenant. Where RLS *is* enabled, blanket policies such as `customers."Allow all operations for all users" USING (true)` and `allow_all_select USING (auth.uid() IS NOT NULL)` would still admit every row, so enabling RLS alone would not isolate these tables.

### What this does and does not mean for TRAX

TRAX reads with the server-side service credential and applies the tenant predicate itself; `tests/trax/business-storage.mjs` proves every statement it issues carries the authenticated tenant, and that a revoked permission refuses before any statement runs. That is a property of TRAX's query layer — **it is not a fix for the exposure above**, which is reachable from any browser without TRAX.

## 2. Why this cannot be fixed by enabling RLS

The public booking app (`apps/booking`) uses the anon key **in the browser** (`apps/booking/src/integrations/supabase/client.ts:19`) and writes business rows directly during checkout:

- `apps/booking/src/app/booking/checkout/page.tsx` — inserts into `customers`, `rentals`, `invoices`, `ledger_entries`;
- `apps/booking/src/components/BookingCheckoutStep.tsx` — inserts `ledger_entries`;
- public browsing reads `vehicles` filtered by `show_on_website = true` (`apps/booking/src/app/booking/vehicles/page.tsx:113`), plus locations and pricing;
- the customer portal (`apps/booking/src/app/(customer-portal)/...`) reads `rentals`, `payments`, `invoices`, `ledger_entries` for the signed-in customer.

Revoking anon writes, or enabling RLS without matching policies, stops bookings. The remediation is therefore staged.

## 3. Staged remediation

### Stage 0 — remove what nothing legitimate uses (low risk)
`docs/trax/remediation/01-revoke-destructive-anon-grants.sql`

Revoke `DELETE` and `TRUNCATE` from `anon` (and `TRUNCATE` from `authenticated`) on the business tables. No application path deletes these rows from a browser; the portal deletes through authenticated staff paths, and those keep their grants. This removes the destructive half of the exposure without touching any read or checkout path.

### Stage 1 — close reads, keep the public paths working
`docs/trax/remediation/02-enable-rls-with-tenant-policies.sql`

Per table: drop the blanket policies, enable RLS, then add
- a staff policy: `tenant_id = public.get_user_tenant_id() OR public.is_super_admin()` for `authenticated`;
- a customer policy for the portal tables, using the existing `customer_users` link so a signed-in customer sees their own rentals, payments, invoices and ledger rows only;
- a narrow `anon` **SELECT** policy on `vehicles` limited to `show_on_website = true` (plus locations/pricing as the booking site needs);
- an explicit `service_role` policy so server code and TRAX are unaffected;
- **no anon SELECT** on customers, rentals, payments, invoices, ledger_entries.

Anon INSERT is retained at this stage only where checkout needs it, so the booking flow keeps working while stage 2 is built. That is a deliberate, stated compromise: it closes cross-tenant reading, which is the severe part, and leaves write abuse to stage 2.

### Stage 2 — move checkout writes to the server (project, not a patch)
Replace the browser inserts with an authenticated edge function that validates the booking and writes with the service role, then revoke all remaining `anon` write grants. Until this lands, an attacker can still create junk rows with the public key.

## 4. Regression tests to run before and after each stage (staging first)

1. Public booking: browse vehicles, pick dates, complete a checkout end to end; confirm `customers`, `rentals`, `invoices`, `ledger_entries` rows are created.
2. Customer portal: sign in as a customer, open a booking, see its payments, invoices and ledger; confirm another customer's booking is not visible.
3. Portal staff: rentals, customers, payments, invoices, reports and insights load for a tenant admin; a manager's tab permissions still apply.
4. Cross-tenant: with a second tenant's staff session, confirm none of tenant A's rows are returned by any list or report.
5. Anon probe: repeat the count probe in this document — customers, rentals, payments, invoices and ledger must return `401`/`0 rows`; vehicles must return only website-visible rows.
6. TRAX: `node tests/trax/business-storage.mjs` and the portal TRAX suites, then a live read-only check that counts still match the portal.
7. Edge functions and webhooks (service role) unaffected: deposit holds, Stripe webhooks, accounting sync, TRAX messaging.

## 5. Rollback

`docs/trax/remediation/99-rollback.sql` restores the previous state for each stage: re-grant, disable RLS, and drop the policies the stage added. Rollback returns the database to the exposed state, so it is an emergency measure, not a resting place. Apply each stage in staging first, keep the two windows small, and do not apply stage 1 and stage 2 in the same change.
