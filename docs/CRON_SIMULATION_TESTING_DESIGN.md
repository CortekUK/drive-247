# Cron Simulation & Testing Environment — Design Document (FINAL)

**Project:** Drive247
**Date:** 2026-07-08 · **Status:** Approved for implementation
**Origin:** Multi-agent research (5 research tracks → architecture → adversarial critique → final revision), all repo/live-DB claims verified. Production state verified against the live `cron.job` table (21 jobs) the same day.

> **Update (verified 2026-07-08, post-design):** the staging project `ksmreaadhbirzakkxqrq` was audited via the Management API — its `cron.job` table is **empty**. The §5.2 hazard ("staging may be firing prod-keyed jobs at production") is confirmed not occurring, and the design's "no cron on staging" target state already holds.

---

## 1. Requirements

| Requirement | Bar |
|---|---|
| **Isolation** | Zero writes to production DB; zero real-money Stripe ops; zero customer-visible sends under any failure mode — including "someone sets a channel key later" (hence: no prod data in staging, ever) |
| **Time control** | Simulate N days/weeks of cron behavior in minutes through the **real production code paths** |
| **Determinism** | Scenario assertions must not race ambient background jobs → staging runs zero cron |
| **Fidelity** | The pain domains (PAYG, installments, auto-extension, deposits, reminders) fully representable; exact schema, RLS, RPCs |
| **Cost** | ≤ ~$10/month recurring |
| **Anti-rot** | Staleness is detected at use (query at scenario start), not remembered by process discipline; artifacts fail loudly |
| **Prod debt** | The work fixes: committed prod key, misdirected `daily-reminders-job`, 2 schedule drifts, 3+3 missing sources, `exec_sql`, `simulate-payg-timelapse` |

**Core architectural fact (verified):** no fake clock is needed. Every cron target gates on real-now vs a stored timestamp column. **Time control = backdate the driving column(s) + HTTP-dispatch the real function.** Explicit non-goal: calendar-edge behavior (month-end `addPeriod`, DST in tenant-TZ weekday logic, year boundaries) is invisible to data-shifting — cover with pure unit tests on the date helpers, not the sandbox.

## 2. Chosen Architecture

**A dedicated hosted staging Supabase project (`ksmreaadhbirzakkxqrq`, existing) + a dedicated Stripe Sandbox, with no cron jobs, driven entirely by a scriptable dispatch/shift harness.**

- **Schema** from prod dump (repo migrations are a proven-inaccurate map). **Data: none cloned.** Scenarios build minimal fixtures through programmatic helpers (which doubles as a test of the creation paths).
- **Functions**: all deployed via a generalized deploy script honoring `config.toml`'s `verify_jwt` map. `emergency-bootstrap` excluded until its hardcoded prod URL is parameterized.
- **Stripe**: a dedicated Sandbox (own keys, own webhook endpoints registered at `https://ksmreaadhbirzakkxqrq.supabase.co/functions/v1/{stripe-webhook-test,stripe-connect-webhook,subscription-webhook}`, own `whsec_`s). Non-negotiable: reusing the prod account's test keys would fire every staging test event at production's webhook endpoints, which mutate the prod DB by metadata IDs. Live keys deliberately absent — `_shared/stripe-client.ts` throws on any live path.
- **No cron on staging.** When a scenario needs `recover-pending-stripe-payments` behavior, it fires that function explicitly.
- **Rejected alternatives**: Supabase branching — repo diverges from live and committed cron migrations would attack prod from any branch. Clock injection — 1–2-week cross-cutting rewrite with split-brain risk, solving a problem that doesn't exist. Local Docker stack — deferred (see Phase 3 backlog); no unique coverage for the Stripe-coupled pain list, and currently a live hazard until migrations are defused (13 committed migrations contain `cron.schedule` with hardcoded prod URLs + the prod key, so `supabase start` today fires authenticated POSTs at production).

## 3. Time-Control Layer

**Design principle: never fork the business logic.** `simulate-payg-timelapse` remains the anti-pattern (drifted `computeDailyRate` clone riding a generic `exec_sql` SECURITY DEFINER) and is retired from prod in Phase 0.

### 3.1 The harness — three plain-script pieces, no deployed surface

