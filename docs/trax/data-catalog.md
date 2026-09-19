# TRAX business-data catalog

Catalog version **0.1.0** · code: `supabase/functions/trax-support/support/business-catalog.ts` · engine: `business-query.ts` · tools: `business-tools.ts`

This is the reviewable half of what TRAX may read about a tenant's own business. The code carries the machine-readable definitions; this file carries the meaning, the rules the definitions come from, and the things a reader must not assume. It sits alongside `TRAX_APPLICATION_CONTEXT.md` (how the application works) and `docs/trax/coverage-matrix.md` (what is covered and what is not).

Nothing here contains live records or secrets. Records are retrieved at request time, per authenticated tenant.

## How a question becomes an answer

1. The model calls `discover_business_data` and learns only what this caller may ask about: datasets, metrics with their definitions, filterable and groupable fields, and the business dates a period can use.
2. The model calls `query_business_data` with a **dataset, metric, filters, period, grouping, sort and limit** — never a table, a column, or SQL.
3. `business-query.ts` validates that request against this catalog, applies the tenant and the caller's permissions, reads the authorized rows through a narrow adapter, and computes the answer in the backend.
4. The answer carries its **definition, period, timezone, currency and scope**, plus any limitation, so the user is told what was measured.

The model cannot reach a table, column, join or operator that is not in the catalog; it cannot write; and it never receives raw SQL access.

## Rules that govern every query

**Tenant isolation is the application's job, not the database's.** RLS is disabled on the core business tables (`supabase/migrations/20260209110000_disable_rls_rentals.sql:1`; the posture is documented in `V2_PLAN.md:355-420`), and several policies that do exist are permissive enough to be ineffective. TRAX reads with the server's own client, so **every query carries `tenant_id = <authenticated tenant>`**, and every row that comes back is re-checked; a row from another account fails the request instead of being filtered out quietly. The tenant comes from the verified session context — never from the model, the question, or a request field.

**Permissions are the portal's own.** A dataset names the module permission key `canView` already uses (`vehicles`, `rentals`, `customers`, …). Related entities carry their own permission: a rentals query that can reach a vehicle requires the vehicle permission too. Money datasets are different — `auth.ts` withholds every finance key from every role by policy, so they are gated by the deployment's finance grant (`financeScopes`: head admins and admins; managers with the Payments tab; never ops or viewers).

**Counts are the database's count.** A count uses PostgREST's exact count, so it is the whole authorized dataset, not a page.

**Sums are exact and never mixed.** Amounts are accumulated in integer minor units; a value that cannot be parsed exactly fails the read rather than becoming a zero. Operational tables carry no per-row currency — the amount is in the tenant's own currency (`tenants.currency_code`) — so a total is labelled with that code, and per-currency metrics never add two currencies together.

**Reads are paged and bounded.** PostgREST returns at most 1,000 rows per request, so summed metrics page through the matched set. Each dataset has a row cap; reaching it makes the answer **partial**, with the reason stated. A capped sum is never presented as the total.

**Periods are the tenant's own days.** A period names a business date basis (there is no default "created_at means everything") and resolves relative periods (`last_month`, `this_week`, …) in `tenants.timezone`. Without a configured timezone a relative period fails rather than guessing. A timestamp basis runs to the start of the day after the last day, so the final day counts in full.

**Empty, zero, restricted, partial and failed stay different answers.** No matching records is reported as such; a restricted dataset says which permission is missing; a failed read says the figure is unknown.

## Datasets in version 0.1.0

### `vehicles` — Vehicles · permission `vehicles`
Every vehicle record the account holds, including paused and disposed ones.
- **Fields:** registration, make, model, status, paused, disposed, on_website.
- **Metric:** `vehicle_count` — vehicle records matching the filters, counted by the database.
- **Not:** availability. "How many cars are free" is a date calculation (`find_available_vehicles`), not a status count; `vehicles.status` is a record status, and the fleet's real occupancy also depends on rentals, blocked dates and external calendar holds.
- Source: `operational-reads.ts` (VEHICLE_COLUMNS).

