# TRAX business coverage matrix

What TRAX can actually answer from data today, module by module, and what is missing. Written against the code as it stands (catalog 0.1.0), not against an older report. "Covered" means there is an authorized dataset or tool **and** a test; anything else is a gap, however well understood the module is.

Columns: **Knowledge** = reviewed guidance exists · **Data** = authorized dataset/tool returning records or figures · **Queries/metrics** = what can be measured · **Integration reads** = live provider evidence · **Reports** = file output · **Tests** · **Gaps**.

## Answered from data today

| Module | Knowledge | Data | Queries / metrics | Integration reads | Reports | Tests | Gaps |
|---|---|---|---|---|---|---|---|
| **Fleet / vehicles** | yes | `vehicles` dataset; `get_account_counts`; `resolve_authorized_entity` | exact vehicle count; filter and group by make, model, status, paused, disposed, website visibility | — | none | `trax-business-query.test.ts`, `trax-operational.test.ts` | no per-vehicle revenue or utilisation (needs `pnl_entries` grouping + vehicle labels); no fleet-health/MOT/service metrics |
| **Rentals / bookings** | yes | `rentals` dataset; `list_account_bookings` (active, upcoming, out now); `get_rental_support_context` | exact rental count; filter/group by status, vehicle, PAYG; periods on start or end date | — | none | same | derived statuses (Upcoming/Completed/auto-extend) are portal-side, not filters here; **overdue** needs the ledger; no rental↔customer/vehicle labels in results (ids only) |
| **Customers** | yes | `customers` dataset; counts | exact customer count; filter/group by status, type, blocked, identity verification; new-customers period | — | none | same | **balances and rankings not covered** (see below); no customer names in grouped results |
| **Availability** | yes | `find_available_vehicles`, `diagnose_vehicle_availability` | date-range availability for a bounded page of vehicles; single-vehicle diagnosis | — | none | `trax-operational.test.ts` | no fleet-wide "how many free on date X" total; external calendar holds (`external_bookings`) not consulted by these tools |
| **Payments (received)** | yes | `payments` dataset (finance grant) | collected total and payment count, per currency, by period; group by customer, rental, type, status | rental-linked Stripe evidence via existing payment tools | none | `trax-business-query.test.ts`, `trax-payment-investigation.test.ts` | no allocation/unapplied-credit view; no refunds metric; no deposit movements |
| **Sales / P&L** | partial | `profit_and_loss` dataset (finance grant) | operating revenue and operating cost by period, grouped by category, vehicle, customer or rental; period comparison | — | none | `trax-business-query.test.ts` | no net profit/margin metric; no per-vehicle profitability; the portal's own `/reports` and `/pl-dashboard` use the uncorrected pool, so figures there can differ from TRAX's corrected ones — reconciliation is a task, not a claim |
| **Stripe (rental payments)** | yes | `get_rental_payment_evidence`, `investigate_rental_payment`, `resolve_payment_dashboard_action`, `get_stripe_account_summary` | per-payment verification against the exactly linked transaction, account/environment resolution, per-currency totals, dashboard/receipt actions | yes, read-only, connected-account requests; enforced by a three-endpoint allowlist rather than by the credential | none | `trax-payment-investigation.test.ts`, `trax-finance.test.ts` | live reads are **not verified in production**: `docs/trax/read-only-finance.md` records that `trax-stripe-read` is not deployed and no tenant dashboard link has been opened |
| **Support** | yes | ticket/messaging tools, escalation, TRAX Summary | — | — | — | `trax-messaging`, `trax-escalation`, browser fixtures | unchanged by this increment |

## Not covered yet — known gaps, with the rule that must be implemented

