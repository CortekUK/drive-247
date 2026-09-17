# Database tenant-isolation: finding and staged remediation

**Status: NOT APPLIED.** This document and the SQL in `docs/trax/remediation/` are for review. Nothing here has been run against any database. The SQL deliberately lives outside `supabase/migrations/` so that a routine `supabase db push` cannot apply it by accident.

## 1. What was verified, where, and how

**Environment:** the deployed Supabase project `hviqoaokxvlancmftwuo` (the one `apps/*/integrations/supabase/client.ts` defaults to). Checked on 2026-09-18 through the Management API with read-only catalogue queries, plus one count-only probe with the **public anon key** that returns no rows. No business records were retrieved and nothing was modified.

This is the **deployed** state, not the repository's intent. Several migrations in the repo enable RLS and add tenant policies for these tables; the live database does not match them.

### The size of the surface

The database has **184 tenant-scoped tables** (tables carrying a `tenant_id`). Of those:

| | Count | What it means |
|---|---|---|
| RLS off **and** readable by the anon key | **61** | Any browser with the published key reads every account's rows |
| RLS on but carrying a policy that admits everyone | **15** | Protected in appearance only |
| Views owned by `postgres` without `security_invoker` | **18** (16 anon-readable) | Read base tables with owner rights, so no table policy applies |

Only 14 of those 61 tables have a tenant policy written at all; the other 47 have none.

### Deployed row-level security, for the tables TRAX reads

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