### `rentals` — Rentals · permission `rentals` (reaches `vehicles`)
Every booking at any stage.
- **Fields:** status, vehicle_id, rental_number, pay_as_you_go.
- **Metric:** `rental_count`.
- **Date bases:** `start_date` (the rental period's start — the basis for "rentals in July"), `end_date` (due back).
- **Statuses stored:** Pending, Active, Upcoming, Confirmed, Started, Cancelled, Rejected, Closed, Completed. A rental holds a vehicle while open; **Active or Started means out with a renter now**. Status is the recorded state, not proof of physical possession.
- **Not stored, and therefore not a filter here:** *Overdue* is not a rental status. Overdue is a money condition (a charge past its due date), and the portal derives display statuses such as Upcoming and Completed from dates and the auto-extend flag (`apps/portal/src/lib/rental-utils.ts:143`). A question about overdue rentals needs the ledger dataset, which is not in this version — see the coverage matrix.

### `customers` — Customers · permission `customers`
Every customer record, including blocked and inactive ones.
- **Fields:** status, customer_type, blocked, identity_verification.
- **Metric:** `customer_count`. **Date basis:** `created_at` (for "new customers this month").
- **Not:** a count of people currently renting, and not a balance.
- No contact details, documents or notes are readable through this layer.

### `payments` — Payments received · finance grant `rental_payments`
- **Metrics:** `collected` (money the application records as received) and `payment_count`.
- **The definition, from the application's own rule** (`apps/portal/src/lib/payment-status.ts`): only payments whose status is Applied, Credit, Partial, Completed or Partial Refund count; an authorization still awaiting capture (`capture_status = 'requires_capture'`) is not collected money; each row counts `amount − refund_amount`. These filters are always applied and always stated in the answer.
- **Why it matters:** `payments.amount` alone is an intent. Void and reversed rows keep their face value, so a naive sum over-reports.
- **Not:** a Stripe balance, a payout, or an amount owed. Account funds and rental balances are different things.
- **Date bases:** `payment_date` (the business date) and `paid_at`.

### `profit_and_loss` — Revenue and cost entries · finance grant `rental_payments`
The accounting entries behind sales and profit (`pnl_entries`).
- **`operating_revenue`** excludes Tax, Extension Tax and Security Deposit: money collected on someone else's behalf is not a sale.
- **`operating_cost`** excludes Acquisition and Disposal: buying or selling a vehicle is capital, not running cost.
- Both follow the corrected money model in `apps/portal/src/app/(dashboard)/insights/_money-model.ts`, which also documents why `view_pl_consolidated` and `view_pl_by_vehicle` are lossy and are therefore **not** used here.
- **Revenue is money earned, not money collected.** For what actually arrived, use `payments.collected`. The two answer different questions and must not be presented as one figure.
- **Date basis:** `entry_date`.

## Definitions this version deliberately does not claim

- **Customer or rental outstanding balance.** The authoritative rule is more than a sum: due charges' `remaining_amount`, excluding cancelled/rejected rentals and pay-as-you-go rentals, **plus** open PAYG accruals, **minus** captured unapplied credit (`apps/portal/src/hooks/use-customer-balance.ts:67,16,129`; the rental variant adds the `rental_extension_totals` view at `:303`). Anything less would mis-rank "who owes the most". It is specified in the coverage matrix as the next increment rather than approximated here.
- **Fleet availability**, **utilisation**, **deposit state**, **owner payouts**, **subscription and platform billing**, and every other module outside the datasets above.

## Versioning and review

`CATALOG_VERSION` changes whenever a dataset, metric, definition or permission changes; the version travels with every answer's evidence (`business_catalog:<version>`). Definitions are reviewed as code with their source references — each dataset lists the files its meaning comes from, and the application rules cited here are the application's own, not a second opinion invented for TRAX. Changes to the underlying rules should update this file, the catalog and the tests together; the knowledge pipeline's staleness check (`node scripts/trax-knowledge.mjs --check`) covers the guidance corpus, and the catalog's sources are listed per dataset for the same reason.