**`scripts/sim/helpers.mjs`** — shared module holding a direct Postgres connection (staging URL from `.env.staging`) and the staging functions base URL. Exports:
- `shift(table, id, cols, days)` — inline `UPDATE` backdating driving columns (`payg_next_accrual_at`, `due_date`, `auto_extend_next_charge_at` + `end_date`, `deposit_hold_expires_at`, `ledger_entries.due_date`, `leads.last_activity_at`, `approved_at`, …)
- `resetOneshots(rentalId | planId)` — NULLs `return_reminder_sent_at`, `lockbox_sent_at`, `last_reminder_sent_at`, **`auto_extend_last_reminder_at`**; deletes today's `reminder_events` rows and `lead_activity` stale-event rows
- `fire(name, payload?)` — dispatch via the map in `cron-dispatch.mjs`, returns the parsed function response for assertion
- `assertRows(sql, expect)` — SQL assertions on `payg_accruals` / `ledger_entries` / `payments` / `rentals` / `reminder_events`
- `sentinel()` — called at import: **throws if the target URL contains `hviqoaokxvlancmftwuo`**
- Fixture builders: `createTenant()`, `createCustomerWithPM(card)` (Stripe Sandbox customer + attached PM), `createRentalPAYG()`, `createInstallmentPlan()`, `createDepositHold()` (real Sandbox `requires_capture` PI; the new hold's `capture_before` read-back via `resolveHoldExpiry` is genuine Stripe data)

**`scripts/cron-dispatch.mjs`** — a ~40-line name→target map, initially: `accrue-payg-charges`, `process-installment-payment`, `mark_overdue_installments` (SQL: `SELECT public.mark_overdue_installments()` over the direct connection), `auto-extend-rentals`, `send-auto-extension-reminder`, `refresh-deposit-holds`, `send-return-reminders`, `recover-pending-stripe-payments`. Auth per target: service-role bearer; `X-Cron-Secret` for `lead-stale-poll`/`automation-poll-pending`; `x-platform-secret` for `onboarding-daily-digest`. `--twice` flag for idempotency assertions (guards exist: UNIQUE `(rental_id, accrual_day_index)`, pending-pay-link block, FIFO skip-if-allocated). Growing the map is trivial; the full 21-job manifest lives in `cron-manifest.json` for drift-checking, not dispatch.

**Scenario scripts** — plain `.mjs`, one per flow, importing helpers. No DSL, no runner. They rot loudly (throw) instead of silently.

### 3.2 Fast-forward strategy: catch-up first, day-loop fallback

- **Default**: exploit the functions' own catch-up semantics. "30 days of PAYG" = one 30-day backdate of `payg_next_accrual_at` + ~5 dispatches (the catch-up loop in `accrue-payg-charges/index.ts:167–201` posts up to 7 days/dispatch, deriving `entry_date` from the shifted pointer — coherent past timeline). Installment cycles: backdate each `due_date` directly.
- **Fallback (day-loop)**: only for genuinely order-coupled flows — auto-extend multi-week chains (each renewal computes the next pointer from the past `end_date`), SCA-failure retry counts (needs 3 sequential dispatches to hit the manual-flip), overdue cascades. Loop = `shift(-1 day)` → `resetOneshots()` → `fire(...)` → `assertRows(...)`.
- This is the difference between a 20-second scenario and a 5-minute one — the difference between a loop devs run and one they don't.

### 3.3 Per-domain specification

| Domain | Mechanism | Notes |
|---|---|---|
| **PAYG** | Backdate `payg_next_accrual_at` (catch-up), or `tenants.payg_accrual_window_seconds=300` for live-tick demos | Zero external side effects. `simulate-payg-timelapse` retired from prod; `simulate-payg-days` staging-only |
| **Installments** | Backdate `due_date`; NULL `last_reminder_sent_at` (24h cooldown, `process-installment-payment/index.ts:62–65`); optional `status='failed'`, `failure_count=3` for overdue path | Sandbox cards: `4242…` success, `4000000000000341` fail, `4000002500003155` SCA (3 dispatches → manual-flip). Settlement via the function only — never manual |
| **Auto-extension** | Backdate `auto_extend_next_charge_at` + `end_date`; day-loop for multi-week chains; failing card past grace → retry/pause | The one clock-coupled gate (weekday reminder, `send-auto-extension-reminder/index.ts:196–212`): set `auto_extend_reminder_send_weekday` = today's weekday in the fixture (config-shift). Reset `auto_extend_last_reminder_at` between simulated days |
| **Reminders** | Backdate `ledger_entries.due_date` / `end_date` / `payg_start_ts` / `last_activity_at`; `resetOneshots()` between days | Known prod blind spot: return-reminder cron can't reach deep-overdue rentals (`end_date >= today` filter, `send-return-reminders/index.ts:75`) — file as prod bug |
| **Lockbox** | Backdate `approved_at`; NULL `lockbox_sent_at` to replay | Fully neutral once Resend guards land |
| **Deposits** | Backdate `deposit_hold_expires_at` on a real Sandbox `requires_capture` PI | Failed refresh is terminal — seed fresh holds per test. Natural 7-day `charge.expired` untestable-fast → synthetic-payload unit test |
| **Platform subscriptions** | **Deferred** — not in the pain list. Stripe Test Clock recipe written when subscription code is next touched (clock → customer → trial sub → advance → staging `subscription-webhook`; limits: 3 customers/clock, forward-only, 30-day auto-delete) |
| **Not simulatable** | `cmd-poll-pending` (Modives), `sync-tesla-charges` (Tesla), accounting jobs 49/51/52 until sources assessed | Vendor secrets unset; per-row errors are caught |

## 4. Side-Effect Neutralization Matrix

Default posture: **absence of a secret = safe no-op** — made actually true in Phase 0, and made durable by having **no real PII in staging** (so even a later-set key can't reach a customer).

| Channel | Setting | Mechanism |
|---|---|---|
| **Stripe (rentals)** | Dedicated Sandbox keys as `STRIPE_TEST_*`; `STRIPE_LIVE_SECRET_KEY` + `STRIPE_UAE_LIVE_*` unset; all tenants `stripe_mode='test'`; Sandbox Connect account as `STRIPE_TEST_CONNECT_ACCOUNT_ID` | Live path throws (`_shared/stripe-client.ts:18,289`). Webhooks registered on the Sandbox → staging URLs; `stripe-webhook-test` iterates candidate secrets — env-only change. Money flows stay real end-to-end |
| **Resend** | `RESEND_API_KEY` unset | `_shared/resend-service.ts` + inline senders in `auto-extend-rentals`, `send-auto-extension-reminder` return `simulated` — **but `send-booking-email`, `send-cp-enquiry`, `hyper-api`, `send-user-welcome-email` have no guard** (POST with `Bearer undefined`, hard-fail mid-scenario; booking confirmation is on the fixture-creation critical path). **Phase 0 adds the four unset-guards** returning `{simulated:true}` |
| **AWS SES/SNS** | Creds unset | `{simulated:true}` fallbacks already shipping |
| **Twilio** | Unset. If sandbox creds are ever set for visual checks: staging contains no real phone numbers by construction (fixtures use test numbers) | Errors caught per-row |
| **BoldSign** | `BOLDSIGN_TEST_API_KEY` only; tenants `boldsign_mode='test'` | Built-in dual mode |
| **Bonzah / Tesla / Modives / Xero / Zoho** | Unset; `integration_tesla_fleet=false` | Failures caught; extension proceeds without insurance line |
| **OpenAI** | Unset or real (cheap) | Fire-and-forget |
| **Cron auth** | `AUTOMATION_CRON_SECRET`, `platform_verify_secret` set in staging | Required by dispatcher |
| **Assertions** | Dispatcher returns function responses (`{simulated:true}`, counts) + DB artifacts (`reminder_events`, ledger rows, status columns) | `SIMULATION_MODE` + `simulated_notifications` table deferred until response-capture proves insufficient |

## 5. Prerequisites — Phase 0 hygiene (production-facing, justified even if the sandbox never ships)

1. **Rotate the production service_role key** (Dashboard → JWT secret rotation). A valid production service_role JWT (exp 2077) is committed in plaintext in `supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql:14` and re-embedded by `20260415120000_fix_payg_audit_issues.sql`; the committed JWT and git history become inert post-rotation; accept history exposure rather than rewriting history. **Coupled step, same session:** rotation breaks the Authorization headers embedded in all HTTP cron job commands — re-schedule all of them via Supabase MCP with the new key sourced from Vault (`(select decrypted_secret from vault.decrypted_secrets where name='service_key')`) instead of a new plaintext literal. Fix the **misdirected `daily-reminders-job`** (currently fires at foreign project `wrogevjpvhvputrjhvvg`) and the 2 schedule drifts in the same pass. *(Prod-side changes via `mcp__supabase__*`, not repo migration files.)*
2. **Audit staging cron immediately**: `SELECT jobid, jobname, command FROM cron.job` on `ksmreaadhbirzakkxqrq`; `cron.unschedule` everything. ✅ **Done 2026-07-08 — table is empty, nothing to unschedule.**
3. **Codify live cron**: dump prod `cron.job` → commit `cron-manifest.json` (name, schedule, target, expected project ref, auth-header type). Ship `public.cron_jobs_readonly()` on prod (narrow SECURITY DEFINER returning `jobname, schedule, command`; EXECUTE revoked from anon/authenticated) via MCP — the read path the drift checker needs.
4. **Ship `scripts/check-cron-drift.mjs`**: reads `cron_jobs_readonly()`, diffs against the manifest, asserts every `net.http_post` URL contains the prod ref — the single assertion that would have caught the daily-reminders bug.
5. **Recover missing sources**: `supabase functions download refresh-accounting-tokens process-accounting-sync process-backfill-jobs --project-ref hviqoaokxvlancmftwuo` → review → commit. `pg_get_functiondef()` for `mark_overdue_installments`, `accounting_oauth_state_reap`, `sync_vehicle_maintenance_status` → commit.
6. **Security/footgun cleanup**: remove `exec_sql` from prod and retire `simulate-payg-timelapse`; rotate the staging service key committed in `scripts/db-switch.mjs:30` and move both env blocks to `.env` files; add the four Resend unset-guards; parameterize `emergency-bootstrap/index.ts:27` to `Deno.env.get('SUPABASE_URL')`; parameterize `scripts/wipe-all-data.mjs` (URL/key from env, refuse prod ref without `--force-prod`); generalize `scripts/deploy-functions.sh` → `scripts/deploy-all-functions.sh --project-ref <ref>` **without** `--no-verify-jwt` (config.toml's per-function map governs).

## 6. Roadmap

### Phase 0 — Safety & hygiene (~2 person-days) — *protects production immediately*
Everything in §5, in that order. Item 1 is first and blocking.
- Files: `cron-manifest.json`, `scripts/check-cron-drift.mjs`, `scripts/deploy-all-functions.sh`, edits to `scripts/db-switch.mjs`, `scripts/wipe-all-data.mjs`, `supabase/functions/emergency-bootstrap/index.ts`, the four `send-*`/`hyper-api` guard patches, committed recovered sources.

### Phase 1 — Staging + Stripe Sandbox + the hardest scenario, hardcoded (~3 person-days)
1. **Staging decision (timebox: 1 hour)**: after the §5.2 cron audit, default to recreate — `supabase db dump` schema from prod, `psql $STAGING_DB_URL` to drop/recreate, `scripts/deploy-all-functions.sh --project-ref ksmreaadhbirzakkxqrq`.
2. **Stripe Sandbox**: create in Dashboard; register the three webhook endpoints; collect keys + three `whsec_`s into `.env.staging`; `supabase secrets set --project-ref ksmreaadhbirzakkxqrq --env-file .env.staging` — test keys only, live keys absent, SES/SNS/Twilio/Resend/Bonzah/Tesla/Modives unset, `AUTOMATION_CRON_SECRET` set.
3. **Prove the riskiest loop first, with hardcoded scripts**: `scripts/sim/scenario-installment-3-cycle.mjs` — fixture (tenant + customer + Sandbox PM + plan) → backdate `due_date` → fire `process-installment-payment` → SCA card → 3 dispatches → assert manual-flip → webhook settlement via `installment_settle_invoice` (function-driven only). It exercises every risky assumption: Sandbox, webhooks, backdating, replay-blockers, settlement. **Exit criterion: full 3-cycle run with an SCA failure and manual-flip in under 5 minutes, zero real sends.**
4. Extract what step 3 taught into `scripts/sim/helpers.mjs` + `scripts/cron-dispatch.mjs`; add `scenario-payg-30-days.mjs` (catch-up shortcut, ~20s).

### Phase 2 — Coverage + anti-rot (~2 person-days)
- Remaining scenarios: `scenario-auto-extend-4-weeks-then-pause.mjs` (day-loop), `scenario-deposit-refresh.mjs`, `scenario-overdue-cascade.mjs`, `scenario-return-reminders.mjs`.
- **`npm run staging:sync`** → `scripts/staging-sync.mjs`: schema push + `deploy-all-functions.sh` + secrets sanity check (asserts live keys absent) + `check-cron-drift.mjs`, then stamps `sim_meta(last_synced, git_sha)` on staging. Every scenario reads the stamp at start and **warns/refuses if staging predates the working tree's last function/migration commit** — staleness is warn-at-use, not remember-to-sync.
- File the return-reminder deep-overdue blind spot and any other prod bugs the scenarios surface.

### Phase 3 — Deferred backlog (pull only when pain demands)
- **Local Docker stack**: gated on defusing the 13 cron migrations (environment-sentinel `RAISE EXCEPTION` guard or parameterized rewrite) — until then `supabase start` is a prod hazard, not a convenience. Revisit only if the ~10–30s `functions deploy` loop actually hurts.
- **Stripe Test Clock recipe** for platform subscriptions (`trialing → past_due → SubscriptionBlockScreen`) — write when subscription code is next touched.
- `SIMULATION_MODE` + `simulated_notifications` — only if response-capture assertions prove insufficient.
- Parameterized idempotent cron seed (Vault-sourced URL/key) as prod hardening; ~30-line GitHub Action (deploy-to-staging on push-to-main + drift check); assess recovered accounting functions.

**Total to a working end-to-end sandbox: ~5 person-days (Phase 0–1 ≈ 5 pd for one person including Stripe plumbing; Phase 2 +2), ~$10/month** (Micro compute; Sandbox free). Surviving artifacts are all either production fixes or single-file scripts that fail loudly when they rot.

### Key file references
`scripts/sim/{helpers,fixtures}.mjs` + `scripts/sim/scenario-*.mjs` (new) · `scripts/cron-dispatch.mjs`, `scripts/check-cron-drift.mjs`, `scripts/staging-sync.mjs`, `scripts/deploy-all-functions.sh`, `cron-manifest.json` (new) · `supabase/functions/accrue-payg-charges/index.ts` (catch-up loop) · `_shared/stripe-client.ts` (live-key safety lever) · `supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql` (committed prod key — rotation trigger) · `scripts/db-switch.mjs`, `scripts/wipe-all-data.mjs`, `supabase/functions/emergency-bootstrap/index.ts` (Phase 0 patches) · `supabase/functions/{send-booking-email,send-cp-enquiry,hyper-api,send-user-welcome-email}/index.ts` (Resend guard patches) · `supabase/functions/simulate-payg-timelapse/` (retire) · `supabase/functions/simulate-payg-days/` (pattern generalized into helpers).

---

## Appendix A — Rejected / amended criticisms (from the adversarial review)

- **"Ship a final defuse migration"**: rejected as-written — a committed migration that `cron.unschedule`s all jobs also replays on any `db push` to the linked prod project, killing production cron; superseded by cutting local from the MVP and requiring migration defusal (sentinel-guarded) before local is ever revisited.
- **"Local has zero unique test coverage"**: overstated — instant `db reset` for destructive schema experiments is genuinely unique to local; the conclusion (cut from MVP) accepted anyway since none of the pain domains need it.
- **"`SIMULATION_MODE` is the same fork-the-logic smell as `simulate-payg-timelapse`"**: rejected as an equivalence — a single env-guard branch in shared senders is not a drifting duplicated business-logic clone; the deferral is still accepted on YAGNI grounds, with the four missing unset-guards fixed instead.