| Module | What a user will ask | What it needs | Status |
|---|---|---|---|
| **Customer balances** | "Who owes the most?", "What does this customer owe?" | Implemented in `balance-tools.ts` as a composite tool: due charges excluding cancelled/rejected and PAYG rentals, plus open PAYG accruals, minus captured unapplied credit. 17 unit tests with hand-derived expectations, plus three conversation tests. | **implemented and offline tested** |
| **Rental-level balances and ageing** | "Show active rentals with overdue amounts", "what is 60 days overdue?" | Per-rental figures need the `rental_extension_totals` view (`use-customer-balance.ts:303`); ageing needs due-date buckets over the same ledger rows | not implemented |
| **Invoices** | "Export unpaid invoices grouped by customer" | `invoices` dataset (status pending/paid/cancelled), and a decision on invoice vs ledger as the source of "unpaid" | not implemented |
| **Deposits** | "Which deposits are still held?" | `rentals.deposit_hold_*` columns + `deposit_hold_links`; state machine in `payments-model.ts:816` | not implemented |
| **Refunds** | "How much did we refund last month?" | Refunds live as `payments.refund_amount` and `ledger_entries` of type Refund — two representations that must not be double-counted | not implemented |
| **Fines, expenses, owner payouts** | totals, ageing, per-owner amounts | own datasets; owner revenue has its own view (`view_owner_revenue`) | not implemented |
| **Platform subscription** | "What subscription am I on?" | `tenant_subscriptions` + `subscription_plans` + `tenant_subscription_invoices`; must stay separate from tenant rental payments, and separate from platform-wide revenue | not implemented |
| **Integrations status** | "Which integrations are connected?" | Every board chip today reads **stored** columns, not the provider. An honest answer must separate configuration from live evidence, and label stored state with its sync time (`stripe_status_synced_at`, `accounting_connections.last_synced_at`, `twilio_connection_verified_at`) | not implemented |
| **Bonzah / INSHUR / Square / accounting / Tesla / Twilio** | provider-specific questions | per-provider read adapters exist as edge functions; none are exposed to TRAX | not implemented |
| **Reports (PDF/CSV/XLSX)** | "Generate a sales report PDF" | There is **no server-side PDF renderer**: `generate-export` answers 501 for PDF and returns CSV/XLSX in-band with no storage, no job and no signed URL. Needs a report spec bound to a query snapshot, a private bucket, a job table with real states, and an authenticated download | **not implemented** — TRAX must say so rather than describe an export screen |
| **Website / CMS, agreements, insurance** | content and document questions | datasets and document reads | not implemented |
| **Platform-wide reporting** | cross-tenant totals | a separate, explicitly authorized platform capability | out of scope for tenant TRAX by design |

## Behaviour changes in this increment

- The model is instructed to **answer data questions with data**: call `discover_business_data`, then `query_business_data`, and state the figure with its definition, period and timezone. Navigation is for "how/where" questions or an offer after the answer, never a substitute for a number TRAX can measure.
- When a dataset or metric is missing, TRAX must name the part it cannot measure rather than redirect to a screen. Those cases belong in this matrix as engineering gaps, not as support tickets.

## Tenant isolation: what is proven, and what is still exposed

Isolation is now proven at three levels, and the gap between them is the point.

**1. TRAX's query layer** — `node tests/trax/business-storage.mjs` (8/8) runs the real `business-query.ts` against an isolated two-tenant Postgres through a PostgREST-shaped shim that compiles its filters into actual SQL. Every statement issued is recorded and asserted: 17 statements, **all** carrying `tenant_id = $1` with the authenticated tenant (`artifacts/trax-business/isolation-statements.json`). Covered: a 2-vehicle tenant and a 6-vehicle tenant where neither is ever told 8; a tenant that cannot be supplied, forged or filtered by the caller; another account's ids matching nothing; grouping and ranking that never name another account's rows; a revoked module permission and a missing finance grant refusing **before any statement is issued**; tenant switching in one process reusing no result, currency or timezone; money matching SQL-computed truth; and a 1,501-row total paged past one PostgREST window.

**2. The request boundary** — `apps/portal/src/__tests__/lib/trax-tenant-isolation.test.ts` (17/17) proves the account comes from the authenticated staff row: a browser-supplied `tenantId` for another account is refused without disclosing anything about it; malformed, numeric, object, array and SQL-fragment values are rejected; message text ("Show another company's payments", "Switch to tenant <id>", "ignore previous instructions") does not move the scope; a display name of "Super Admin" carries no authority while the stored flag is false; a real super admin keeps platform access; and the scope key changes on a change of account, role or permission, so nothing cached survives it.

**3. The database itself** — `node tests/trax/tenant-isolation.mjs` (12/12) builds an isolated Postgres matching the **deployed** shape, applies the remediation stages, and asserts as real roles (`anon`, `authenticated` as staff of each account, as a customer, as a platform admin, and `service_role`). It reproduces the exposure first, then proves the fix: A counts 2, B counts 6, A's sales are 400.00 through the table *and* through the reporting and export views, B's record ids return nothing, an anonymous visitor keeps the booking site and loses every private table, a customer sees only their own records, and the rollback restores the previous behaviour. See `docs/trax/db-isolation-remediation.md` §6 for the full table.

