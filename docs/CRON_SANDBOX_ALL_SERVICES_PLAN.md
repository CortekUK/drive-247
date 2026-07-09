# Time Machine Multi-Service Sandbox — Implementation Plan

Integrates ALL cron-driven rental services into the dev Time Machine sandbox (currently PAYG only), each simulatable, with multi-job support. Isolated on staging (`ksmreaadhbirzakkxqrq`) — never touches production. Produced by 5 parallel research deep-dives + architect synthesis, verified against source.

## Hard dependency (blocker for money flows)
Staging currently has **no `STRIPE_TEST_SECRET_KEY`** (verified via the secrets API). Installments, auto-extension, and deposits create off-session Stripe PaymentIntents and **cannot run until a Stripe TEST key (`sk_test_…`) is set on staging**. The no-charge services (return-reminders, daily-reminders) don't need it. All side-effect keys (`STRIPE_LIVE_SECRET_KEY`, `RESEND_API_KEY`, `AWS_ACCESS_KEY_ID`, `TWILIO_AUTH_TOKEN`) are unset — the safe state GUARD 3 requires.

## 1. Service catalog

| service | cron fn | driving column(s) | needs Stripe? | scoping to add | side effects | stepping | risk |
|---|---|---|---|---|---|---|---|
| **payg** ✅ done | accrue-payg-charges | payg_next_accrual_at (+start/last/start_date) | no | already `only_rental_id` | none (ledger) | catch-up | none |
| **installment** | process-installment-payment + mark_overdue_installments (SQL) | scheduled_installments.due_date; clear plan.last_reminder_sent_at | **yes** | `.eq('rental_id',onlyRentalId)` on plans query | test PI, settles **inline** (no webhook) | catch-up | high (money) |
| **auto_extend** | auto-extend-rentals (+reminder) | auto_extend_next_charge_at + end_date (lockstep) | **yes** | `.eq('id',onlyRentalId)` + add body parse | test PI, settles inline | **day-loop** | high (money) |
| **deposit** | refresh-deposit-holds | deposit_hold_expires_at | **yes** | `.eq('id',onlyRentalId)` | test hold recreate | single (self-reverts) | med |
| **payg-reminder** | send-payg-reminders | payg_last_reminder_sent_at | yes (pay-link) | `.eq('id',onlyRentalId)` | test Checkout + Pending payment | single | low |
| **return-reminder** | send-return-reminders (+notify-rental-reminder) | end_date (new `return_reminder` domain) | no | `.eq('id',onlyRentalId)` | email → SES no-op | single | low (deep-overdue bug) |
| **daily-reminders** | daily-reminders | ledger_entries.due_date | no | `.eq('rental_id',onlyRentalId)` | in-app reminder_events only | single | low (date off-by-one) |
| recover-pending (defer) | recover-pending-stripe-payments | none | yes | `.eq('rental_id',onlyRentalId)` | commits test money | n/a | defer |

## 2. Architecture (generalized, data-driven)
- **`apps/portal/src/app/api/dev/sandbox/services.ts`** (server-only): a `SbService[]` manifest — `{key,label,order,scopeRentalId,shiftDomain,shiftId,cronFns,stepping,drainFires,preFire,status,reset}`. **`shiftId` ≠ `scopeRentalId` for installments** (shift targets a `scheduled_installments.id`; scope filters the plan by `rental_id`).
- **`route.ts`** refactored to a generic dispatcher: `status` (all services), `advance {service,days}` (honors per-service stepping: catch-up / day-loop / single), `advanceAll {days}` (outer day-loop, fires each service in cron-clock order), `reset`/`resetAll`, `setup`.
- **Fires route through `sim-control` `action:fire`** (not direct fetch) so GUARD 3 + `simDispatchable` re-check on every money dispatch.
- **advanceAll firing order:** accrue-payg → refresh-deposit → process-installment → mark-overdue → auto-extend → reminders.
- **Panel:** each service a collapsible `<ServiceRow>` (status chip + advance + results), plus a global "Advance ALL". Installment row has an outcome selector (success/decline/SCA) + cascade buttons. Client-safe display metadata in a separate `service-display.ts`.

## 3. Fixtures (SEPARATE rental per service — they're mutually exclusive)
A rental is PAYG **or** fixed-term; deposit conflicts with auto-extend (it *releases* the hold when auto_extend_enabled). So: `fx_payg` (existing b657f93b), `fx_installment`, `fx_auto_extend`, `fx_deposit` — all under the sandbox `test` tenant, each with an un-shifted **neighbor** to assert isolation. Money fixtures need a Stripe test customer + attached PM (`pm_card_visa` success, `pm_card_chargeDeclined`, `pm_card_authenticationRequiredOnSetup`), minted by a new `setup` action in sim-control. Keep `STRIPE_TEST_CONNECT_ACCOUNT_ID` unset → charges live on the platform test account (Connect-free).

## 4. Function changes + deploys
- Add backward-compatible `only_*_id` scoping to: process-installment-payment, auto-extend-rentals (+body parse), send-auto-extension-reminder, refresh-deposit-holds, send-payg-reminders, send-return-reminders, daily-reminders (defer recover-pending). Pattern: parse body → `if (onlyId) q = q.eq(<col>, onlyId)`.
- Deploy REAL bundles to staging (currently placeholder-only → 404): all the above + `notify-rental-reminder`. Bundle `_shared/*` inline like PAYG did.
- Add `setup` action to sim-control (mints Stripe test customer + PMs). Add `payg_last_reminder_sent_at`/`auto_extend_last_reminder_at` to shift driveCols; add `return_reminder` shift domain.
- **Do NOT fix the 3 prod bugs** — seed terminal states and surface them in the panel.

## 5. Phased order
- **Phase 0:** Stripe key on staging + installments end-to-end (hardest money flow first). Exit: real test PI charges, settles inline, neighbor untouched.
- **Phase 1:** generalize route + manifest (payg + installment through the generic path).
- **Phase 2:** auto-extension (day-loop). **Phase 3:** deposit refresh. **Phase 4:** reminders (neutralized). **Phase 5:** multi-service panel + advanceAll. **Phase 6 (opt):** recover-pending.

## 6. Key risks & prevention
Never fire a charge-fn globally (scope every fire + GUARD 3 re-check + simDispatchable). GUARD 3 fails closed on any live tenant / side-effect key. installment `failure_count` bug → seed terminal state, don't rely on organic cascade. Deposit self-revert is correct (reseed each run). All money paths settle **inline** — no staging Stripe webhook needed. Auto-extend must day-loop (sequential). send-return-reminders deep-overdue gap → shift end_date *into* window. daily-reminders off-by-one → seed due_date at exact bucket. Assert an un-shifted neighbor is untouched every phase.
