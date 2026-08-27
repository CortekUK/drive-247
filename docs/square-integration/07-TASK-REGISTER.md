# Square Integration — Executable Task Register

> **This document SUPERSEDES the task register in [`04-IMPLEMENTATION-PLAN.md`](04-IMPLEMENTATION-PLAN.md) §4 (`D0-*`, `A-*`, `B-*`, `P-*`) and §5 (milestones M0–M4).**
> Where the two disagree, this file wins. Doc 04's §1–§3 (architecture, the seam, the pilot path), §6 (external prerequisites) and §7 (out of scope) still stand.
> Every ID in doc 04's register is accounted for here — shipped, merged into a `SQ-*` task, or in the [dropped table](#9-dropped-tasks--and-why) with a reason. Nothing is silently lost.

**Branch:** `feature/square` · **Written:** 2026-08-25 · **Verified against:** working tree at `a6e09f7e` + live prod `hviqoaokxvlancmftwuo`

---

## TL;DR

> ### 36 tasks · 5 milestones (M0–M4) · 2 lanes · 11 launch blockers
>
> **The world moved after docs 01–04 were written.** Two commits landed (`bbfa372d`, `a6e09f7e`) and the DDL is **applied to production**. Roughly **40% of the source register is already shipped** — the full `_shared/payments/` seam (16 tracked files), four Square edge functions, all provider columns, both immutability triggers, 10 CHECK constraints, and the four `square_*` tables with RLS on. Those tasks are in [§9 Dropped](#9-dropped-tasks--and-why) marked **ALREADY SHIPPED**. Do not re-schedule them.
>
> **What that leaves is smaller and sharper — and contains four blockers no source doc names.** In one line each:
>
> 1. **A Square tenant cannot take a booking.** `create-checkout-session:207` hardcodes `requiresStoredCredential: true`, so the seam correctly *refuses* every Square checkout. The primary in-scope capability is a structured 4xx, not a payment. → **SQ-16**
> 2. **A Square tenant cannot be created.** `PaymentProviderPicker` (554 LOC) has zero importers; the immutability trigger is now live. Provider is unsettable through the product. → **SQ-11**
> 3. **A Square operator has no connect surface.** `square-settings.tsx` (921 LOC) is mounted nowhere; `square-disconnect` is invoked but does not exist. → **SQ-13**
> 4. **`refresh-square-tokens` has no cron row.** Verified against all 28 live jobs. On a 30-day token every Square tenant stops taking money on the same day, silently. → **SQ-14**
>
> ### 🔴 FOUR ANSWERS NEEDED FROM THE LEAD BEFORE WORK STARTS
>
> | # | Question | Blocks | Recommended call |
> |---|---|---|---|
> | **LD-1** | **Ratify: Square v1 is single-shot payments only — no card vaulting.** (doc 04 BL-1, still unanswered in writing) | **SQ-16** — the #1 blocker cannot be coded without this | **Ratify.** Square hosted links cannot vault; the only vaulting route silently fails for wallet payers. |
> | **LD-2** | **Does `CreateTenantDialog` stay Stripe-only, or gain a gated provider picker?** | **SQ-11** — provider capture | **Stripe-only.** It is the quick internal flow; a Square client is sales-led by definition. Removes an entire unvalidated browser-insert surface at zero cost. |
> | **LD-3** | **Retroactively ratify the `square-webhook` carve-out.** (doc 04 BL-4 demanded written sign-off *before* the carve-out; 951 LOC has already shipped) | Nothing — but an unratified carve-out is an audit hole | **Ratify.** Branching inside `stripe-webhook-live`/`-test`/`stripe-webhook` means editing 5,106 LOC of the most fragile code on the platform. |
> | **LD-4** | **Confirm both waiting customers in writing** — country in the 8, and *not* sold instalments / deposit holds / auto-charge. | Every M1+ task; a wrong pick is now a data-repair job, not a toggle | Blocking. See [LB-11](#2-launch-blockers). |
>
> **Prime directive is now mechanical, not prose:** M0 exists solely to make "a Stripe regression is unacceptable" a CI failure rather than a promise. Today `verify.sh` is a real gate that **nothing invokes** — there is no `.github` directory.
>
> **Baseline facts as of this writing (never hardcode these — assert them):** 52 tenants, all `payment_provider='stripe'` · 1,025 `payments` rows, all `stripe` · 0 provider mismatches · 28 live cron jobs, **0 Square** · 1 tenant with `deposit_charge_enabled` and **0** with both deposit flags.

---

## Table of contents

| § | Section |
|---|---|
| [1](#1-what-is-already-shipped) | What is already shipped — read before you plan anything |
| [2](#2-launch-blockers) | **Launch blockers** — blocker · owner · resolution |
| [3](#3-milestones) | Milestones M0–M4 — goal, hard definition of done, task ids |
| [4](#4-the-register) | **THE REGISTER** — one sortable table, 36 tasks |
| [5](#5-task-detail--m0-stripe-cannot-regress) | Task detail — M0 |
| [6](#6-task-detail--m1-m2) | Task detail — M1, M2 |
| [7](#7-task-detail--m3-m4) | Task detail — M3, M4 |
| [8](#8-the-two-lane-split) | The two-lane split — and why the lead's original instruction blocks an engineer |
| [9](#9-dropped-tasks--and-why) | Dropped tasks — and why |
| [10](#10-critical-path) | Critical path — dependency graph and schedule |

---

## 1. What is already shipped

Verified in the working tree and in production. **Re-scheduling any of this is re-doing landed work.**

| Layer | Shipped | Evidence |
|---|---|---|
| **Seam** | 13 modules under `supabase/functions/_shared/payments/` — `types.ts`, `capabilities.ts`, `registry.ts`, `resolve.ts`, `guard.ts`, `predicates.ts`, `checkout.ts`, `refund.ts`, `stripe-adapter.ts`, `square-adapter.ts`, `square-client.ts`, `square-status-map.ts`, `square-oauth.ts` | tracked at `a6e09f7e` |
| **Seam tests** | 5 Deno tests — `seam_test.ts`, `dispatch_test.ts`, `refund_shape_test.ts`, `adapter_correlation_test.ts`, `square_client_test.ts` | `_shared/payments/__tests__/` |
| **Edge functions** | `square-oauth-start`, `square-oauth-callback`, `square-webhook` (951 LOC), `refresh-square-tokens` + `config.toml` `verify_jwt` entries | `ls supabase/functions \| grep square` |
| **DDL — tenants** | `payment_provider`, `square_mode`, `country` + immutability trigger + 4 CHECKs | applied to prod |
| **DDL — payments** | `payment_provider`, `square_order_id`, `square_payment_id`, `square_refund_id` + exclusivity CHECK + immutability trigger | applied to prod |
| **DDL — credential store** | `square_connections`, `square_oauth_state`, `square_webhook_events`, `square_connections_public` — RLS on, **zero anon grants** | applied to prod |
| **Grants** | `anon` holds 239 column grants on `tenants` (236 + the 3 new) | applied to prod |
| **Guardrails** | `scripts/square-guardrails/verify.sh` — exit-status-driven, 6 real gates | tracked, **but nothing invokes it** |
| **Freeze** | `_shared/stripe-client.ts` pinned at `f1c38aed7017…`, unchanged | `sha256sum` matches |
| **UI (built, unmounted)** | `apps/admin/components/tenants/payment-provider-picker.tsx` (554 LOC), `apps/portal/src/components/settings/square-settings.tsx` (921 LOC), `apps/portal/src/hooks/use-square-connection.ts` | **zero importers / zero mount points** |

**Two corrections to the input analyses, found in the tree:**

- **`BASELINE.sha256` is half-widened and UNCOMMITTED.** The committed version at `HEAD` pins **one** path. The working tree pins **seven** — and absolutely sha-freezes `_shared/deposit-hold-refresh.ts` (2,758 LOC, 11 commits in 12 months) and `_shared/cors.ts` (43 LOC, no Stripe logic). An absolute freeze on an actively-maintained file gets bypassed, and a bypassed gate is worse than a narrower one. **SQ-02** commits the widening, relocates it out of `docs/square-integration/`, and downgrades those two to a token-ban.
- **`payments` is 1,025 rows right now**, not 1,026. The instruction that matters is *never hardcode the count* — assert the durable cross-table invariant instead (see SQ-01).

---

## 2. Launch blockers

**Work should not start until LB-1 … LB-4 are answered.** They are decisions, not tasks — an engineer cannot resolve them by writing code, and two of them (LB-1, LB-2) gate the two largest blockers in the register.

### 2.1 Needing a LEAD DECISION or an EXTERNAL answer

| # | Blocker | Owner | Resolution |
|---|---|---|---|
| **LB-1** | **Card vaulting go/no-go has never been answered in writing** (doc 04 BL-1). All 13 unconditional `setup_future_usage: 'off_session'` assignments in the repo vault a card. Square's hosted Payment Link cannot; its only vaulting route (`CreateCard` from a ≤24h-old payment) silently fails for wallet payers — exactly the buyers a hosted page attracts. There is no `square_customer_id` column anywhere, so the instalment and auto-extend crons are literally unbuildable. | **lead-decision** | **Ratify "Square v1 = single-shot payments only."** Hard-gate it in `_shared/payments/capabilities.ts` and enforce it *server-side* in each owning function; Web Payments SDK is an explicit Phase 2. Write it into the onboarding copy so a salesperson cannot promise instalments to a Square tenant. **Until this is ratified, SQ-16 cannot be coded** — the fix is to make `requiresStoredCredential` a computed value, which is only correct if the answer is "no vaulting". |
| **LB-2** | **A Square tenant cannot be created through any code path.** `payment-provider-picker.tsx` (554 LOC) is imported by nothing; `CreateTenantDialog.tsx:83` still raw-inserts six columns from the browser; `create-sales-onboarding` writes no provider and no country. Combined with the **now-live** immutability trigger, `payment_provider` defaults to `'stripe'` at birth and is unchangeable through the product. Two customers are waiting on a feature the plan makes impossible to provision. | **lead-decision** | **SQ-11.** The decision needed first is whether `CreateTenantDialog` stays Stripe-only (**recommended** — quick internal flow, a Square client is sales-led by definition, removes an entire unvalidated browser-insert surface at zero cost) or gains a gated picker. Then wire the picker into `SalesOnboardingDialog` and add `paymentProvider` + `country` to `create-sales-onboarding` with validation **before** the insert — without pre-validation a Square insert missing country surfaces a raw `23514` as "Failed to create tenant". Add `admin_set_tenant_payment_provider()` as the only sanctioned typo correction, or the first mistake gets fixed by someone disabling the trigger in prod. |
| **LB-3** | **The `square-webhook` carve-out shipped without the sign-off doc 04 BL-4 required.** 951 LOC of a deliberately separate function now exists on `feature/square`, against the lead's "no duplicate stripe-x/square-x edge functions" rule. | **lead-decision** | **Ratify retroactively.** The carve-out is correct: branching inside `stripe-webhook-live` / `-test` / `stripe-webhook` means editing 5,106 LOC of the most fragile code on the platform for a provider whose event model does not fit. Record the ratification in [`04-IMPLEMENTATION-PLAN.md`](04-IMPLEMENTATION-PLAN.md) Appendix A as part of **SQ-36**. If it is *not* ratified, the whole M2 shape changes and this register is void. |
| **LB-4** | **EXTERNAL / SALES.** Square operates in exactly **AU, CA, FR, IE, JP, ES, GB, US**. **UAE is not among them**, all 52 tenants are `currency_code='USD'`, and a UK→UAE Stripe migration is in flight. Provider choice is now trigger-enforced immutable, so a wrong pick is a data-repair job, not a toggle. Square v1 additionally has **no instalment plans, no charging a card on file, no deposit authorisation holds**. | **external** | Before either waiting deal is signed, confirm **in writing**: (a) the operator's country is one of the eight — **GB, never UK**; (b) they were **not** sold instalments, deposit holds or auto-charge auto-extension — if they were, **provision on Stripe**; (c) they accept auto-extension by emailed link and a deposit taken as a **CHARGE later refunded**, not a ring-fenced hold — which also changes their e-signed agreement text. Flag separately that Square does **not** support delayed capture or partial authorization in **Japan**, which *is* inside the eight. |

### 2.2 Engineer-owned blockers

| # | Blocker | Owner | Resolution |
|---|---|---|---|
| **LB-5** | **A Square tenant cannot take a booking.** `create-checkout-session:201` passes `requiresStoredCredential: true` to `tryProviderCheckout` because line 320 sets `setup_future_usage: 'off_session'` unconditionally — the in-file comment at :195-196 says exactly this. The seam correctly **refuses** every Square checkout. The primary in-scope capability is a structured 4xx, not a payment. No source decision names this; they all assumed the preamble would route to a Square link. | **engineer-B** | **SQ-16.** Compute `requiresStoredCredential` rather than hardcoding it — `false` when the resolved provider cannot vault **and** the tenant's flag set does not need a stored credential (a Square tenant runs deposit-as-charge with no instalments, PAYG, `auto_charge` or holds). Guard the Stripe side with a static check that counts the 13 unconditional `setup_future_usage` assignments and fails on any decrease: a Stripe tenant silently losing that token **does not fail** — it returns a valid session, takes the money, never vaults the card, and surfaces weeks later as estate-wide off-session charge failures with no trail back to the Square commit. |
| **LB-6** | **A Square operator has no connect surface, and disconnect 404s.** `square-settings.tsx` is 921 LOC and mounted **nowhere** — `settings/page.tsx:2919` still renders `<StripeConnectSettings />` unconditionally, whose only branch (`stripe-connect-settings.tsx:134`) chooses between two Stripe panels. Separately `use-square-connection.ts:397` invokes edge function `square-disconnect`, which is **not** among the four shipped Square functions. | **engineer-A** | **SQ-13.** Add a **third branch at the top** of `stripe-connect-settings.tsx` with an explicit `=== 'square'` early return — never a truthiness or negation test, so `null`/`undefined` takes the current path unchanged — and **do not refactor** the existing own/managed branch; it carries a documented production incident. Build `square-disconnect` to revoke at Square, delete both Vault secrets and set `status='revoked'`, but **never delete the row**: `square-webhook`'s `resolveTenant` must still map `merchant_id → tenant_id` for an event about money that already moved. |
| **LB-7** | **`refresh-square-tokens` has no cron row.** Verified against all 28 live jobs: no schedule for it, and none for a `square_oauth_state` reaper. Square access tokens expire in **30 days**, and expiry is a **pure clock event with no row change**, so nothing can ever push it — every Square tenant stops taking money on the same day, silently, with no vendor signal. | **engineer-A** | **SQ-14.** Schedule at `*/10` to match jobid 49. Prove it with **four** queries, not one: `cron.job` returns an active row (the manifest is drifted by 6 jobs and repo migrations do not describe scheduling — neither is evidence); `job_run_details` shows dispatches; a **closed** `cron_runs` row with `finished_at` set (`http_post` reports success on *enqueue* — all 28 jobs show `failed_24h=0` while `pg_net` logged 3.6% non-2xx in the same window); and one real `token_expires_at` moved forward. Filter every dead-man check by **exact** `job_name` on `finished_at` — 12 `cron_runs` rows are future-dated to 2026-11-16 by the staging Time Machine. |
| **LB-8** | **Square has no analogue of jobid 34.** A lost `payment.updated` leaves a Square row `Pending` forever; a lost `refund.updated` leaves `refund_status='processing'` forever — and there is **no `CancelRefund` endpoint** to unwind it. Square retries ~11 times over 24h then **discards the event permanently**, with no vendor signal. | **engineer-A** | **SQ-18.** Build `reconcile-square-payments` with a coverage window comfortably **exceeding 24h** — do not inherit the Stripe cron's blind spot — on its own cron entry so its failure cannot starve jobid 34, settling through the same `square-status-map` invariant: `Completed` only on Square `COMPLETED`, **never `APPROVED`**, because settlement runs through 8 DB triggers, none of which reads a provider column. Log `square-retry-number` / `square-retry-reason` on every webhook request as the direct per-event failure signal. |
| **LB-9** | **Two one-click destructive paths open on real Square money.** The platform's test for "is this a manual payment?" is `stripe_payment_intent_id IS NULL` — **true for every Square row by the now-live exclusivity CHECK** — and it gates Reverse (`payments/page.tsx:596` → `reverse-payment/index.ts:63`) and Undo (`use-rental-manual-paid-breakdown.ts:65` → `undo-manual-payment/index.ts:143`) at **both** the UI and the supposedly fail-closed server guard. Undo deletes the `payments` row outright — no refund at Square, no trace. | **engineer-B** | **SQ-03.** Replace with "has **no processor handle at all**": `stripe_payment_intent_id IS NULL AND square_payment_id IS NULL AND square_order_id IS NULL`. Provably zero-risk — both columns are NULL for all 1,025 existing rows, so no Stripe payment can change classification. Verify by running old and new predicates over live `payments` and diffing to empty. **Land the server guards first**; do not patch the dead `canReversePayment()` at `:298`. |
| **LB-10** | **A pre-existing anon query with no tenant filter becomes a Square-caused Stripe side effect.** `booking-success/page.tsx:67-75` finds the most recent `status='Pending'` payment carrying a `stripe_checkout_session_id` across **all** tenants (14 currently match) and feeds it to `process-pending-payment`. Square has one redirect and appends nothing, so Square customers routinely land without a recognised `session_id`, fall into this branch, and fire settlement against a **foreign Stripe tenant's session**. | **engineer-B** | **SQ-04.** Add the tenant fence **first** — correct on its own merits with zero Square tenants, and the half that removes the cross-tenant reach *today* — then the provider fence, then have the Square branch bake its own identifier into `redirect_url`. **Do not rely on the third alone**; the point is that the fallback is inert when it is missed. |
| **LB-11** | **Enforcement is prose.** There is still **no `.github` directory**. `scripts/square-guardrails/verify.sh` is a real exit-status-driven gate running six checks, but **nothing invokes it**, and every "hard fail" in docs 03 and 04 targets CI that does not exist. Separately the committed `BASELINE.sha256` pins **one** file while doc 04's M1 exit criterion claims four — the freeze gate runs green over a quarter of what it appears to certify. | **engineer-B** | **SQ-01 + SQ-02.** **Acceptance is the RED X, not the file**: open a throwaway PR adding a raw `=== 'square'` outside the seam and observe the failure. Add the **durable** cross-table invariant (`payments.payment_provider` = its tenant's, forever) rather than the self-expiring zero-square-rows count that goes red the day Square launches. Add the deploy preflight — `scripts/deploy-functions.sh` covers only 8 hardcoded names, so most deploys bypass it, and a function shipped ahead of its DDL `42703`s the whole tenant select and takes checkout down for all 52 tenants. |
| **LB-12** | **Deposit-as-charge has never run in production on any tenant** — `deposit_charge_enabled` is true on exactly **1 of 52**, whose `security_deposit_enabled` is **false**, so tenants with both flags on = **0** (re-verified live). SQ-12 makes it **mandatory** for every Square tenant. If it is first exercised by a Square pilot, any defect is a two-variable problem — deposit model or provider branch — that nobody can debug under deadline. | **engineer-B** | **SQ-33.** Enable both flags on a **Stripe** tenant and run the full cycle (quote → charge at checkout → the Security Deposit ledger charge from `generate_first_charge_for_rental` → `deduct-from-deposit` → refund of the remainder) **before** any Square tenant depends on it. Attribute any defect to the deposit model. 29 rentals currently carry a `deposit_hold_payment_intent_id`, so the authorization-hold path is live and must stay untouched. |
| **LB-13** | **Every Square booking is born `health_severity='critical'` and emails the platform.** `private.snapshot_rental_health()` is a BEFORE INSERT trigger on `rentals` whose `stripe_ok` gate a Square tenant can never satisfy, and `trg_notify_platform_rental` has no severity gate, no provider gate and no rate limit — both `private.platform_config` keys are populated, so the `pg_net` POST is live. | **engineer-B** | **SQ-09**, with the framing corrected: this is an **already-degraded** alarm (26 of 44 production tenants fail `stripe_ok`, 19 rentals are already critical, and 6 production tenants routing live money through OAuth are already false-flagged because the trigger never reads `own_stripe_account_id`) — so a reviewer told "Square breaks this" will patch only the provider branch. Fix the provider guard **and the email renderer** in the Square commit; fix the OAuth blind spot as a **separate commit in the same review session**, since it changes Stripe-tenant output. **Highest-risk diff in the project** — a raise aborts the INSERT and every booking on the platform stops. Require a second reviewer. |

---

## 3. Milestones

| M | Name | Tasks | Lane mix | Gate |
|---|---|---|---|---|
| **M0** | Stripe cannot regress — fences, guards and enforcement | SQ-01 … SQ-09 (9) | B + JOINT, **no lane A** | CI red X observed |
| **M1** | A Square tenant can exist and stay connected | SQ-10 … SQ-15 (6) | A + JOINT | Tenant created, connected, token refreshing |
| **M2** | A Square tenant can take and return money | SQ-16 … SQ-21 (6) | A + B | Sandbox booking paid, partial refund settled |
| **M3** | A Square tenant is not told they are on Stripe | SQ-22 … SQ-30 (9) | A + B + JOINT | No Stripe wordmark, readiness green |
| **M4** | Launch gates | SQ-31 … SQ-36 (6) | all | Full rehearsal + rollback rehearsal |

### M0 — Stripe cannot regress

**Goal.** Make the prime directive **mechanical** before any Square money moves. Every task is lane B or JOINT, depends only on the already-applied DDL and the already-committed seam, and is a **provable no-op** for all 52 Stripe tenants — 0 tenants and 0 `payments` rows carry `provider='square'` today. This milestone ships as Stripe-only commits reviewable on their own.

**Definition of done — all six, no partial credit:**

1. `bash scripts/square-guardrails/verify.sh` exits 0, is invoked by `.github/workflows/square-guardrails.yml` on `pull_request`, and **has been observed FAILING** a deliberately-bad throwaway PR (add a raw `=== 'square'` outside the seam). *Until that red X is seen, treat enforcement as prose.*
2. `sha256sum -c` over `ops/frozen-files.sha256` passes for `stripe-client.ts` (`f1c38aed701799691d1bc27cc408577d5e442e05a09ce938a4815b8e271701bc`), `subscription-stripe.ts`, and the three `stripe-webhook*/index.ts` files; `deposit-hold-refresh.ts` and `cors.ts` pass a **token-ban** (no `square` / `Square` / `payment_provider`).
3. `SELECT count(*) FROM payments p JOIN tenants t ON t.id=p.tenant_id WHERE p.payment_provider <> t.payment_provider` returns **0**, wired as a standing CI assertion — **not** the self-expiring "zero square rows" count.
4. For each of the **5 fenced sweeps**, a dry run against prod produces an **identical processed/skipped count** before and after the fence, recorded in the PR body.
5. `git diff --numstat origin/main -- <the 17 money functions>` reports **zero deleted lines**, and no money function gained a second `req.json()`.
6. A Square-shaped `payments` row (`payment_provider='square'`, all `stripe_*` NULL) inserted in a transaction and **rolled back** does **not** satisfy the reverse/undo manual-payment predicates at either the UI gate or the server gate.

### M1 — A Square tenant can exist and stay connected

**Goal.** Close the four verified blockers that make Square unreachable through the product: provider is unsettable, the connect surface is unmounted, disconnect 404s, and the 30-day token has no refresher. Lane A owns the Square files; the kill switch is JOINT because it must gate a **browser insert** that cannot read an edge-function secret.

**Definition of done:**

1. `private.platform_config` holds key `square_enabled`; with it not `'true'`, an INSERT of `payment_provider='square'` **raises** from a BEFORE INSERT trigger on `tenants` — proven by a rolled-back transaction — and the admin Square option is hidden. Flipping it is **one UPDATE with no deploy on either side**.
2. A super admin creates a Square tenant **end to end through the UI** with `country` captured; the row lands with `payment_provider='square'`, `square_mode='test'`, `deposit_charge_enabled=true`, `payg_auto_reminders_enabled=false`, `installments_enabled=false`.
3. Portal **Settings → Payments** renders `<SquareSettings />` for that tenant and `<StripeConnectSettings />` **byte-identically** for a Stripe tenant, chosen by an explicit `=== 'square'` early return at the top of `stripe-connect-settings.tsx`.
4. OAuth connect → `square_connections` row with `merchant_id`, `location_id`, `token_expires_at`; **disconnect succeeds** (no function-not-found); `SELECT jobid,schedule,active FROM cron.job WHERE jobname='refresh-square-tokens'` returns exactly **one active row**; a **closed** `cron_runs` row for it exists with `finished_at` set.
5. A merchant whose Square `Merchant.country` is outside **AU/CA/FR/IE/JP/ES/GB/US**, or **disagrees with `tenants.country`**, is REFUSED at the callback with the mismatch surfaced.

### M2 — A Square tenant can take and return money

**Goal.** Deliver the two primitives the lead named — hosted checkout / payment links and refunds including partial — plus the settlement safety net Square has no analogue of. **This is where the register's largest correction lands:** booking checkout currently *refuses* on Square because `setup_future_usage` is unconditional.

**Definition of done:**

1. A sandbox Square tenant **completes a booking**: `create-checkout-session` returns a Square payment link (**not a refusal**), the customer pays, `square-webhook` settles the `payments` row to `Completed` via `square-status-map`, and the rental is created. The **Stripe branch of that function is byte-identical below the marker comment**.
2. A **full** refund and a **partial** refund both succeed on that payment; `payments.refund_status` goes `'processing'` at request time and only reaches terminal on `refund.updated = COMPLETED`; **no ledger reversal row is written at request time**.
3. `SELECT * FROM cron.job WHERE jobname='reconcile-square-payments'` returns one active row; killing a webhook delivery in sandbox and letting the reconciler run settles the orphaned `Pending` row **inside its window — which must exceed Square's 24h discard clock**.
4. A Square payment produces a `financial_events` `payment_receipt` row for its tenant, visible in the admin Finance Sync tab — **and** a Square refund produces the matching event.
5. The accounting clearing-account lookup **FAILS CLOSED** (`NO_PROVIDER_PAYMENT_ACCOUNT`) rather than posting a Square receipt through a Stripe sentinel, and `save-accounting-mappings` no longer reports success on a write that did not happen.

### M3 — A Square tenant is not told they are on Stripe

**Goal.** Operator- and customer-facing correctness: readiness, go-live, admin surfaces, capability gating, copy, and the one **live Stripe-tenant contract defect** found on the same code path. None of this blocks money moving; all of it is visible to a paying pilot customer.

**Definition of done:**

1. A Square tenant can reach `overall_ready=true` in `v_tenant_readiness` and **"Live"** in the portal sidebar; `SELECT stripe_ready, count(*) FROM v_tenant_readiness` still returns **false 29 / true 18** for the existing book.
2. `square_mode` has a path to `'live'` through the admin tenant-detail toggle, and that transition **auto-resolves** a `square_connect` go-live request and stamps `setup_completed_at`.
3. A Square operator sees **no Stripe wordmark, no "Connect Stripe" nag, no "Secured by Stripe" badge, no Stripe-named refund copy**; the Payments tab hides the Stripe OAuth and payment-model-flip controls for them.
4. Rendering `DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE` through **each of the three render engines** leaves **zero** surviving `{{...}}` tokens — a test that **FAILS TODAY** on the booking engine (16 of 28 variables missing, including `{{tenant_name}}`).
5. `npx supabase gen types` **cannot truncate a tracked file**: the new script writes to a temp file and refuses unless exit 0, ≥20,000 lines, `export type Database` present, and ≥200 table keys; admin's strict build passes on the regenerated types.

### M4 — Launch gates

**Goal.** The evidence that the prime directive held, the alerting that tells someone when it stops holding, and **one rehearsal before a real customer's money is involved**.

**Definition of done:**

1. The pre-Square Stripe baseline is captured **as RATES into a table** (24h `payments` created = 10; `create-checkout-session` 9×200; `recover-pending-stripe-payments` 1,399×200 / 18×502) with the 502 ratio against its **five every-minute sibling crons** — captured while the tree is clean, because `query_logs` caps every query at **24 hours**.
2. Square alerting delivers to the **TENANT** (a `reminders` row + a portal banner off `square_connections_public.status`) **and** to the **PLATFORM** (an `audit_logs` action added to **all three** allowlist sites, including the single live `platform_activity_prefs.actions` array — an unlisted action fails silently **inside the DB trigger**, with no edge invocation and no log line at all). `health_alert_outbox` is **NOT** used.
3. A **full sandbox rehearsal** on one Square tenant: create → connect → book → pay → partial refund → token refresh → disconnect, with the Stripe standing monitors green throughout — **plus the rollback rehearsed** (flip `square_enabled` off mid-flight; creation refuses, webhook and reconciler still 2xx and settle in-flight money).
4. Deposit-as-charge proven **end to end on a STRIPE tenant first** (0 of 52 run both flags today, and Square makes that model mandatory) so any defect is attributable to the deposit model, not the provider branch.
5. All five planning docs reconciled to what actually shipped; **every superseded instruction struck by name**.

---

## 4. THE REGISTER

**Effort:** `S` ≤ 0.5d · `M` 1–2d · `L` 3–5d
**Stripe risk:** `none` (new files only) · `low` (additive / caller-side) · `med` (edits a live Stripe money function) · `high` (edits a sweep, a refunder, a DB trigger, or the checkout vault token)
**Lane:** `A` credential spine + Square-native + Square-only UI · `B` Stripe safety rails + existing money functions · `JOINT` one authors, one reviews

Sort by **Pri** to plan the week. Sort by **Risk** to plan the review. Sort by **Lane** to plan the split. Full detail for every row is in [§5](#5-task-detail--m0-stripe-cannot-regress)–[§7](#7-task-detail--m3-m4).

| ID | Title | M | Lane | Pri | Eff | Stripe risk | Depends on | Primary files |
|---|---|---|---|---|---|---|---|---|
| SQ-01 | Stand up CI; wire the existing guardrails + a deploy preflight into it | M0 | JOINT | **P0** | M | none | — | `.github/workflows/square-guardrails.yml`, `scripts/square-guardrails/verify.sh`, `scripts/preflight-deploy.sh` |
| SQ-02 | Widen the frozen-file baseline from 1 to 5, token-ban the 2 maintained ones | M0 | JOINT | **P0** | S | none | SQ-01 | `ops/frozen-files.sha256`, `scripts/square-guardrails/check-frozen.mjs` |
| SQ-03 | 🔴 Make the "is this a manual payment?" test provider-neutral | M0 | B | **P0** | M | low | — | `supabase/functions/reverse-payment/index.ts`, `supabase/functions/undo-manual-payment/index.ts` |
| SQ-04 | 🔴 Fence the unfenced anon `payments` fallback on booking-success (14 tenants) | M0 | JOINT | **P0** | S | low | — | `apps/booking/src/app/booking-success/page.tsx` |
| SQ-05 | Fence the 5 multi-tenant money sweeps — shape per function, **not** a bare `.eq()` | M0 | B | **P0** | M | **high** | — | `auto-extend-rentals`, `send-payg-reminders`, `send-auto-extension-reminder`, +2 |
| SQ-06 | Two-line capability refusals in the money functions Square v1 can never serve | M0 | B | **P0** | M | med | — | `create-installment-checkout`, `create-preauth-checkout`, `refund-installment-payments`, +7 |
| SQ-07 | 🔴 Refund dispatch in the 4 reachable refunders; close the else-branch ledger writes | M0 | B | **P0** | L | **high** | — | `process-refund`, `cancel-rental-refund`, `deduct-from-deposit`, `reject-rental` |
| SQ-08 | Mirror `predicates.ts` into portal; replace ad-hoc "real electronic money" proxies | M0 | B | P1 | M | med | SQ-03 | `apps/portal/src/lib/payment-predicates.ts`, `void-payment-link` |
| SQ-09 | Make the rental-health trigger provider-aware; fix the OAuth blind spot as a sibling | M0 | B | P1 | M | **high** | — | `platform-rental-notify/index.ts`, `apps/admin/…/platform-rentals/page.tsx` |
| SQ-10 | Kill switch in `private.platform_config` — gates CREATION, never SETTLEMENT | M1 | JOINT | **P0** | M | low | — | `_shared/payments/resolve.ts`, `_shared/payments/guard.ts`, `CreateTenantDialog.tsx` |
| SQ-11 | 🔴 Wire provider + country capture at tenant creation | M1 | A | **P0** | M | low | SQ-10 | `create-sales-onboarding/index.ts`, `SalesOnboardingDialog.tsx`, `payment-provider-picker.tsx` |
| SQ-12 | Write the two Square provisioning invariants that will not arrive by default | M1 | A | **P0** | S | none | SQ-11 | `create-sales-onboarding/index.ts`, `place-deposit-hold/index.ts` |
| SQ-13 | 🔴 Build `square-disconnect`; mount `square-settings.tsx` | M1 | A | **P0** | M | none | — | `square-disconnect/index.ts`, `stripe-connect-settings.tsx`, `settings/page.tsx` |
| SQ-14 | 🔴 Schedule `refresh-square-tokens` + a state reaper, with `cron_runs` heartbeats | M1 | A | **P0** | M | none | — | `refresh-square-tokens/index.ts`, `sim-control/cron-manifest.json` |
| SQ-15 | Reconcile `tenants.country` against Square `Merchant.country` at the callback | M1 | A | P1 | S | none | SQ-13 | `square-oauth-callback/index.ts`, `_shared/payments/capabilities.ts` |
| SQ-16 | 🔴 **A Square tenant cannot take a booking** — make the vault token conditional | M2 | B | **P0** | L | **high** | SQ-01, SQ-12 | `create-checkout-session/index.ts`, `_shared/payments/checkout.ts` |
| SQ-17 | Extend the seam preamble to the other 3 reachable creators | M2 | B | **P0** | M | med | SQ-16 | `create-extension-checkout`, `send-invoice-email`, `send-excess-mileage-payment-link` |
| SQ-18 | 🔴 Build `reconcile-square-payments` — Square has no analogue of jobid 34 | M2 | A | **P0** | L | none | SQ-14 | `reconcile-square-payments/index.ts`, `square-webhook/index.ts` |
| SQ-19 | Enqueue `financial_events` on the Square settlement path | M2 | A | P1 | M | none | SQ-16 | `square-webhook/index.ts`, `finance-events-tab.tsx` |
| SQ-20 | Accounting: fail closed on an unqualified clearing account; repair the no-op save | M2 | B | P1 | L | low | SQ-19 | `process-accounting-sync`, `save-accounting-mappings`, `xero-oauth-callback` |
| SQ-21 | Make Square payment links visible to the 3 operator surfaces | M2 | A | P1 | M | med | SQ-16 | `apps/portal/src/hooks/use-payment-links.ts`, `payments/page.tsx` |
| SQ-22 | Consolidate the 4 Stripe-only readiness derivations, then make that one provider-aware | M3 | A | P1 | L | med | SQ-13 | `apps/portal/src/lib/payment-readiness.ts`, `use-setup-status.ts`, `use-setup-reminder.ts` |
| SQ-23 | Give `square_mode` a path to `'live'`; close the go-live round-trip | M3 | A | P1 | M | med | SQ-22 | `apps/admin/…/rentals/[id]/page.tsx`, `command-center.tsx` |
| SQ-24 | Gate the UK→UAE migration controls off for Square tenants | M3 | A | P1 | S | med | SQ-11 | `tenant-payments-tab.tsx`, `operator-prompt-card.tsx` |
| SQ-25 | Admin readiness board + tenant list: stop showing Square as a broken Stripe tenant | M3 | A | P2 | M | low | SQ-22 | `apps/admin/…/readiness/page.tsx`, `apps/admin/lib/payment-readiness-labels.ts` |
| SQ-26 | Portal capability gating — disable-with-reason, plus the per-rental override a CHECK cannot see | M3 | A | P1 | M | low | SQ-12 | `apps/portal/src/lib/square-v1-surface.ts`, `InstallmentSettings.tsx`, `rentals/new/page.tsx` |
| SQ-27 | Neutralise Stripe copy — **drop the brand**, do not plumb the provider | M3 | B | P2 | M | low | SQ-13 | `BookingCheckoutStep.tsx`, `apply/step-4-financial.tsx`, `app-sidebar.tsx`, +7 |
| SQ-28 | 🔴 **LIVE STRIPE DEFECT** — backfill 16 missing agreement variables, guard all 4 engines | M3 | B | **P0** | L | med | — | `apps/booking/src/app/api/esign/route.ts`, `template-variables.ts`, `default-agreement-template.ts` |
| SQ-29 | Replace the destructive types-regen command; land the drift as a types-only commit | M3 | JOINT | P1 | M | low | — | `scripts/gen-types.mjs`, `CLAUDE.md`, 3× `integrations/supabase/types.ts` |
| SQ-30 | Provider-neutralise the platform-global welcome pack + staff RAG knowledge base | M3 | JOINT | P2 | M | none | SQ-22 | `setup-hub.tsx`, `rag-sync/index.ts`, `chat/index.ts` |
| SQ-31 | Freeze the pre-Square Stripe baseline **as rates**, into a table, while the tree is clean | M4 | B | **P0** | S | none | — | `03-STRIPE-SAFETY-AND-EDGE-CASES.md`, `RUNBOOK-console-and-deploy.md` |
| SQ-32 | Square alerting to the two sinks that exist — **not** `health_alert_outbox` | M4 | A | P1 | M | none | SQ-14 | `refresh-square-tokens/index.ts`, `use-app-banners.ts`, `notify-platform-activity` |
| SQ-33 | Prove deposit-as-charge on a **STRIPE** tenant before any Square tenant depends on it | M4 | B | **P0** | M | **high** | SQ-07 | `deduct-from-deposit/index.ts`, `_shared/deposit-amount.ts` |
| SQ-34 | Full sandbox rehearsal + rollback rehearsal, Stripe monitors watched throughout | M4 | JOINT | **P0** | L | med | SQ-18, SQ-19, SQ-21, SQ-32 | `RUNBOOK-console-and-deploy.md` |
| SQ-35 | Complete the rollback inventory; add the per-tenant suspend lever the flowchart promises | M4 | JOINT | P1 | S | none | SQ-10 | `03-STRIPE-SAFETY-AND-EDGE-CASES.md`, both migration files |
| SQ-36 | Reconcile the five planning docs; strike every superseded instruction **by name** | M4 | JOINT | P2 | M | none | — | `02-…md`, `03-…md`, `04-…md`, `CLAUDE.md`, `docs/DATABASE_SCHEMA.md` |

**Distribution.** Priority: **19 P0**, 13 P1, 4 P2. Lane: **A 14**, **B 13**, **JOINT 9**. Effort: 7 S, 22 M, 7 L. Stripe risk: 13 none, 9 low, 9 med, **5 high** (SQ-05, SQ-07, SQ-09, SQ-16, SQ-33 — all five require a second reviewer).

---

## 5. Task detail — M0 (Stripe cannot regress)

### SQ-01 — Stand up CI and wire the existing guardrails + a deploy preflight into it
**JOINT · P0 · M · Stripe risk: none · depends: —**

There is still **no `.github` directory** (verified). `scripts/square-guardrails/verify.sh` already exists, is exit-status-driven, and runs 6 real gates (freeze, banned predicates, `deno check` on the seam, `deno check` on `square-*`, seam tests, importer listing) — but **nothing invokes it**.

Create `.github/workflows/square-guardrails.yml` running `verify.sh` on `pull_request` and `push` to `feature/square`, plus `npm run guard:payments` in root `package.json`. Add three checks `verify.sh` lacks:

- **(a)** the **durable** cross-table invariant `payments.payment_provider = its tenant's` — never the self-expiring zero-square-rows count, and **never hardcode 1,025**;
- **(b)** zero-deleted-lines over the 17 money functions vs a `square-baseline` tag, treating a `numstat` `-` as failure, plus a **no-new-`req.json()`** assertion;
- **(c)** an else-branch scan over the reachable money functions for any branch keyed on `stripe_payment_intent_id` / `stripe_checkout_session_id` / `stripe_refund_id` whose **else-arm performs a write**.

**Acceptance is the RED X:** open a throwaway PR adding a raw `=== 'square'` outside the seam and observe the failure.

Separately create `scripts/preflight-deploy.sh` wrapping every `npx supabase functions deploy` — `scripts/deploy-functions.sh` covers only **8 hardcoded names**, so most deploys bypass it. It must refuse a dirty tree, refuse when `HEAD` is not an ancestor of `origin/main`, and probe `information_schema` for every column the function's selects name: **a function shipped ahead of its DDL `42703`s the whole tenant select and takes checkout down for all 52 tenants.**

**Files:** `.github/workflows/square-guardrails.yml` · `scripts/square-guardrails/verify.sh` · `scripts/preflight-deploy.sh` · `scripts/deploy-functions.sh` · `package.json`
**Merged from:** SQ-GUARD-00/03/04/06/12, S-3, F-4, F-9, F-10, DDL-7, SQ-V1-05, T10, OBS-3

---

### SQ-02 — Widen the frozen-file baseline from 1 file to 5, with token-bans for the two actively-maintained ones
**JOINT · P0 · S · Stripe risk: none · depends: SQ-01**

`docs/square-integration/BASELINE.sha256` **as committed at `HEAD` pins exactly one path** (`stripe-client.ts`, verified still `f1c38aed…`) while doc 04's M1 exit criterion says "all four frozen files". The gate runs green over a quarter of what it appears to certify.

> **Correction found in the tree:** the **working copy** of `BASELINE.sha256` is already widened to **seven** paths but is **uncommitted** — and it absolutely sha-freezes `_shared/deposit-hold-refresh.ts` and `_shared/cors.ts`. Finish and correct that change; do not start from the committed version.

Move the manifest to **`ops/frozen-files.sha256`** — the `docs/square-integration/` path self-trips a scope check that fails on any path containing `square`, and the freeze must outlive the project folder.

**Absolute sha256 for five:** `_shared/stripe-client.ts`, `_shared/subscription-stripe.ts`, `stripe-webhook-test/index.ts`, `stripe-webhook-live/index.ts`, `stripe-connect-webhook/index.ts` (4,281 LOC of live money settlement previously guarded by nothing machine-readable).

**Do NOT absolute-freeze** `_shared/deposit-hold-refresh.ts` (2,758 LOC, **11 commits in 12 months**) or `_shared/cors.ts` (43 LOC, no Stripe logic) — an absolute freeze on an actively-maintained file gets bypassed, and **a bypassed gate is worse than a narrower one**. Give those two a **token-ban** on `square` / `Square` / `payment_provider`.

Also fail on edits to the `TENANT_STRIPE_COLUMNS` definition or to `export type PlatformAccount = 'uk' | 'uae'`. **Assert the manifest entry count** so a silently truncated baseline fails instead of passing. Resolve the repo root from `${BASH_SOURCE[0]}`, **never `git rev-parse`** — a tarball deploy has no `.git` and `cd ""` succeeds silently.

**Files:** `ops/frozen-files.sha256` · `scripts/square-guardrails/check-frozen.mjs` · `docs/square-integration/BASELINE.sha256`
**Merged from:** F-1, F-3, F-5, SQ-GUARD-03, T7, S-3(G1)

---

### SQ-03 — 🔴 Make the "is this a manual payment?" test provider-neutral before any Square payment exists
**B · P0 · M · Stripe risk: low · depends: —**

Four call sites share one broken proxy: a payment is treated as manual/offline **iff `stripe_payment_intent_id IS NULL`**. Every Square payment satisfies that **by DB construction** — `payments_provider_handle_exclusivity_check` (now live) forbids a Square row from carrying any `stripe_*` handle.

Verified still unfixed:

| Site | Code |
|---|---|
| `supabase/functions/reverse-payment/index.ts:63` | `if (payment.stripe_payment_intent_id)` — the **only** server refusal |
| `supabase/functions/undo-manual-payment/index.ts:143` | `if (p.stripe_payment_intent_id) return false` |
| `apps/portal/src/app/(dashboard)/payments/page.tsx:596` | inlined — **not** the dead `canReversePayment()` at `:298`; patching that changes nothing |
| `apps/portal/src/hooks/use-rental-manual-paid-breakdown.ts:65` | UI gate |

**Effect on a real Square card payment:** Reverse deletes `payment_applications` and restores the ledger charge. Undo additionally deletes `pnl_entries` by `source_ref` **and deletes the `payments` row** — no refund at Square, no trace.

**Fix:** replace "has no Stripe intent" with "**has no processor handle at all**" — `stripe_payment_intent_id IS NULL AND square_payment_id IS NULL AND square_order_id IS NULL`. Provably zero-risk: both columns are NULL for all 1,025 existing rows, so **no Stripe row can change classification**. Verify by running the old and new predicates over live `payments` and asserting **identical row sets**. **Land the SERVER guards first** — they are the last line of defence.

**Files:** `supabase/functions/reverse-payment/index.ts` · `supabase/functions/undo-manual-payment/index.ts` · `apps/portal/src/app/(dashboard)/payments/page.tsx` · `apps/portal/src/hooks/use-rental-manual-paid-breakdown.ts` · `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx`
**Merged from:** SQ-RPT-0, S-12

---

### SQ-04 — 🔴 Fence the unfenced anon `payments` fallback on booking-success (reaches 14 tenants today)
**JOINT · P0 · S · Stripe risk: low · depends: —**

Verified still live at `apps/booking/src/app/booking-success/page.tsx:67-75`: when `session_id` is absent from the URL, the page runs an **anon** query for the most recent `status='Pending'` payment with a non-null `stripe_checkout_session_id` and **no tenant filter**, then feeds it to `process-pending-payment`. **14 distinct tenants currently match that predicate.**

Square has **one** redirect and appends nothing, so a Square customer routinely lands with no recognised `session_id`, falls into this branch, and fires settlement against a **foreign Stripe tenant's session**. That is a Stripe-side side effect caused by Square traffic — **the prime directive violated by a query nobody audits.**

**Fix in order:**
1. add `.eq('tenant_id', tenant.id)` — correct on its own merits even with zero Square tenants, and **this is the half that removes the cross-tenant reach today**;
2. add `.eq('payment_provider','stripe')` so the fallback is structurally unreachable from a Square return;
3. have the Square branch bake its own identifier into `redirect_url` at creation and read that param explicitly.

**Do not rely on (3) alone** — the point is that the fallback is inert when (3) is missed.

While in the file, **delete `apps/booking/src/components/BookingSuccess.tsx`**: it is orphaned (never imported) and contains a second browser-side anon INSERT into `payments` that **omits `tenant_id` entirely**.

**Files:** `apps/booking/src/app/booking-success/page.tsx` · `apps/booking/src/components/BookingSuccess.tsx`
**Merged from:** SQ-SUCCESS-1, SQ-DEAD-1, SQ-SEC-1-CORRECTION

---

### SQ-05 — Fence the multi-tenant money sweeps — with the shape appropriate to each, NOT a bare `.eq()`
**B · P0 · M · Stripe risk: HIGH · depends: — · second reviewer required**

Verified: **zero** of these five functions references `payment_provider` today.

> **The correction that matters:** a bare `.eq('payment_provider','stripe')` is **UNSAFE on 2 of 3**, and on one of them it manufactures the exact catastrophe doc 02 §O-1 warns about. **The fence is a code-level skip with `return null`, never a bare `.eq()`.**

| Fn | Cron | Shape | Why |
|---|---|---|---|
| `auto-extend-rentals` | jobid 54 | `.eq()` on the `.in('id', tenantIds)` select at `:295` is **SAFE** | tenant drops from `tenantMap` at `:296` and hits `if (!tenant) { skipped++; continue; }` at `:301` — verified |
| `send-payg-reminders` | jobid 33 | **DO NOT use `.eq()`.** Use `if (!isStripeTenant(tenant)) return null;` and make the helper return `null` on a missing tenant too | `getStripeContext` does `.eq('id',tenantId).single()` and **discards the error** (`const { data: tenant } = …`), so zero rows yields `tenant=null` silently — and the helper still **returns a context with `connectAccountId === null`**, which does not skip the Stripe call, it **redirects the charge to the Drive247 PLATFORM balance** |
| `send-auto-extension-reminder` | jobid 55 | Append the column **inside the embed** and skip in code | its tenant arrives via an embedded `tenants ( … )` join in `RENTAL_SELECT:235`; a PostgREST filter cannot drop the parent row without `!inner`, and `!inner` **changes join semantics for all 52 tenants on a live daily cron** |
| `process-installment-payment` | jobid 6 | select-list addition + explicit JS skip with a counter | — |
| `accrue-payg-charges` | jobid 32 | select-list addition + explicit JS skip with a counter | — |

**DELETE jobid 4 from the list** — `mark_overdue_installments()` is a pure SQL function with two UPDATEs and **zero processor calls**; fencing it would leave Square arrears permanently un-flagged.
**DO NOT TOUCH** jobid 34 (already filters `.not('stripe_checkout_session_id','is',null)`) or jobid 61 (already filters `stripe_onboarding_complete=true`).

**Prove each fence is a no-op** by asserting identical processed/skipped counts against prod.

**Files:** `supabase/functions/auto-extend-rentals/index.ts` · `send-payg-reminders/index.ts` · `send-auto-extension-reminder/index.ts` · `process-installment-payment/index.ts` · `accrue-payg-charges/index.ts`
**Merged from:** SQ-GUARD-08, DDL-3, DDL-4, S-8, SQ-V1-07, SQ-V1-06

---

### SQ-06 — Two-line capability refusals in the money functions Square v1 can never serve
**B · P0 · M · Stripe risk: med · depends: —**

With `canVaultCard=false`, `supportsInstallments` / `PayAsYouGo` / `AutoExtend` = `false`, these carry **no seam call and no Square code** — just resolve, and if not `stripe` return a structured 4xx **naming the capability**. A loud refusal is smaller and safer than a preamble, and infinitely safer than a silent no-op.

- **Creators:** `create-installment-checkout`, `create-upfront-checkout`, `installment-pay-link`, `send-payg-manual-reminder`
- **Holds/preauth** — out of scope but **not unreachable; they are the DEFAULT path**: `create-preauth-checkout:86`, `create-hold-checkout:262`, `place-deposit-hold:400`, `update-payment-method` (4 sites)
- **Refunders where the shape forbids a top-of-function return:** `refund-installment-payments` (`refunds.create` at `:165` **inside a loop opened at `:124`**, plus a second at `:245`); `process-scheduled-refund` (dual-mode, single `:109` and batch loop `:226`/`:268` — **verified already fail-closed**, throws before any tenant select, so **assert it with a test rather than diffing it**)

> **EXPLICITLY OUT: `create-credit-checkout` and `manage-credit-wallet`.** They import `_shared/subscription-stripe.ts`, sell Drive247 platform credits at $0.20/credit on the UAE account, and never call `getConnectAccountId`. Guarding them would **route Drive247's own revenue into a Square tenant's merchant account.** Doc 02's §O-3 table lists `create-credit-checkout` as in-scope — **strike it by name** (SQ-36).

**Files:** the 10 functions above
**Merged from:** S-21, SQ-GUARD-10, SQ-V1-06

---

### SQ-07 — 🔴 Refund dispatch in the 4 reachable refunders, and close the else-branch ledger writes
**B · P0 · L · Stripe risk: HIGH · depends: — · second reviewer required**

Verified: **zero** of the six refund functions references `payment_provider` or `square_`.

> **The defect the `getConnectAccountId` lens could not see:** `deduct-from-deposit` and `reject-rental` have record-anchored `getConnectAccountId` sites that correctly stay frozen — yet **the functions are reachable through branches that fire BECAUSE the Stripe ids are NULL**, the state the now-live exclusivity CHECK makes **mandatory** for Square rows.
>
> Confirmed in source: `deduct-from-deposit:661` selects with `.not('stripe_payment_intent_id','is',null).single()`; `:722` logs *"No Stripe payment found, recording as manual deduction"*; `:728` **unconditionally inserts a negative `ledger_entries` Refund row** — and **deposits-as-charges are IN SCOPE for Square, so this is the DEFAULT Square path.**

**Three dispatch shapes, not one:**

- **Shape A — request-scope early return:** `process-refund` (branch **before** the tenant select at `:258`, **not** after the unconditional `getConnectAccountId` at `:266`; the `:464` site stays frozen), `cancel-rental-refund` (after the tenant select at `:91`, before `:99`), `deduct-from-deposit` (`:675`).
- **Shape B — loop-scope, MANDATORY for `reject-rental`:** `refunds.create` at `:184` sits inside `for (const payment of payments)` at `:105`, so a top-of-function return would refund one payment and **silently skip the rest**. Resolve **above** the loop; inside do `if (attempt.handled) { record; continue; }`.
- **CRITICAL — the async-settlement gate:** `reject-rental`'s post-loop block at `:252-318` writes Refund ledger entries per payment from `payment_applications`. **Gate that entire block on `attempt.terminal`**, because `SQUARE_CAPABILITIES.refundsSettleAsynchronously` is `true` and a Square `RefundPayment` returns `PENDING` — otherwise it books refund ledger rows **for money that has not moved**. Same for `process-refund:456`/`:574` and `cancel-rental-refund:168`/`:465`.

**Refunds dispatch on the PAYMENT RECORD's provider, never the tenant's current one.**

**Files:** `process-refund/index.ts` · `cancel-rental-refund/index.ts` · `deduct-from-deposit/index.ts` · `reject-rental/index.ts`
**Merged from:** SQ-GUARD-09, SQ-GUARD-14, S-9, SQ-V1-08(refund half), SQ-RPT-6

---

### SQ-08 — Mirror `predicates.ts` into portal and replace the ad-hoc "real electronic money" proxies
**B · P1 · M · Stripe risk: med · depends: SQ-03**

`_shared/payments/predicates.ts` is already committed. Mirror it as `apps/portal/src/lib/payment-predicates.ts` (the Deno module cannot be imported by Next.js) and **ship both sides in ONE commit**.

Replaces the scattered `stripe_payment_intent_id IS NOT NULL` at `apply-payment:53`, `void-payment-link`, and portal sites `payments/page.tsx:153` / `:223` / `:301` / `:596`.

> **IMPORTANT:** `void-payment-link:118-125` is a **four-term composite** — `capture_status==='captured' || pi != null || paid_at != null || (status in [Applied,Completed,Partial] && capture_status !== 'requires_capture')` — whose own comment says it mirrors `use-payment-links.isCaptured()` exactly. **Preserve all four terms.** Record in-file that this pins **behavioural parity, not correctness.**

Ship while all 1,025 `payments` rows are still `provider='stripe'` so the classification is provably byte-identical.

`check-predicates.mjs`'s rule "raw provider comparison outside the seam" already bans `=== 'square'` outside `apps/*/src/lib/payment-*` — put the mirror there, and **add `apps/admin/lib/payment-*` to that allow list**, because `apps/admin` has **no `src/` directory** (its code is at `apps/admin/{app,components,hooks,lib,store}`).

**Files:** `apps/portal/src/lib/payment-predicates.ts` · `_shared/payments/predicates.ts` · `void-payment-link/index.ts` · `apps/portal/src/app/(dashboard)/payments/page.tsx` · `scripts/square-guardrails/check-predicates.mjs`
**Merged from:** S-12, G2-correction

---

### SQ-09 — Make the rental-health trigger provider-aware — and fix the OAuth blind spot as a sibling commit
**B · P1 · M · Stripe risk: HIGH · depends: — · second reviewer required**

`private.snapshot_rental_health()` is a **BEFORE INSERT trigger on `rentals`** whose gate is `stripe_ok := stripe_mode='live' AND stripe_onboarding_complete AND stripe_account_status IN ('active','enabled')`. A Square tenant carries the defaults forever, so **every Square booking is born `health_severity='critical'`** with *"Stripe not live-ready — payment may not be real"*, and `trg_notify_platform_rental` (AFTER INSERT, **no severity gate, no rate limit**, both `private.platform_config` keys populated so the `pg_net` POST is live) emails it.

**Mandated shape — do not refactor.** Leave the `stripe_ok :=` assignment **byte-identical**; change only the guard on the block that consumes it to:

```sql
IF t.payment_provider IS DISTINCT FROM 'square' AND NOT stripe_ok THEN
```

**Add** a `'square'` node to `creation_context` — **never rename `'stripe'`**, because `platform-rental-notify` and `platform-rentals` read `ctx.stripe` by name.

**Also fix the RENDERER**, which the source analysis cited only by subject line: `platform-rental-notify/index.ts:100-109` builds `integrationRow("Stripe Connect", !!s.live_ready, …)` **unconditionally**, so a Square tenant's email still shows a red Stripe row after the reason string is suppressed. Same for `platform-rentals/page.tsx:402`'s hardcoded tuple.

> **Reframing:** this is **not** a Square-introduced defect — 26 of 44 production tenants already fail `stripe_ok`, 19 rentals are already critical, and because the trigger never reads `own_stripe_account_id` it **already false-flags 6 production tenants routing live money through OAuth**. Fix that blind spot in a **separate commit in the same review session**: it changes Stripe-tenant output and needs its own before/after row counts.

**Highest-risk diff in the project** — a raise here aborts the INSERT and **every booking on the platform stops.**

**Files:** `supabase/functions/platform-rental-notify/index.ts` · `apps/admin/app/admin/(protected)/platform-rentals/page.tsx`
**Merged from:** SA-01, SA-01b

---

## 6. Task detail — M1, M2

### SQ-10 — Kill switch in `private.platform_config` so it gates the browser insert too, and gates CREATION never SETTLEMENT
**JOINT · P0 · M · Stripe risk: low · depends: —**

No `SQUARE_ENABLED` mechanism exists (zero grep hits). **Two corrections to doc 04's D0-8:**

**(1) An env secret cannot gate one of the two paths it claims to.** `CreateTenantDialog.tsx:83` is a raw **browser** `.from('tenants').insert()`; `apps/admin` has no feature-flag env pattern (only `NEXT_PUBLIC_SUPABASE_*` and VAPID); **a browser cannot read an edge-function secret.** `NEXT_PUBLIC_SQUARE_ENABLED` would need a Vercel redeploy, destroying the "seconds, no deploy" property that **is** the rollback.

Use **`private.platform_config`** (key/value, `private` schema so PostgREST cannot reach it, already read by `notify_platform_activity` via SECURITY DEFINER): add key `square_enabled`, a **BEFORE INSERT trigger on `tenants`** that raises when `payment_provider='square'` while the key is not `'true'`, and a SECURITY DEFINER RPC for edge functions and the admin UI. **One UPDATE flips everything.**

> Write the trigger so its **only** predicate is `NEW.payment_provider = 'square'` — false for all 52 existing tenants, one boolean comparison on the Stripe path. It must **never read `platform_config` on that path**, or a missing key becomes a tenant-creation outage.

**(2) Scope it to CREATION.** As originally written ("every Square branch returns a structured refusal") it would also refuse `square-webhook`, **stranding money Square already captured** — Square retries ~11 times over 24h then **discards the event forever**, and three weeks of non-2xx **auto-disables the single application-wide subscription**. `square-webhook` and the reconciler **always** verify signature, dedupe and return 2xx **regardless of the switch**.

**Files:** `_shared/payments/resolve.ts` · `_shared/payments/guard.ts` · `apps/admin/components/admin/CreateTenantDialog.tsx`
**Merged from:** KILL-1, KILL-2, P-5, RB-1

---

### SQ-11 — 🔴 Wire provider + country capture at tenant creation — the picker exists and is imported by nothing
**A · P0 · M · Stripe risk: low · depends: SQ-10 · ⚠️ needs LD-2**

**Verified current state:** `apps/admin/components/tenants/payment-provider-picker.tsx` is **554 LOC with zero importers**. `CreateTenantDialog.tsx:83` still raw-inserts six columns (`company_name`, `admin_name`, `slug`, `contact_email`, `status`, `tenant_type`). `create-sales-onboarding` writes **no provider and no country**. Combined with the now-live `trg_tenants_payment_provider_immutable`, `payment_provider` is set to `'stripe'` by default at birth and is **unchangeable through the product** — so a Square tenant cannot be created by any code path that exists.

- **(a)** `create-sales-onboarding` — the only path a sales agent can reach (`:932` accepts `is_super_admin || is_sales_agent`) — accepts `paymentProvider` (`'stripe'` default so every existing caller is **byte-unaffected**) and `country`; **validates BEFORE the insert** (reject an unknown provider; when `square`, require `country` and reject unless in AU/CA/FR/IE/JP/ES/GB/US); includes both in the `:1184` insert. **Without pre-validation the operator sees a bare 500**, because the insert error handler has only a unique-violation branch.
- **(b)** Mount `PaymentProviderPicker` in `SalesOnboardingDialog`.
- **(c)** `CreateTenantDialog` — **decide and write it down** (LD-2). Recommended: leave it **Stripe-only**.
- **(d)** Add a SECURITY DEFINER `admin_set_tenant_payment_provider(uuid, text)` gated on `is_super_admin()` **AND zero `payments` rows**, as the **only** sanctioned correction for a creation typo — without it the first mistake gets fixed by someone disabling the trigger in prod, which is strictly worse.

**Files:** `create-sales-onboarding/index.ts` · `apps/admin/components/admin/SalesOnboardingDialog.tsx` · `apps/admin/components/tenants/payment-provider-picker.tsx` · `apps/admin/components/admin/CreateTenantDialog.tsx`
**Merged from:** P-1, P-2, P-3, P-4, S-19, S-20, SQ-V1-10, DDL-9, COPY-00b, SA-07

---

### SQ-12 — Write the two Square provisioning invariants that will NOT arrive by default
**A · P0 · S · Stripe risk: none · depends: SQ-11**

Only two columns need an explicit write when `payment_provider='square'`, and **the second is far more load-bearing than a preference**.

1. **`payg_auto_reminders_enabled = false`** — the DB default is **TRUE** and PAYG is out of Square v1.
2. **`deposit_charge_enabled = true`** — `place-deposit-hold` is invoked **unconditionally** from two booking-success call sites, and its only clean pre-Stripe early exit is `if (tenant.deposit_charge_enabled === true) return {skipped:true}` at `:209`. With the live defaults (`deposit_charge_enabled=false`, `security_deposit_enabled=true`) a Square tenant **falls through** that guard, past the `security_deposit_enabled` check at `:331`, into **Stripe client resolution on every booking**. Writing this flag is **the mechanism that renders the out-of-scope authorization-hold chain safely inert for Square** — not a preference.

> **LEAVE `security_deposit_enabled` at its `true` default.** `apply-payment:118` requires **both** flags to agree (`security_deposit_enabled !== false && deposit_charge_enabled === true`), so flipping it to `false` **disables deposits entirely** rather than routing them to the charge path.

`installments_enabled`, `auto_extend_enabled` and `migration_blocker` already default correctly — write them for explicitness, but they are not what closes the gap.

Add the `tenants` CHECK that makes the v1 surface un-re-enableable:

```sql
payment_provider <> 'square'
OR (installments_enabled IS NOT TRUE
    AND auto_extend_default_charge_mode = 'pay_link'
    AND (security_deposit_enabled IS NOT TRUE OR deposit_charge_enabled IS TRUE))
```

Verified sound against real column nullability: `installments_enabled` and `security_deposit_enabled` are **NULLABLE**, so `IS NOT TRUE` is mandatory; the other two are NOT NULL.

**Files:** `create-sales-onboarding/index.ts` · `place-deposit-hold/index.ts`
**Merged from:** P-7, SQ-V1-03, SQ-V1-10

---

### SQ-13 — 🔴 Build `square-disconnect`, and mount `square-settings.tsx` (both exist-but-unreachable)
**A · P0 · M · Stripe risk: none · depends: —**

**Two verified holes the source decisions did not have.**

1. `apps/portal/src/hooks/use-square-connection.ts:397` invokes edge function **`square-disconnect`**. `ls supabase/functions | grep square` returns only `refresh-square-tokens`, `square-oauth-callback`, `square-oauth-start`, `square-webhook` — **the function does not exist**, so disconnect fails with function-not-found. Build it: revoke the token at Square, delete both Vault secrets, set `status='revoked'` and `disconnected_at`, and **never delete the row** (an event about money that already moved must still resolve `merchant_id → tenant_id` in `square-webhook`'s `resolveTenant`).
2. `apps/portal/src/components/settings/square-settings.tsx` is **921 LOC and mounted nowhere** — `settings/page.tsx:2919` still renders `<StripeConnectSettings />` unconditionally, and that component's only branch (`stripe-connect-settings.tsx:134`) picks between the managed Express panel and `OwnStripeSettings`, **both Stripe-only**. A Square operator has **no connect surface at all**.

Add a **third branch at the TOP** of `stripe-connect-settings.tsx` — before the existing own/managed logic — with an explicit `payment_provider === 'square'` early return (**never a truthiness or negation test**, so `null`/`undefined` takes the current path unchanged). **Do not refactor the existing own/managed branch: it carries a documented production incident.**

**Files:** `square-disconnect/index.ts` · `use-square-connection.ts` · `stripe-connect-settings.tsx` · `square-settings.tsx` · `apps/portal/src/app/(dashboard)/settings/page.tsx`
**Merged from:** TYPE-10, COPY-00

---

### SQ-14 — 🔴 Schedule `refresh-square-tokens` and a `square_oauth_state` reaper, with `cron_runs` heartbeats
**A · P0 · M · Stripe risk: none · depends: —**

**Verified against all 28 live cron jobs:** there is **no row** for `refresh-square-tokens` and **none** for a `square_oauth_state` reaper. The function is built (with the correct **7-day** `SQUARE_REFRESH_WINDOW_DAYS`, not the accounting precedent's 15 **minutes**) but **nothing invokes it**. Square access tokens expire in **30 days**, so without this every Square tenant stops taking money on the same day, silently, with no vendor signal — and **token expiry is a pure clock event with no row change**, so nothing can ever push it.

Schedule at `*/10` to match jobid 49.

**Acceptance is four queries, all pasted into the PR:**

| # | Query | Why the obvious alternative is not evidence |
|---|---|---|
| a | `SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname='refresh-square-tokens'` → exactly one active row | the manifest is **drifted by 6 jobs** and repo migrations do not describe scheduling |
| b | `job_run_details` shows the expected dispatch count | — |
| c | a **CLOSED `cron_runs` row with `finished_at` set** | (b) cannot prove this: `http_post` reports success **on enqueue** — all 28 jobs show `failed_24h=0` while `pg_net` logged **3.6% non-2xx** in the same window |
| d | one **real token refreshed** — `token_expires_at` moved forward | — |

Add the `cron_runs` heartbeat **to `refresh-square-tokens` itself** — the named precedent `refresh-accounting-tokens` has **zero `cron_runs` references in 326 LOC**, so a faithful clone ships blind. Map `rows_considered → total_due` and `rows_acted → processed`: **the columns `rows_considered` / `rows_acted` DO NOT EXIST** and are referenced at five doc sites.

> Filter every dead-man check by **exact `job_name`** and key it on **`finished_at`** — 12 `cron_runs` rows are **future-dated to 2026-11-16** by the staging Time Machine, so an unfiltered `max(started_at)` reports jobs healthy until November.

**Files:** `refresh-square-tokens/index.ts` · `sim-control/cron-manifest.json` · `03-STRIPE-SAFETY-AND-EDGE-CASES.md`
**Merged from:** CH-4, CH-5, CH-8, CH-10, CH-11, S-14(cron half), A-6, A-7

---

### SQ-15 — Reconcile `tenants.country` against Square `Merchant.country` at the OAuth callback
**A · P1 · S · Stripe risk: none · depends: SQ-13**

Square's `Merchant` object exposes `country` as **REQUIRED**, two-letter ISO-3166 — so the **authoritative** country arrives at connect, and `tenants.country` is only a **pre-OAuth declaration gate** (the CHECK fires at INSERT, before any connection exists).

The callback must **(a)** refuse to persist a `square_connections` row whose `merchant.country` is outside AU/CA/FR/IE/JP/ES/GB/US, and **(b)** refuse when it **disagrees** with `tenants.country`, surfacing the mismatch rather than silently trusting either side. Store the verified merchant country on `square_connections`.

Keep the 8-country list in **exactly two places** — `capabilities.ts:161 isCountrySupported()` and `tenants_square_country_supported_check` — and add a **drift guard** asserting they are identical; the DB copy is the only control over the manual-SQL / `service_role` path that no TypeScript can police.

Re-verified against Square's own documentation on 2026-08-25: **Australia, Canada, France, Ireland, Japan, Spain, United Kingdom, United States**. **UAE explicitly absent**, which matters because a UK→UAE Stripe migration is in flight. **GB, never UK.**

Also record in the capability matrix that **Square does not support delayed capture or partial authorization in JAPAN**, which *is* inside the eight — flag it before a JP tenant is sold.

**Files:** `square-oauth-callback/index.ts` · `_shared/payments/capabilities.ts` · `scripts/square-guardrails/check-predicates.mjs`
**Merged from:** DDL-10, P-6

---

### SQ-16 — 🔴 A Square tenant cannot take a booking — `setup_future_usage` is unconditional, so the seam refuses every checkout
**B · P0 · L · Stripe risk: HIGH · depends: SQ-01, SQ-12 · ⚠️ needs LD-1 · second reviewer required**

**The finding no source decision names, verified in the shipped code.** `create-checkout-session:201` calls `tryProviderCheckout` with `requiresStoredCredential: true` at `:207`, and the in-file comment at `:195-196` says why: **line 320 sets `payment_intent_data: { setup_future_usage: 'off_session' }` unconditionally.** Since Square hosted Payment Links **cannot vault a card**, the seam **correctly returns a structured refusal** — which means the **primary in-scope capability (booking checkout) is currently a 4xx for every Square tenant, not a payment.**

The preamble is otherwise **placed correctly** (`:201`, before the Stripe client at `:227` and `getConnectAccountId` at `:230`) and the Stripe path is byte-identical, so **the fix is narrow: make vaulting CONDITIONAL.**

A Square tenant runs deposit-as-charge (forced `true` by SQ-12) and has no instalments, no PAYG, no auto-extend `auto_charge` and no holds — **so it needs no stored credential at all.** Pass `requiresStoredCredential` as a **computed value** rather than a literal: `false` when the resolved provider cannot vault **AND** the tenant's flag set does not require one.

> **DISCIPLINE.** The Stripe branch must still emit `setup_future_usage` on **every single Stripe path**. Assert that with the SQ-01 static guard, which counts the **13 unconditional `setup_future_usage: 'off_session'` assignments** across the repo and **fails on any decrease**. A Stripe tenant silently losing that token **does not fail**: it returns a valid session, takes the money, and never vaults the card — surfacing weeks later as auto-extend and PAYG unable to charge saved cards **estate-wide**, with no trail back to the Square commit.

**Files:** `create-checkout-session/index.ts` · `_shared/payments/checkout.ts` · `_shared/payments/capabilities.ts` · `scripts/square-guardrails/check-vault-token.mjs`
**Merged from:** S-7, T8, SQ-V1-08(checkout half), R-2

---

### SQ-17 — Extend the seam preamble to the other 3 reachable creators
**B · P0 · M · Stripe risk: med · depends: SQ-16**

Only `create-checkout-session` carries a preamble today (verified: it is the **sole** non-seam file referencing `tryProviderCheckout`). Reachability triage says **exactly four** creators are reachable by a Square tenant in v1; the other three are:

| Fn | Preamble goes before |
|---|---|
| `create-extension-checkout` | the Stripe client at `:215` |
| `send-invoice-email` | `:273` |
| `send-excess-mileage-payment-link` | `:60` |

**Shape:** `const routed = await tryProviderCheckout(...); if (routed.handled) return ...;` followed by the marker comment `// ── nothing below this line changes ──`.

> **MUST sit AFTER the existing `await req.json()`.** All of them call it exactly once and **none clones**, so a preamble that re-reads the body throws *"Body already consumed"* and **breaks every Stripe call in that file** while *adding* lines and passing a zero-deleted-lines gate. **ADD lines only.**

**The reachability budget is the acceptance test:**

```bash
git diff --name-only square-baseline -- supabase/functions \
  | grep -f scripts/payments-money-functions.txt | wc -l   # must be ≤ 8
```

This is what stops the diff quietly re-expanding to 16 files once someone "adds the preamble everywhere for consistency".

Also add `square_*` sibling columns to **`rental_extensions`**: `create-extension-checkout` writes `stripe_checkout_session_id` to **both** `payments` and `rental_extensions` at `:303-305`, extensions are in scope, and without them the Square webhook **cannot correlate an extension payment to its extension row**.

**Files:** `create-extension-checkout/index.ts` · `send-invoice-email/index.ts` · `send-excess-mileage-payment-link/index.ts`
**Merged from:** S-7, SQ-GUARD-07, G0b

---

### SQ-18 — 🔴 Build `reconcile-square-payments` — Square has no analogue of the per-minute Stripe recovery cron
**A · P0 · L · Stripe risk: none · depends: SQ-14**

Stripe has a safety net: `recover-pending-stripe-payments` (**jobid 34, `* * * * *`**) sweeps `Pending` payments carrying a session id inside a 24h window. **Square has none** — verified, zero Square-named cron jobs exist.

Square's own documentation states an event is retried ~11 times with exponential backoff and then *"After 24 hours, the notification is discarded and no further retry attempts are made."* So a lost `payment.updated` leaves a Square row `Pending` **forever** with no vendor signal, and a lost `refund.updated` leaves `refund_status='processing'` forever — **and there is no `CancelRefund` endpoint to unwind it manually.**

Build a sibling sweeping `payment_provider='square' AND status='Pending' AND square_order_id IS NOT NULL` (and separately `refund_status='processing'` with a `square_refund_id`), calling Square **RetrieveOrder** / **GetPaymentRefund** and settling through the **same `square-status-map` invariant**: write `payments.status='Completed'` **only for Square `COMPLETED`, never `APPROVED`** — settlement runs through **8 DB triggers, none of which reads a provider column**.

Its coverage window must comfortably **exceed 24 hours**; **do not inherit the Stripe cron's blind spot.** Separate cron entry so its failure can never starve jobid 34.

Also log Square's **`square-retry-number`** and **`square-retry-reason`** headers on every `square-webhook` request — `retry-number > 0` is **direct per-event proof** a prior delivery failed, and a number near 11 is the last warning before permanent discard. That beats inferring from an aggregate non-2xx rate.

**Files:** `reconcile-square-payments/index.ts` · `square-webhook/index.ts` · `_shared/payments/square-status-map.ts`
**Merged from:** S-22, OBS-2, A-19

---

### SQ-19 — Enqueue `financial_events` on the Square settlement path, or Xero/Zoho silently omits 100% of Square revenue
**A · P1 · M · Stripe risk: none · depends: SQ-16**

**Verified:** `square-webhook` is 951 LOC, writes `payments` rows directly at `:588` and `:703`, and contains **zero references to `enqueue_financial_event`**. Nothing in the DB compensates — all **8 triggers on `public.payments`** were enumerated and **none enqueues anything**; the RPC is called **explicitly** from ~10 money-path edge functions (`apply-payment`, `process-refund`, `process-pending-payment`, `capture-deposit-hold`, `accrue-payg-charges`, `apply-fine`, `calculate-excess-mileage`, `bonzah-confirm-payment`, `tesla-sync-engine`).

So today a Square payment produces **no ledger event**: the admin Finance Sync tab reads *"No financial events yet"* forever **and** the accounting sync omits every Square receipt **with no error anywhere**. This is accounting correctness, not cosmetics.

**Good news, verified:** the surface is **provider-agnostic by construction** — `financial_events` has no stripe/provider column (`source_table`/`source_id` only) and `enqueue_financial_event` takes no provider argument. **No schema, RPC or UI change is needed.** Call the RPC from the Square branch at the same points the Stripe path does.

> **DO NOT "centralise" this with a trigger on `payments`** — that would **double-write the ledger** for the existing Stripe code paths and corrupt Xero invoices.

**Acceptance:** one Square payment and one Square refund each produce the matching `financial_events` row for that tenant, visible in the Finance Sync tab.

**Files:** `square-webhook/index.ts` · `apps/admin/components/admin/finance-events-tab.tsx`
**Merged from:** SA-05, FIN-5

---

### SQ-20 — Accounting: fail closed on an unqualified clearing account, and repair the save that reports success on a no-op
**B · P1 · L · Stripe risk: low · depends: SQ-19**

Three items, **ordered so the dangerous one lands first**.

**(1) FAIL-CLOSED GUARD (~10 lines) — ship BEFORE the repair.** In `process-accounting-sync`'s `payment_receipt` case (`:302`), refuse to call `provider.recordPayment` and `markFailed` with `NO_PROVIDER_PAYMENT_ACCOUNT` whenever the tenant's rail is not `'stripe'` **and** the matched sentinel is not qualified for that rail — **and be fail-closed on the UNRESOLVED case too**. `financial_events.source_id` has **no foreign key** and already dangles: only **445 of 483** `payment_receipt`/`refund` events resolve to a `payments` row (**92.1%, not the 99.8% previously claimed**), so ~8% would otherwise post to the tenant's Stripe clearing account.

> **The asymmetry justifies it:** a failed sync row is trivially retried, whereas a **mis-post is recoverable through no in-product path** — `retry-accounting-sync` skips `state='synced'`, and Xero's idempotency key **omits the account code**, so a corrected retry either returns the original wrong payment or double-counts the cash.

**(2) LIVE P0, unrelated to Square.** `save-accounting-mappings` **can never write a row and reports success anyway.** Both `.upsert()` calls target **PARTIAL unique indexes** Postgres cannot infer without an `index_predicate` (`42P10`); supabase-js v2 returns `{data,error}` rather than throwing, so the try/catch never fires; and the counters increment unconditionally — the portal shows a green *"N mappings saved"* toast for a **total no-op** (18/18 rows are seed-written, **zero UPDATEs ever, zero sentinels platform-wide**). Route through a SECURITY DEFINER RPC with the index predicate, and **destructure `{ error }` on every write**.

**(3)** Add a nullable `payment_provider` dimension to `accounting_account_mappings` with `UNIQUE NULLS NOT DISTINCT (tenant_id, provider, payment_provider) WHERE is_payment_account_sentinel` (prod is **PG 17.6**).

Also **gate the OAuth-connect retro-enqueue**: both callbacks call `backfill_missing_sync_rows` with **no event-type filter and no date bound**, so one click of *Connect Xero* on a Square tenant queues its **entire history** through the single sentinel.

**Files:** `process-accounting-sync/index.ts` · `save-accounting-mappings/index.ts` · `xero-oauth-callback/index.ts` · `zoho-oauth-callback/index.ts` · `apps/portal/src/components/settings/accounting-mappings.tsx`
**Merged from:** FIN-1, FIN-2, FIN-3, FIN-4, FIN-6, FIN-8, FIN-9, FIN-10

---

### SQ-21 — Make Square payment links visible to the three operator surfaces that define a link as a Stripe session
**A · P1 · M · Stripe risk: med · depends: SQ-16**

**Verified still unfixed:** `use-payment-links.ts` defines a payment link as `.not("stripe_checkout_session_id","is",null)` at `:188` and `:244`, and its column list at `:50` does not include `square_order_id`. A Square link carries `square_order_id` and NULL there, so it **appears nowhere**.

Three surfaces go blind: the **rental detail page** (`useRentalPaymentLinks`), the **customer detail page** (`useCustomerPaymentLinks`) and the **invoices Payment Requests tab** (`useTenantPaymentRequests`).

Payment links are an **explicitly in-scope capability** per the briefing, so this is not a Square bug of the acceptable kind — **it is the feature not existing**: an operator can send a Square link and then has no screen on which to see, chase or void it.

Widen to `.or('stripe_checkout_session_id.not.is.null,square_order_id.not.is.null')` and add the column. Then audit the two derived helpers on the **same rows**: `isCaptured()` at `:86` uses `stripe_payment_intent_id != null` as **one of four** money-arrived signals — the other three already cover a Square payment; **verify rather than assume**.

> **Cross-check with the money lane before editing:** `isVoidableLink` in `payments/page.tsx:149-158` requires `!!stripe_checkout_session_id`, so **Void never offers itself for a Square link today**. Decide **deliberately** whether Square links are voidable (`SQUARE_CAPABILITIES` records no hosted-link expiry, and **DeletePaymentLink does exist**) rather than letting the widened predicate surface a button the server refuses.

**Medium Stripe risk:** this hook feeds three live operator surfaces for all 52 tenants — **run both predicates over live `payments` and diff to empty before merging.**

**Files:** `apps/portal/src/hooks/use-payment-links.ts` · `payments/page.tsx` · `payment-links-panel.tsx` · `void-payment-link/index.ts`
**Merged from:** SQ-RPT-7
