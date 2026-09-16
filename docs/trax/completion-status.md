# TRAX requirements: current completion status

Reviewed locally on 2026-09-15. **Update:** The newer [in-app support messaging handover](in-app-support.md) supersedes the original single-update ticket workflow below. **Update:** The newer [in-app support messaging handover](in-app-support.md) supersedes the original single-update ticket workflow below. V2 only. This is the current handover for the tenant-isolated agent/support-escalation request; older milestone reports are historical. No production deployment, migration, finance activation or destructive cleanup was performed.

| Requested behavior | Implementation in this repository | Remaining verification or activation |
|---|---|---|
| OpenAI conversational agent | Configurable Responses model, strict schemas, bounded orchestration, honest prepared fallback | Most recent real connectivity probe timed out without an HTTP response. An earlier probe returned insufficient quota. No successful signed-in model investigation is claimed. |
| Tenant/user/role isolation | Server session/membership, V2 rollout, per-tool and per-navigation checks, scoped conversations, late-response rejection | Real hosted policy/deployment parity still requires signed-in verification. |
| Fleet totals, current/upcoming rentals and availability | Exact authorized counts; bounded booking lists and fleet pages; shared V2 availability predicates; incomplete counts are explicit | Broad fleet diagnosis remains paginated; no complete availability count is claimed from one page. Full write-time checkout validation is outside these read-only checks. |
| Maintained application guidance | Rental creation/return, vehicle Listing, customer creation, Bonzah, payment methods and other reviewed sections; navigation/catalog/manifest and stale-source checks | Coverage is 6 verified, 7 partial, 26 requiring confirmation, 1 unsupported. It is not a complete application manual. |
| Per-issue escalation | Deterministic backend policy, deduplicated checks, progress reductions, independent issue resolution and explicit human requests | No real-model accuracy score is claimed. |
| Useful bounded payment investigation | New rental-payment summary, exact mapped Stripe payment inspection, account-funds tools; missing mappings and discrepancies are explicit; failed checks bounded | Default disabled (`TRAX_FINANCE_READS`). Access follows Supabase staff roles/permissions; Stripe keys are read by name inside Supabase through `trax-stripe-read` (not yet deployed). Full rental money totals remain unsupported without currency provenance. |
| Ticket only after click | Explicit UI submission, server authorization, idempotent persistent RPC, redacted handoff, honest failure/retry | Candidate support migration is unapplied to production; support storage and agent assignments must be activated in an approved environment. |
| Actual support workflow | Requester history, authorized queue, ticket detail/status updates, no invented notification or response-time promise | Actual support staff must be assigned. No external helpdesk/email notification integration is claimed. |
| Persistent state and retention | Tenant/owner/scope storage, revisions/resume, 90-day chats, open tickets preserved, 365 days after latest closure, reopening, exceptions and configurable periods | Daily cleanup remains dry-run only. Destructive production cleanup requires the user's final approval. Hosted cron, backups and provider retention require environment verification. |
| Regression proof | 271 targeted tests, 24 isolated PostgreSQL tests, four offline browser modes | Fixture results are separate from actual signed-in OpenAI/Supabase/Stripe verification. Real accuracy, latency and cost-per-resolved-query remain unmeasured. |

## Rental payment investigation with Stripe verification (2026-09-15)

Implemented as described in [read-only-finance.md](read-only-finance.md): backend payment routing from recorded evidence only (`payment-routing.ts`), a third fixed read-only Stripe GET shape (Checkout Session and expanded PaymentIntent in the derived account), three model tools (`get_rental_payment_evidence`, `investigate_rental_payment`, `resolve_payment_dashboard_action`), server-built **Open in Stripe** / **View receipt** actions withheld from the model and re-validated in the portal hook, payment cards, payment Check again, follow-up payment context (identifiers only, re-verified every time) and structured payment references in the explicit support handoff. The existing charge flow, payment records and booking behavior are unchanged; no migration was added.

| Evidence | Result |
|---|---|
| Offline tests | 344 Trax tests pass (32 new payment-investigation tests: routing, historical accounts, platform era, shared test account, environment evidence, placeholder IDs, adapter ownership/livemode/link checks, holds, refunds, failed attempts, offline entries, totals per currency, pagination, provider failure vs not found vs no payments, record changes during reads, two tenants with the same rental number, handoff references, hook link validation). Strict backend and portal type checks pass. |
| Browser fixtures | Guidance, operational, support and finance modes pass; finance asserts the exact test-mode dashboard link, `target=_blank`, `rel=noopener noreferrer` and the receipt link. |
| Real model, fixture data | gpt-4.1 completed the full English/Roman Urdu conversation (show payments, cannot find in Stripe, which account, Stripe link, Check again) with correct tools; the first run exposed a follow-up defect (no payment IDs across turns), which was fixed and re-verified. No real tenant or Stripe data was used. |
| Authorized live Stripe reads | Not performed: `trax-stripe-read` is not deployed, and Northwind (the only V2 tenant) has no Stripe-linked payments. |
| Dashboard links opened with a tenant Stripe account | None. The link pattern is unverified against a real tenant dashboard. |

## Answer-quality pass (2026-09-15)

Local signed-in verification against the Northwind tenant (super-admin session, conversation storage off) with the real handler, database reads and OpenAI. No business data was changed.