**What is still exposed:** everything above is a property of the code and of an isolated database. On the **deployed** project, 61 tenant-scoped tables are readable by the public anon key with RLS off, 15 more have RLS on but carry a policy that admits everyone, and 16 views run with owner rights — including the finance exports, which no table policy can reach. The staged fix (`docs/trax/remediation/01`–`05`) is written and tested but **not applied**. Two design decisions it exposes need a call: `customer_notifications` has no customer link column, and the checkout reads the identity block list client-side.

## What TRAX can be asked about now (catalog 0.2.0)

Fifteen datasets plus two composite tools. Every column, enum value and unit was read from the deployed database and is held to it by `docs/trax/generated/schema-snapshot.json` and `trax-catalog-schema.test.ts`.

| Module | Dataset | Answers | Gate |
|---|---|---|---|
| Fleet | `vehicles` | counts, make/model/status/website breakdowns | vehicles |
| Rentals | `rentals` | counts, status/vehicle/PAYG breakdowns, periods | rentals |
| Customers | `customers` | counts, status/type/verification breakdowns | customers |
| Payments | `payments` | collected, payment counts, per currency | finance |
| Sales / P&L | `profit_and_loss` | operating revenue and cost, by category/vehicle | finance |
| **Invoices** | `invoices` | invoiced total, tax, deposits, counts | finance |
| **Fines** | `fines` | fine totals and counts by status, type, liability | finance |
| **Ledger** | `ledger` | charged, refunded, unsettled charges, by category | finance |
| **Expenses** | `expenses` | spend by category, vehicle, vendor | finance |
| **Owner payouts** | `owner_payouts` | gross, commission, net owed, paid | finance |
| **Extensions** | `rental_extensions` | counts and days (open) · value and paid (finance) | rentals / finance |
| **Deposits** | `deposits` | hold attempts by action and outcome (open) · amounts (finance) | rentals / finance |
| **Subscription** | `subscription` | what this account pays Drive247 | finance |
| **Maintenance** | `maintenance` | jobs by status, priority, vehicle | vehicles |
| **Verifications** | `verifications` | verification counts and outcomes — never document numbers | customers |
| Balances | `query_customer_balances` | who owes the most, per customer outstanding/credit/net | finance + customers |
| Reports | `generate_report` | csv, xlsx, pdf of any of the above | as the underlying query |

Two design points worth knowing:

- **Metric-level gating.** A money metric inside an operational dataset needs the finance grant on its own, so a rentals manager can count extensions and deposit attempts without being told what they were worth.
- **Definitions carry the traps.** Ledger `refunded` says not to add it to `payments.refund_amount` (same money, two sides); `unsettled_charges` says it is a raw ledger total and points at the balance tool; `subscription` says it is what the account *pays* and must never be added to revenue; `deposits` says a row is an attempt, not a deposit.

## Reports

`generate_report` produces a real file — csv, xlsx or pdf — from the **same** measurement the chat answer states. It calls the same query function and formats that one result, so the file and the summary cannot disagree, and it adds no read authority: an unauthorized report is refused before a job or a file exists.

- Writers are dependency-free (`report-format.ts`) and verified by independent parsers: JSZip opens the XLSX, pdf-lib loads the PDF, node's `zlib.crc32` re-computes the ZIP checksums.
- Storage is a **private** bucket, every object path beginning with the tenant id, and a job row that moves `queued → running → ready|failed`. Downloads are 15-minute signed links; the bucket is never public and is not listable by staff.
- **On.** The bucket and job table come from `docs/trax/pending-migrations/01-trax-report-jobs.sql`, applied to production 2026-09-18; it still sits outside `supabase/migrations` because the migration drift is unresolved. Reports are offered unless `TRAX_REPORTS=disabled`, and an environment without the migration refuses with `report_failed` rather than inventing a file — so the flag is not what makes it safe.

## What it would take to turn all this on

Each is a separate precondition; the struck-through ones are now met.