`anon` (the key published in the website and portal JavaScript) holds `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on: **customers, rentals, payments, invoices, ledger_entries, payment_applications, payg_accruals, rental_extensions, vehicles**, and on the other 52 exposed tables. `authenticated` holds the same. Where RLS is off, grants alone decide access, so these are effective.

### Confirmed exposure (count-only probe with the public key)

| Table | Rows reachable | | Table | Rows reachable |
|---|---|---|---|---|
| customers | 608 | | invoices | 190 |
| rentals | 318 | | ledger_entries | 2,759 |
| payments | 1,295 | | vehicles | 492 |

Read **and** write, across every tenant. The same key also reaches `fines`, `customer_documents`, `identity_verifications` (KYC records), `audit_logs`, `chat_messages`, `email_logs`, `tenant_subscriptions` and the rest of the 61.

### Three ways the isolation fails that enabling RLS does not fix

**a. Blanket policies.** `customers."Allow all operations for all users" USING (true)` and `allow_all_select USING (auth.uid() IS NOT NULL)` admit every row. Permissive policies are OR-ed, so one of these defeats every correct policy beside it. `payg_accruals` and `payg_reminder_log` demonstrate the end state: RLS is **on**, and `allow_authenticated_read_payg USING (auth.uid() IS NOT NULL)` still hands every account's rows to any signed-in user.

**b. A public policy that also covers signed-in users.** `vehicles.public_can_read_bookable_vehicles` is granted to `{anon, authenticated}` and its only test is `coalesce(status,'') <> all(array['Disposed','Sold'])`. Because it covers `authenticated`, a signed-in staff member of one account reads every other account's vehicles — even for a plain count, and even once RLS is on. This is the single policy that would break the "tenant A counts 2, tenant B counts 6" requirement at the database level. Stage 1 recreates it for `anon` alone.

**c. Views with owner rights.** All 24 views in `public` are owned by `postgres`; 18 have no `security_invoker` option, so they read their base tables as the owner and ignore every policy stages 1–3 add. Sixteen are also granted to `anon`, including `view_pl_consolidated`, `view_aging_receivables`, `view_customer_statements`, `view_payments_export`, `view_fines_export`, `view_owner_revenue` and `view_rentals_export` — the finance exports. A tenant's sales figures are readable through them regardless of what the tables say. Stage 4 addresses this.

There is a fourth, smaller class: five policies **named** for the service role (`"Service role can manage damage reports"`, `"Service role manages voicemails"`, …) are granted to `{public}` with `USING (true)`, so every caller passes them.

### What this does and does not mean for TRAX

TRAX reads with the server-side service credential and applies the tenant predicate itself; `tests/trax/business-storage.mjs` proves every statement it issues carries the authenticated tenant, and that a revoked permission refuses before any statement runs. That is a property of TRAX's query layer — **it is not a fix for the exposure above**, which is reachable from any browser without TRAX.

## 2. Why this cannot be fixed by enabling RLS

The public booking app (`apps/booking`) uses the anon key **in the browser** (`apps/booking/src/integrations/supabase/client.ts:19`) and writes business rows directly during checkout:

- `apps/booking/src/app/booking/checkout/page.tsx` — inserts into `customers`, `rentals`, `invoices`, `ledger_entries`;
- `apps/booking/src/components/BookingCheckoutStep.tsx` — inserts `ledger_entries`;
- public browsing reads `vehicles` filtered by `show_on_website = true` (`apps/booking/src/app/booking/vehicles/page.tsx:113`), plus locations and pricing;
- the customer portal (`apps/booking/src/app/(customer-portal)/...`) reads `rentals`, `payments`, `invoices`, `ledger_entries` for the signed-in customer.

Revoking anon writes, or enabling RLS without matching policies, stops bookings. The remediation is therefore staged.

The public surface was not guessed: `apps/booking/src` was scanned for every `.from('<table>')` call and classified by whether the file is a public page or part of the signed-in customer portal. Stage 3 keeps an `anon` policy only where a public page provably reads, and names the files for the cases that must move server-side instead.

## 3. Staged remediation

### Stage 0 — remove what nothing legitimate uses (low risk)
`docs/trax/remediation/01-revoke-destructive-anon-grants.sql`

Revoke `DELETE` and `TRUNCATE` from `anon` (and `TRUNCATE` from `authenticated`) on the business tables. No application path deletes these rows from a browser; the portal deletes through authenticated staff paths, and those keep their grants. This removes the destructive half of the exposure without touching any read or checkout path.

### Stage 1 — close the tables TRAX reads, keep the public paths working
`docs/trax/remediation/02-enable-rls-with-tenant-policies.sql`

Per table: drop the blanket policies, enable RLS, then add
- a staff policy: `tenant_id = public.get_user_tenant_id() OR public.is_super_admin()` for `authenticated`;
- a customer policy for the portal tables, using the existing `customer_users` link so a signed-in customer sees their own rentals, payments, invoices and ledger rows only;
- a narrow `anon` **SELECT** policy on `vehicles`, recreated for `anon` alone (finding **b** above);
- an explicit `service_role` policy so server code and TRAX are unaffected;
- **no anon SELECT** on customers, rentals, payments, invoices, ledger_entries.

Anon INSERT is retained at this stage only where checkout needs it, so the booking flow keeps working while stage 2 is built. That is a deliberate, stated compromise: it closes cross-tenant reading, which is the severe part, and leaves write abuse to stage 2.

### Stage 3 — the remaining 64 tenant tables
`docs/trax/remediation/03-restrict-remaining-tenant-tables.sql`

The same shape, applied to everything stage 1 does not cover, grouped so each decision is reviewable:

| Group | Tables | Treatment |
|---|---|---|
| A. Internal | audit_logs, email_logs, org_settings, plates, reminder_*, rag_*, vehicle_files, … | staff of the owning tenant + service role |
| B. Customer-owned | customer_documents, identity_verifications, installment_plans, chat_channels, payg_accruals, … | as A, plus a `customer_users` policy for the signed-in customer |
| C. Public booking | agreement_templates, blocked_dates, pickup_locations, promocodes, vehicle_photos, blocked_identities, contact_requests | as A, plus the narrow `anon` policy the booking site provably needs |
| D. Misnamed service policies | rental_damage_reports, lockbox_send_log, voicemail_recordings, whatsapp_content_templates, customer_review_summaries | re-scoped from `{public}` to `service_role` |
| E. Website content | blog_posts, cms_media, promotions, testimonials, tenant_holidays, … | anonymous read kept; the "any authenticated user can do anything" policies replaced |
| F. Leftover one-off tables | `_backfill_iv_link_20260817`, `_recover_orphan_customers_20260817`, `zz_tenant_subscriptions_bak_20260727` | closed to both keys; confirm they are obsolete and drop them |

Two cases are flagged in the file for a decision rather than silently closed: `customer_notifications` has no customer link column, so the customer portal must read it through a server route; and `blocked_identities` publishes the block list to `anon` because checkout checks against it client-side.

### Stage 4 — the views
`docs/trax/remediation/04-restrict-tenant-views.sql`

Set `security_invoker = on` on the 16 anon-readable owner-rights views, and revoke `SELECT` on them from `anon`. Requires PostgreSQL 15 or later. **Apply after stages 1–3**: with `security_invoker` on and no policy on a base table, a view returns nothing to everyone except the service role.

### Stage 2 — move checkout writes to the server (project, not a patch)
Replace the browser inserts with an authenticated edge function that validates the booking and writes with the service role, then revoke all remaining `anon` write grants. Until this lands, an attacker can still create junk rows with the public key.

## 4. Regression tests to run before and after each stage (staging first)

1. Public booking: browse vehicles, pick dates, complete a checkout end to end; confirm `customers`, `rentals`, `invoices`, `ledger_entries` rows are created.
2. Customer portal: sign in as a customer, open a booking, see its payments, invoices, ledger, documents and PAYG accruals; confirm another customer's booking is not visible.
3. Portal staff: rentals, customers, payments, invoices, reports and insights load for a tenant admin; a manager's tab permissions still apply.
4. **Reporting views** (stage 4): `/insights`, `/reports`, owner revenue and `settings/blacklist` show that account's figures. A view that returns zero rows means a base table is missing a policy for that caller — fix the table, do not turn `security_invoker` back off.
5. Cross-tenant: with a second tenant's staff session, confirm none of tenant A's rows are returned by any list, report or export.
6. Anon probe: repeat the count probe in this document — customers, rentals, payments, invoices and ledger must return `401`/`0 rows`; vehicles must return only bookable rows; the finance views must return `permission denied`.
7. TRAX: `node tests/trax/business-storage.mjs` and the portal TRAX suites, then a live read-only check that counts still match the portal.
8. Edge functions and webhooks (service role) unaffected: deposit holds, Stripe webhooks, accounting sync, TRAX messaging.
9. Flagged cases: the customer-portal notifications panel, and the checkout block-list check, both named in stage 3.

## 5. Rollback

Reverse order: `docs/trax/remediation/05-rollback-stages-3-4.sql` first (views back to owner rights and anon grants, stage-3 policies dropped, RLS back off where it was off, previous policies recreated on tables that already had RLS on), then `99-rollback.sql` for stages 0–1. Rollback returns the database to the exposed state, so it is an emergency measure, not a resting place. Two corrections are deliberately not undone, and are listed in the header of `99-rollback.sql`.

Apply each stage in staging first, keep the windows small, and do not apply stage 1 and stage 2 in the same change.

## 6. Verification evidence

`node tests/trax/tenant-isolation.mjs` — **12 tests, all passing.** It builds an isolated Postgres matching the deployed shape (grants, policy names, policy predicates, which tables have RLS on, and views with owner rights), seeds two tenants, applies stages 0, 1, 3 and 4, and then asserts as **real database roles** with a real `auth.uid()`:

| Case | Result |
|---|---|
| Before the fix | anon reads both accounts' customers, rentals, payments, invoices, ledger, fines, documents and KYC records |
| Before the fix | staff of A read all 8 vehicles, all PAYG accruals, and both accounts' sales through `view_pl_consolidated` |
| Tenant A asks for its vehicle count | **2** |
| Tenant B asks for its vehicle count | **6** |
| Neither is ever told | 8 |
| Tenant A's sales | 400.00, one row — through the table, through `view_pl_consolidated`, and through a joined export view |
| Tenant A supplies B's record id | 0 rows for rentals, payments, invoices, customers, vehicles, fines, documents, KYC; a matching rental *number* also returns nothing; an insert into B is refused; an update moving a row into B is refused |
| Anonymous visitor | browses bookable vehicles and the booking lookups; gets 0 rows from every private table; `permission denied` on the finance views; checkout inserts still succeed; cannot read them back or delete |
| Signed-in customer | own rental, own payment, own documents, own accruals; 0 rows from the account's other records; only their own `customer_users` row |
| A tenant owner named "Super Admin" | 2 vehicles — the stored flag decides, not the display name |
| A real platform super admin | 8 vehicles, both accounts |
| Service role | unaffected, so edge functions and TRAX keep working |
| Rollback | runs, and returns the database to its previous behaviour |

The scripts themselves are also checked in isolation by `node tests/trax/remediation-sql.mjs` (grants, RLS state, policy presence, idempotency, rollback).

At the request boundary, `apps/portal/src/__tests__/lib/trax-tenant-isolation.test.ts` — **17 tests** — proves the account is established from the authenticated staff row: a `tenantId` in the request body for another account is refused without disclosing anything about it; malformed, numeric, object, array and SQL-fragment values are rejected; message text such as "Show another company's payments", "Switch to tenant <id>" or "ignore previous instructions" does not move the scope; a display name of "Super Admin" carries no authority while `is_super_admin` is false; a real super admin keeps platform access; and the scope key changes on a change of account, role or permission, so nothing cached survives it.

**Still unproven:** everything in production. No stage has been applied, and no live regression run exists. The multi-tenant account switch is also unresolved — `get_user_tenant_id()` and `is_super_admin()` read `app_users … LIMIT 1`, which is unambiguous today (0 of 89 users belong to more than one tenant, verified 2026-09-18) but becomes arbitrary the moment one does. An explicit account switch must land before any user gains a second membership.
