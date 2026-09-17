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
| **Stripe (rental payments)** | yes | `get_rental_payment_evidence`, `investigate_rental_payment`, `resolve_payment_dashboard_action`, `get_stripe_account_summary` | per-payment verification against the exactly linked transaction, account/environment resolution, per-currency totals, dashboard/receipt actions | yes, read-only, restricted keys, connected-account requests | none | `trax-payment-investigation.test.ts`, `trax-finance.test.ts` | live reads are **not verified in production**: `docs/trax/read-only-finance.md` records that `trax-stripe-read` is not deployed and no tenant dashboard link has been opened |
| **Support** | yes | ticket/messaging tools, escalation, TRAX Summary | — | — | — | `trax-messaging`, `trax-escalation`, browser fixtures | unchanged by this increment |

## Not covered yet — known gaps, with the rule that must be implemented

| Module | What a user will ask | What it needs | Status |
|---|---|---|---|
| **Customer / rental balances** | "Who owes the most?", "Show active rentals with overdue amounts" | The full rule: due charges' `remaining_amount` excluding cancelled/rejected and PAYG rentals, **plus** open PAYG accruals, **minus** captured unapplied credit (`use-customer-balance.ts:67,16,129`), and for a rental the `rental_extension_totals` view (`:303`). Needs a ledger dataset plus a composite metric, not a single sum. | **not implemented** — deliberately not approximated |
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

## Verification status

- Unit tests: `apps/portal/src/__tests__/lib/trax-business-query.test.ts` — catalog validation and refusals, permissions including related entities, the finance grant, tenant scoping and foreign-row rejection, exact counts, filters, grouping and ranking, period presets in the tenant timezone, money in minor units net of refunds, the received-payment rule, the corrected revenue/cost rules, period comparison, empty vs zero, and partial results at the row cap.
- Not yet done in this increment: a two-tenant end-to-end run against real SQL for the query layer, live authorized reads, generated-file validation, and deployment verification. Those belong with the next increments and must not be claimed until they run.