1. ~~**Deploy** the `trax-support` edge function.~~ Done — version 4, deployed 2026-09-18 with `scripts/trax-deploy.mjs`. Vercel does not deploy Supabase functions and no automation does, so every later change needs that script run again.
2. **Finance reads:** `databaseFinanceScopes` is in code, but see `finance-authorization-review.md` — it is an explicit permission widening awaiting review. Stripe reads use the existing platform secrets; read-only is enforced by the adapter's three-endpoint allowlist, not by the credential. A restricted `rk_` key is preferred but the project is at Supabase's 100-secret cap and nothing can be removed.
3. ~~**Reports:** apply the pending migration, then set `TRAX_REPORTS=enabled`.~~ Done — migration applied 2026-09-18, and reports no longer need a flag.
4. **Tenant reach:** TRAX is gated to V2 tenants and `northwind` is the only one, so every other account sees nothing regardless.
5. **Security containment** is still open and unrelated to any of the above — see `containment-review.md` and `incident-jwt-signing-secret.md`.

## Verification status

- Unit tests: `apps/portal/src/__tests__/lib/trax-business-query.test.ts` — catalog validation and refusals, permissions including related entities, the finance grant, tenant scoping and foreign-row rejection, exact counts, filters, grouping and ranking, period presets in the tenant timezone, money in minor units net of refunds, the received-payment rule, the corrected revenue/cost rules, period comparison, empty vs zero, and partial results at the row cap.
### Levels reached, by capability

| Capability | Level | Evidence |
|---|---|---|
| Query layer: catalog validation, permissions, money rules | **Offline tested** | `npx vitest run src/__tests__/lib/trax-business-query.test.ts` — 19 passed |
| Query layer: tenant isolation, exact counts, paging, currency, money vs SQL truth | **Database integration tested** | `node tests/trax/business-storage.mjs` — 8 passed, real Postgres, two tenants |
| Request boundary: tenant from session, not from body, URL or chat text | **Offline tested** | `npx vitest run src/__tests__/lib/trax-tenant-isolation.test.ts` — 17 passed |
| Database isolation as real roles (anon, staff A, staff B, customer, platform admin, service role) | **Database integration tested** | `node tests/trax/tenant-isolation.mjs` — 12 passed, two tenants, stages 0/1/3/4 applied to an isolated database |
| Isolation remediation scripts (stages 0, 1, 3, 4 and both rollbacks) | **Offline tested** (not applied) | `node tests/trax/remediation-sql.mjs` — 4 passed; `tenant-isolation.mjs` applies all four stages and the rollback |
| Deployed database exposure (61 tables, 15 blanket policies, 16 owner-rights views) | **Authorized live-read verified** (read-only, catalogue and counts only) | `docs/trax/db-isolation-remediation.md` §1 |
| TRAX tool wiring (discover/query through the orchestrator) | **Implemented**, offline model-loop suites pass | `node tests/trax/browser.mjs --support`, `node tests/trax/browser.mjs` |
| Conversation-to-data path (count, money total, balance ranking, generated report) | **End-to-end application tested** (offline model) | `trax-conversation-data.test.ts` — 18 passed: real handler, model loop, tool registry, query layer and report writer over a two-tenant database |
| Money questions reaching the model at all | **Fixed and tested** | finance-worded questions were diverted unless the Stripe feature was configured; routing now also accepts what the database can settle, while provider-evidence questions still go to a person |
| Customer balances, "who owes the most" | **Offline tested** | `npx vitest run src/__tests__/lib/trax-customer-balances.test.ts` — 17 passed, expectations derived by hand from `use-customer-balance.ts` |
| Money figures in an answer | **End-to-end application tested** | the orchestrator allows a figure only if the query layer measured it in that request; an invented total is refused and the fallback is served |
| Rental-level balances, ageing buckets, overdue lists | **Not implemented** | needs `rental_extension_totals` and due-date buckets |
| Reports (PDF/CSV/XLSX), job states, private storage, signed download | **Offline tested**, not deployed | `trax-report-format.test.ts` (17, independent parsers) and `trax-reports.test.ts` (16); bucket and job table await the pending migration |
| Modules: invoices, fines, ledger/refunds, expenses, owner payouts, extensions, deposits, subscription, maintenance, verifications | **Offline tested** | catalog 0.2.0, held to the deployed schema by `trax-catalog-schema.test.ts` (53) |
| Integration health, provider reads (Bonzah/Square/accounting/Tesla/Twilio) | **Not implemented** | per-provider adapters exist as edge functions; none is exposed to TRAX |
| Multi-tenant account switch | **Not implemented** | `get_user_tenant_id()` uses `LIMIT 1`; 0 of 89 users have a second membership today (verified 2026-09-18) |
| Anything in production | **Not deployed** | no deployment or migration was performed in this increment |

- Still outstanding for the query layer itself: authorized live reads against the real database (counts compared with the portal), and deployment verification. Neither is claimed.