- Model: `TRAX_MODEL=gpt-4.1` locally. Side-by-side on the same 25 questions: gpt-4o 23 model answers (10.7 s avg), gpt-4.1 22–23 (9.2 s), gpt-5-mini 16 (29.7 s, frequent incomplete responses).
- Grounding: keyword pre-retrieval of up to two reviewed sections (including the previous question for short follow-ups); cited-but-unretrieved sections are fetched during the one bounded correction turn; records validated earlier in the conversation stay addressable after a fresh tenant/permission check (their old results are never reused).
- Validation: invented or malformed navigation IDs are dropped or resolved through the permission-checked registry instead of discarding the answer. Unknown source IDs, URLs, routes and money figures still reject the answer (one correction, then fallback).
- Tools: identifier-token retry in `resolve_authorized_entity` ("Tesla NWD-3311"); booking lists carry the verified car label; a needs-input tool failure no longer blocks the identical retry after the record is resolved.
- Finance guidance: how-to questions no longer route to the finance refusal. Guidance for withheld finance areas is guidance-only (`canReadGuidance`: head admins, admins, managers with the grant; no navigation, records or tools).
- Knowledge: 27 new reviewed sections (fines, invoices, payments, expenses, agreements, rental insurance, insurances, customer documents, plates, credits, billing, staff add/roles/deactivate, branding, portal appearance, website business details, website vehicle visibility, vehicle pause, audit logs, pending bookings, blocked customers, dashboard). Coverage: 6 verified, 21 partial, 1 unsupported, 13 requiring confirmation.
- Evaluation: 48 realistic operator questions (English and Roman Urdu, follow-ups, live counts, bookings, availability, how-to, off-topic, human request): 47 useful answers and one intended finance refusal; average 6.3 s. Five transient network failures were re-run successfully.
- Portal findings outside TRAX (not changed here): `dashboard-kpis` has no tenant filter; the e-sign void/sign API routes use a service-role client without a caller check; Agreements, Insurances, Plates, the V2 Payments stage and fine detail page render edit actions without edit-permission checks; Expenses, Fleet Quotes, Welcome Pack, Vehicle Owners and Owner Payouts are lean-hidden for Northwind.

## Changes completed in the latest pass

- Added `finance-types.ts`, `finance-reads.ts`, `finance-tools.ts` and `stripe-readonly.ts` under `supabase/functions/trax-support/support`.
- Integrated the three finance tools into the existing model loop and both V2 server entry points, with no grants enabled by default. Extended the V2 hook's evidence validation and capability handling.
- Added deterministic amount formatting/comparisons, explicit refund/capture differences, shared-account protection, mapping revalidation, bounded retries and additional finance tests. No existing financial calculation or business record was modified.
- Reused an issue after exact rental resolution instead of creating a duplicate entry. Unknown vehicle IDs cannot become a selected diagnostic issue before resolution.
- Added the finance browser harness and updated application context, permission rules, feature coverage and knowledge candidate 0.3.1.

## Verification evidence

- `artifacts/trax-support/final-results.json`: combined targeted suite, 271 passing assertions (54 finance plus 217 existing TRAX assertions).
- `node tests/trax/support-storage.mjs`: 24 passing tests of actual candidate SQL in disposable PostgreSQL/WASM. No hosted database was touched.
- `node tests/trax/browser.mjs` with no flag, `--operational`, `--support`, and `--finance`: all passed with the actual V2 dialog/hook/handler and isolated fixtures. These do not simulate a successful live OpenAI call.
- Strict backend TypeScript passes. Focused portal and finance-test compilation has the same seven existing React/dependency/tenant typing diagnostics as the earlier baseline and no additional diagnostics. A clean whole-portal build is not claimed. See `artifacts/trax-support/finance-typecheck.json`.
- `artifacts/trax-support/provider-connectivity.json`: real configured-model request, no tenant/payment data, timed out after approximately 18 seconds, no HTTP response. This supersedes any assumption that the earlier quota response proves today's failure cause.

Reviewed fixture screenshots: [payment investigation](../../artifacts/trax-finance/payment-investigation.png), [account funds](../../artifacts/trax-finance/account-balance.png), [mobile](../../artifacts/trax-finance/mobile.png), [support queue](../../artifacts/trax-support/support-queue.png), [retention](../../artifacts/trax-support/retention.png).

## Safe next steps

1. For a local UI check without credentials, run `node tests/trax/browser.mjs --finance --manual` or `--support --manual`. The browser is clearly labelled as an isolated fixture and does not contact live accounts.
2. Restore/verify OpenAI connectivity for the approved server project, then test actual signed-in V2 questions. Do not treat prepared guidance as a successful AI check.
3. Review and activate the candidate support migration only in an explicitly approved environment, assign authorized support staff, then enable `TRAX_SUPPORT_STORAGE`. Verify a real submitted ticket and requester/queue permissions there.
4. Deploy `trax-stripe-read` (reads the existing Stripe secrets by name) and enable `TRAX_FINANCE_READS`, then perform approved finance checks before live use. Payment access follows Supabase staff roles/permissions; see [read-only-finance.md](read-only-finance.md).
5. Keep destructive production cleanup off until the user approves the final policy. Continue reviewing uncovered modules before claiming complete application knowledge.
