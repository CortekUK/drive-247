# Payment plans — design (Plan B), slice 1

**Status:** Sep 25 2026, branch `haseeb/payment-unification`. The contract the
build agents work to. The *what* is `docs/PAYMENT_PLANS_UNIFIED_SPEC.md` (the
lead's walkthrough); this is the *how*. The code contract is
`supabase/functions/_shared/payment-plans/types.ts` — where this document and
that file disagree, fix one of them before writing code.

**Nothing in this slice is applied to production or deployed.** Migrations are
files; edge functions are source; the cron is a snippet. Applying and deploying
are separate, explicit approvals.

---

## 1. The approach

**Plan B — new schedule layer, existing money engine.**

- `payment_plans` + `payment_plan_occurrences` own **when** and **how much**.
- The existing money engine owns **taking the money**: a payment is a normal
  `payments` row inserted with `status='Completed'`, and the live trigger
  `auto_fifo_on_payment_insert` → `payment_apply_fifo_v2` allocates it to the
  rental's ledger charges, exactly as every other payment on the platform.
- One cron (`run-payment-plans`) walks due occurrences. One engine, one
  simulation (spec §4.3).
- Stripe/Square move money only. We own the calendar (research: Stripe
  schedules cap at 10 phases, anchor in UTC, and cannot express "every third
  day" or "twice a week").

### Why this is safe to build now

Measured in production on Sep 25 2026: installments have been used **once**
(internal tenant), PAYG on **4** rentals (2 closed, 2 paused test). So the new
path replaces them at almost no migration cost. Auto-extension (9 rentals, all
RevTek + test) and manual extension (534, used daily by GMT, RevTek, Kedic,
Paramount) are where a regression would hurt — they are **not touched in this
slice**.

---

## 2. Decisions and assumptions

| # | Decision | Basis |
|---|---|---|
| D1 | **Green, staged.** The model and engine are built to carry all four (extension, auto-extension, PAYG, installment). Slice 1 switches on the PAYG + installment fusion (spec §2's core task). Auto-extension moves onto the engine in slice 3, manual extension last. | Spec §4 leaning + prod usage above |
| D2 | **Twice a week = two named weekdays** the operator picks. | RFC 5545 can express it; "every 3–4 days" has no single-rule form (research E1). Spec §13 Q3 — confirm with lead |
| D3 | **The occurrence's local calendar date is the truth**; `due_at` (instant) is derived from date + 10:00 local + tenant IANA timezone. Occurrence N is computed from the anchor, never from N−1. | Research E1: `t += 7·86400000` turns "every Friday" into every Thursday at the first DST change (measured) |
| D4 | **Month-end clamps and returns** (31st → Feb 28 → Mar 31). | Stripe's behaviour; RFC's "skip the month" loses 5 payments a year |
| D5 | **A plan never collects more than the rental owes.** Every claim computes `min(occurrence remaining, rental outstanding − unapplied credit)`. | Makes manual + auto + early payments safe to mix |
| D6 | **Exactly-once lives in Postgres.** Stripe's idempotency key protects minutes (24 h window, caches failures), not a weeks-long plan. | Research E2/E3 |
| D7 | **Auto charge falls back to a link** when the card needs the customer (`authentication_required`) or is dead. | SCA is a normal outcome, a hard decline for retries |
| D8 | **The emailed link is a stable URL** (`/pay/plan/<token>` on the booking site) that mints a fresh Checkout Session on click. | A `cs_…` URL dies after 24 h; the due date is known days ahead |
| D9 | **Slice 1 collects against charges already on the ledger.** Open-ended plans that *post* charges (true PAYG/auto-extend) are slice 3. | Keeps slice 1 off the charge-posting code |
| D10 | **Customer-created plans:** admin only in slice 1; `created_via` leaves room. | Spec §13 Q2 open |
| D11 | **"Checkout opens on the spot" is dropped** — not built. | Spec §5.1 |
| D12 | A refunded occurrence is re-opened but **never auto-charged again**; only an operator action collects it. | A refund is deliberate; silently re-charging it would be the worst possible bug |

---

## 3. Schedule semantics

Defined in `types.ts` (`ScheduleRule`, `AmountSpec`, periods). Additions:

- **Amount modes:** `split_total` (equal, remainder cents on the last),
  `split_by_days` (total × days_i ÷ total days, rounded down, remainder on the
  last — "pay for the time each payment covers"), `fixed`, `per_period`
  (days × daily rate; used by open plans in slice 3).
- **Validation errors** (the generator throws `PlanRuleError` with a `code`):
  `interval_invalid` (< 1), `weekday_required`, `month_day_invalid`
  (0, < −1, > 31), `dates_required`, `date_before_anchor`, `count_invalid`
  (< 1), `no_occurrences` (e.g. until < anchor), `too_many_occurrences`
  (> 520), `amount_too_small` (any occurrence < 1 cent), `charge_time_invalid`
  (00:00–03:59).
- **Overrides** at creation: `{ seq, moveTo }` moves a due date; periods and
  amounts are unchanged ("moved to Monday, still covers Oct 2–8").

### 3.1 Golden table — hand-derived, independently checked (Python `datetime`/`zoneinfo`)

These literals are the acceptance test for `schedule.ts` + `amounts.ts`. They
were derived by hand and cross-checked with Python's calendar, **not** produced
by the implementation. A test may not be "fixed" by changing a literal without
re-deriving it the same way.

| id | rule | amount | expected due dates → amounts (cents) |
|---|---|---|---|
| G1a | weekly, interval 1, [Fri], anchor 2026-09-30 (Wed), on_anchor, rental_end 2026-10-28 | fixed 30000 | 09-30 (stub) 30000 · 10-02 · 10-09 · 10-16 · 10-23 → 5 × 30000 |
| G1a periods | | | [09-30,10-02) 2d · [10-02,10-09) 7 · [10-09,10-16) 7 · [10-16,10-23) 7 · [10-23,10-28) 5 = 28 days |
| G1b | same | per_period 5000/day | 10000 · 35000 · 35000 · 35000 · 25000 = 140000 |
| G1c | same | split_total 140000 | 28000 × 5 |
| G1d | same | split_by_days 140000 | 10000 · 35000 · 35000 · 35000 · 25000 |
| G1e | same but on_rhythm | per_period 5000/day | 10-02 [09-30,10-09) 9d 45000 · 10-09 35000 · 10-16 35000 · 10-23 [10-23,10-28) 25000 = 140000 |
| G2 | daily, interval 3, anchor 2026-09-30, count 5 | split_total 100000 | 09-30 · 10-03 · 10-06 · 10-09 · 10-12 → 20000 each; last period [10-12,10-15) |
| G3 | weekly, interval 3, [Thu], anchor 2026-10-01, until 2026-12-31 | split_total 100000 | 10-01 · 10-22 · 11-12 · 12-03 · 12-24 → 20000 each |
| G4 | weekly, interval 2, [Mon], anchor 2026-10-05, count 4 (crosses DST end 11-01) | split_total 100000 | 10-05 · 10-19 · 11-02 · 11-16 → 25000 each |
| G5 | weekly, interval 1, [Mon, Thu], anchor 2026-09-30 (Wed), on_rhythm, count 6 | split_total 100000 | 10-01 · 10-05 · 10-08 · 10-12 · 10-15 · 10-19 → 16666 × 5, 16670 |
| G5b | same, on_anchor | split_total 100000 | 09-30 (stub) · 10-01 · 10-05 · 10-08 · 10-12 · 10-15 |
| G6 | monthly, interval 1, day 31, anchor 2027-01-31, count 5 | — | 2027-01-31 · 02-28 · 03-31 · 04-30 · 05-31 |
| G7 | monthly, day −1, anchor 2028-01-15, on_rhythm, count 3 | — | 2028-01-31 · 02-29 · 03-31 |
| G8 | weekly, [Fri], anchor 2026-09-25 (Fri), open through 2026-10-23 | fixed 30000 | 09-25 · 10-02 · 10-09 · 10-16 · 10-23 (no stub: anchor is a Friday) |
| G9 | daily, interval 7, anchor 2026-03-05, count 3 (crosses DST start 03-08) | — | 03-05 · 03-12 · 03-19 |
| G10 | dates [10-10, 10-01, 10-20, 10-10] (2026), anchor 2026-10-01 | split_total 90000 | 10-01 · 10-10 · 10-20 → 30000 each |
| G11 | monthly, interval 2, day 30, anchor 2026-12-30, count 3 | — | 2026-12-30 · 2027-02-28 · 2027-04-30 |
| G12 | weekly, interval 2, [Tue, Sun], anchor 2026-09-29 (Tue), count 4 | — | 09-29 · 10-04 · 10-13 · 10-18 (ISO weeks, WKST=MO) |

**Local date / instant** (`localDateInZone`, `dueAtUtc`):

| id | input | expected |
|---|---|---|
| L1 | 2026-09-25T03:30:00Z in America/Los_Angeles | 2026-09-24 |
| L2 | 2026-09-24T21:00:00Z in Asia/Dubai | 2026-09-25 |
| L3 | 2026-11-02 10:00 America/New_York | 2026-11-02T15:00:00.000Z (EST) |
| L4 | 2026-10-30 10:00 America/New_York | 2026-10-30T14:00:00.000Z (EDT) |
| L5 | 2026-03-09 10:00 America/Los_Angeles | 2026-03-09T17:00:00.000Z (PDT) |
| L6 | 2026-09-30 10:00 Asia/Dubai | 2026-09-30T06:00:00.000Z |
| L7 | 2026-10-02 10:00 America/Chicago | 2026-10-02T15:00:00.000Z |

---

## 4. Schema (migration `20260925120100_payment_plans.sql`)

Text + CHECK rather than enums (cheaper to widen). All money `numeric(12,2)`;
the TS layer converts to integer cents at the boundary.

**`payment_plans`** — id uuid pk · tenant_id → tenants (cascade) · rental_id →
rentals (cascade) · customer_id → customers (cascade) · status
(`active|paused|completed|cancelled`) · freq (`daily|weekly|monthly|dates`) ·
interval_count int 1..52 · by_weekday smallint[] (1..7) · by_month_day
smallint (−1, 1..31) · explicit_dates date[] · anchor_date date · anchor_source
(`rental_start|custom`) · first_occurrence (`on_anchor|on_rhythm`) · end_kind
(`rental_end|count|until|open`) · occurrence_count int 1..520 · until_date date
· timezone text · charge_local_time time default 10:00 (CHECK ≥ 04:00) ·
amount_mode (`split_total|split_by_days|fixed|per_period`) · total_amount ·
fixed_amount · daily_rate · currency · collection_method
(`auto_charge|checkout_link|manual`) · fallback_to_link bool default true ·
max_attempts int default 3 (1..10) · retry_after_days int default 2 (1..14) ·
reminder_offsets int[] default {-2,0,2} · payment_provider (`stripe|square`) ·
stripe_payment_method_id text · extends_rental bool default false · version
int default 1 · created_by → app_users · created_via
(`portal|booking|migration|simulation`) · legacy_source
(`installment_plan|payg|auto_extend`) · legacy_id uuid · created_at ·
updated_at · paused_at · cancelled_at · completed_at.
Consistency CHECKs tie each freq/end/amount mode to its required column.
**`UNIQUE (rental_id) WHERE status IN ('active','paused')`** — one live plan
per rental.

**`payment_plan_occurrences`** — id · tenant_id · plan_id (cascade) ·
rental_id · seq int · plan_version int · due_date date · due_at timestamptz ·
period_start date · period_end date · amount numeric > 0 · amount_paid numeric
≥ 0 default 0 · collection_method · status (§6) · attempt_no int default 0 ·
next_attempt_at timestamptz · link_token_hash text UNIQUE · moved_from date ·
note text · paid_at · created_at · updated_at.
**`UNIQUE (plan_id, seq)`** (seqs only grow; a plan change supersedes and
appends). Index `(status, due_at)` for the cron.

**`payment_plan_attempts`** (append-only) — id · tenant_id · occurrence_id ·
attempt_no · method · idempotency_key text **UNIQUE** · status (types.ts
`AttemptStatus`) · provider (`stripe|square|manual|simulated`) ·
provider_account · provider_mode (`test|live`) · provider_ref ·
checkout_session_id · payment_id → payments (set null) · amount > 0 ·
decline_code · error_code · error_message · created_by · created_at ·
finished_at.
**`UNIQUE (occurrence_id) WHERE status IN ('claimed','in_flight')`** — a second
concurrent charge on one occurrence is a constraint violation, not a code path.
Idempotency key: `pp:{provider_account or 'platform'}:{occurrence_id}:{attempt_no}`.

**`payment_plan_events`** — the one web of reminders, the timeline, and the
evidence trail. id · tenant_id · plan_id · occurrence_id · kind (types.ts
`PlanEventKind`) · dedupe_key text UNIQUE · channel · delivery_status
(`pending|sent|failed|skipped`) · amount · detail jsonb · actor_id · created_at.

**`payment_plan_revisions`** — id · tenant_id · plan_id · version · changed_by
· reason · before jsonb · after jsonb · created_at.

**`payments.payment_plan_occurrence_id`** uuid → occurrences (set null), indexed.

**RLS** on all five: tenant staff SELECT (`tenant_id = get_user_tenant_id() OR
is_super_admin()`); **no** INSERT/UPDATE/DELETE for `authenticated` — every
write goes through a SECURITY DEFINER function executable by `service_role`
only. No `anon` grants. Not added to `supabase_realtime` in slice 1 (the UI
polls).

### 4.1 Prerequisite migration `20260925120000_ledger_allocation_prerequisites.sql`

Measured defects the plan engine would otherwise inherit. Written from the
**live** function body (`tests/payment-plans/fixtures/live-functions-2026-09-25.sql`),
**not** the stale repo migration.

1. `payment_apply_fifo_v2`: `cat_order` becomes a `VALUES` list joined with
   **LEFT JOIN** and `COALESCE(pri, 13.5)` — an unknown category is settled
   just before Security Deposit instead of vanishing. Adds `Excess Mileage`,
   `Unlimited Mileage`, `Supercharger`, `InitialFee`, `Initial Fees`,
   `Adjustment`, `Extension`, `Extension Add-on`. Every existing priority is
   unchanged.
2. Same function: the P&L category is mapped (`Fine→Fines`,
   `InitialFee→Initial Fees`, `Extension Add-on→Extras`, anything not allowed
   by `chk_pnl_category_valid` → `Other`) so a newly reachable category can
   never abort a payment on the P&L CHECK.
3. Same function: `payment_applications` `ON CONFLICT … DO UPDATE SET
   amount_applied = payment_applications.amount_applied +
   EXCLUDED.amount_applied` — the allocation record now moves in step with the
   `remaining_amount` decrement and the (already additive) P&L row.
4. `ledger_entries_category_check` += `Extension Add-on` (the auto-extend
   extras insert can currently only fail).
5. `payments_booking_source_check` += `payment_plan`.
6. `v_ledger_allocation_drift` — read-only report view (security_invoker, no
   anon grant): charges where `amount − remaining_amount ≠ Σ applications`.
   15 rows on Sep 25 2026. **No data repair in this migration** — repairs are
   per-row and need sign-off.

---

## 5. SQL functions (the store contract)

All `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM PUBLIC,
anon, authenticated`, `GRANT EXECUTE TO service_role`. Every function that
changes state asserts its row count and **raises** on zero — a silent no-op is
the bug class behind most July 2026 money bugs.

| function | contract |
|---|---|
| `pp_create_plan(p_plan jsonb, p_occurrences jsonb, p_actor uuid) → uuid` | insert plan + occurrences + `plan_created` event, one transaction |
| `pp_replace_future(p_plan_id, p_expected_version int, p_plan_patch jsonb, p_occurrences jsonb, p_actor, p_reason) → int` | optimistic version check; refuses while any occurrence is `processing`; supersedes every non-terminal, non-paid occurrence; appends the new ones with seqs after the max; bumps version; writes a revision |
| `pp_collect_due(p_as_of timestamptz, p_tenant uuid, p_plan uuid) → setof occurrences` | `scheduled→due` where `due_at ≤ p_as_of` and the plan is active; returns actionable rows: `due`, or `failed` with `next_attempt_at ≤ p_as_of`, plans `active` only |
| `pp_list_for_reminders(p_as_of, p_horizon_days int, p_tenant, p_plan) → setof occurrences` | open occurrences whose due_date is within ±horizon of the plan-local today |
| `pp_apply_rental_credit(p_rental_id)` | runs `payment_apply_fifo_v2` over the customer's captured `Credit`/`Partial` payments on that rental |
| `pp_rental_owed_cents(p_rental_id) → bigint` | Σ open charge remaining (excl. Security Deposit) − unapplied captured credit on the rental; floor 0 |
| `pp_claim(p_occurrence_id, p_method text, p_provider_account text) → jsonb` | locks the occurrence; `not_claimable` unless status ∈ due/failed/requires_action/partially_paid; `held_elsewhere` if a claimed/in_flight attempt exists; applies rental credit, computes `amount = min(remaining, owed)`; if 0 → occurrence `skipped` + `covered_by_balance` event, returns `nothing_owed`; else attempt_no+1, inserts attempt `claimed` with the key, occurrence → `processing` |
| `pp_mark_in_flight(p_attempt_id)` | claimed → in_flight |
| `pp_record_success(p_attempt_id, p_amount, p_provider_ref, p_provider_account, p_provider_mode, p_payment_provider, p_platform_account, p_payment_date, p_method, p_checkout_session_id) → uuid` | ONE transaction: idempotent (already succeeded → return its payment id); inserts the `payments` row (`status 'Completed'`, `payment_type 'Payment'`, `booking_source 'payment_plan'`, `payment_plan_occurrence_id`, Stripe/Square handle per provider, `capture_status 'captured'` for card, `paid_at now()`) → live FIFO trigger allocates it; attempt → succeeded; `pp_settle_occurrence`; event |
| `pp_record_failure(p_attempt_id, p_status, p_provider_ref, p_decline_code, p_error_code, p_error_message, p_next_attempt_at)` | failed → occurrence `failed` (+ next_attempt_at); requires_action → `requires_action`; indeterminate → stays `processing` (recovery replays the same key); abandoned → occurrence back to `due` |
| `pp_settle_occurrence(p_occurrence_id) → occurrence` | amount_paid = Σ (amount − refund_amount) over linked payments with status ∈ Applied/Credit/Partial/Completed/Partial Refund/Refunded and not `requires_capture`, floor 0; status → paid / partially_paid / (refund) due; completes the plan when every occurrence is terminal |
| `pp_stale_attempts(p_older_than_seconds, p_as_of) → setof attempts` | claimed / in_flight / indeterminate, method ≠ checkout_link, older than the lease |
| `pp_record_event(p_event jsonb) → boolean` | insert … on conflict (dedupe_key) do nothing |
| `pp_pause_plan / pp_resume_plan / pp_cancel_plan(p_plan_id, p_actor, p_reason)` | cancel → every non-terminal occurrence `cancelled` |
| `pp_move_occurrence(p_occurrence_id, p_to date, p_actor)` · `pp_skip_occurrence(…)` (remaining rolls into the next open occurrence; refused on the last) · `pp_set_method(…)` · `pp_set_link_token(p_occurrence_id, p_token_hash)` · `pp_set_payment_method(p_plan_id, p_pm)` | operator/engine mutations, each with an event |

---

## 6. Occurrence state machine (enforced by a trigger)

```
scheduled → due | paid | partially_paid | skipped | superseded | cancelled
due       → processing | paid | partially_paid | requires_action | failed | skipped | superseded | cancelled
processing→ paid | partially_paid | failed | requires_action | due
requires_action → processing | paid | partially_paid | failed | due | skipped | superseded | cancelled
partially_paid  → processing | paid | failed | requires_action | due | skipped | superseded | cancelled
failed    → processing | due | paid | partially_paid | requires_action | skipped | superseded | cancelled
paid      → partially_paid | due            (refunds only)
skipped   → due                             (operator undo)
superseded, cancelled, waived: terminal
```
Any other transition raises. **Auto-charge eligibility** (D12): the occurrence
is `due`/`partially_paid` and no *card* attempt has been made on it yet (manual
records and never-sent links do not count), or it is `failed` with
`next_attempt_at ≤ now`. An occurrence re-opened by a refund is never
auto-charged, not even by the operator's Retry — it is collected by a link or a
manual record. `waived` is reserved: nothing reaches it in slice 1.

---

## 7. The engine (`engine.ts`, `runTick(deps, { asOf, tenantId?, planId? })`)

Pure orchestration over injected `PlanStore`, `PaymentProvider`, `Notifier`,
`LinkMinter` — the same code runs in the cron, in vitest, and in the browser
simulator.

1. **Recovery first.** `staleAttempts(600 s)`: `claimed` (provider never
   called) → `abandoned`; `in_flight`/`indeterminate` < 23 h old → **replay the
   same idempotency key with the same parameters**; older → look the charge up
   by metadata (`attempt_id`); found → `recordSuccess`, not found →
   `abandoned`. **Never a new key without a lookup.**
2. **Reminders.** For each open occurrence and each offset where
   `due_date + offset == plan-local today`: `recordEvent({kind:'reminder',
   dedupeKey:'reminder:{occ}:{offset}'})` — send only if it inserted.
3. **Due work** (`collectDue`), per method:
   - **auto_charge** (eligible per §6): `claim` → `markInFlight` → provider
     charge with the key → classify:
     | class | codes (research E2 B3) | action |
     |---|---|---|
     | succeeded | — | `recordSuccess`; if that throws → refund; refund ok → `failed` + event; refund fails → `indeterminate` + **pause plan** + alert. Never retry a path that could charge twice. |
     | needs_customer | authentication_required, authentication_not_handled, payment_intent_authentication_failure | `requires_action`; fallback link if enabled |
     | needs_new_card | expired_card, incorrect/invalid_number, lost/stolen/pickup/restricted_card, revocation_*, transaction_not_allowed, card_not_supported, currency_not_supported, pin_try_exceeded, payment_method_restricted | `failed`, no retry; fallback link |
     | retry_later | insufficient_funds, card_velocity_exceeded, withdrawal_count_limit_exceeded, card_decline_rate_limit_exceeded | `failed` + next_attempt_at = local(today + retryAfterDays) 10:00 while attempt_no < maxAttempts; else fallback link |
     | transient | processing_error, issuer_not_available, reenter_transaction, approve_with_id, lock_timeout, rate_limit | `failed` + next_attempt_at = +1 h, counted against maxAttempts, then fallback link |
     | opaque | do_not_honor, generic_decline, call_issuer, … | `failed`, no retry; fallback link |
     | integration_bug | billing_invalid_mandate, missing, livemode_mismatch, testmode_charges_only, payment_intent_unexpected_state, duplicate_transaction | `failed`, **pause plan**, alert (never a customer email) |
     | indeterminate | HTTP 5xx, timeout | `indeterminate`; recovery replays |
     | in_use | HTTP 409 idempotency_key_in_use | leave in_flight; back off |
     Lost/stolen/fraud codes are shown to operators and customers as a generic decline.
   - **checkout_link**: `claim` → `markInFlight` → mint token, `setLinkToken`,
     send the stable URL → `link_sent`. The webhook settles it.
   - **manual**: `occurrence_due` event + operator notification. Nothing is charged.

A plan that is not `active` is never collected.

---

## 8. Edge functions

- **`payment-plan-manage`** (JWT; head_admin / admin / manager with rentals
  editor; tenant must own the rental). `action`: `preview` (no writes; server
  fills the total from `pp_rental_owed_cents`), `create`, `update`
  (`expectedVersion`, `reason`), `pause`, `resume`, `cancel`,
  `occurrence_move`, `occurrence_skip`, `occurrence_set_method`,
  `occurrence_retry` (runs the engine for that one occurrence now),
  `occurrence_send_link` (→ url), `occurrence_record_payment` (operator
  manual entry: amount, method ∈ Cash/Bank Transfer/Zelle/Check/Card
  (external)/Other, date, note). **The browser never sends an amount the server
  charges** — amounts are re-derived server-side from the rule and the ledger;
  a manual record is the operator stating money they already received.
- **`run-payment-plans`** (cron, service-role auth, mirrors
  `accrue-payg-charges`' auth). No time-travel parameter in production.
- **`payment-plan-pay`** (`verify_jwt = false`, token-authenticated):
  sha256(token) → occurrence; mints or reuses a Checkout Session for the
  remaining amount (metadata `type=payment_plan`, `attempt_id`,
  `occurrence_id`; `setup_future_usage=off_session` when the plan
  auto-charges and has no saved card) → `{url}` or `{status:'paid'|'nothing_owed'}`.
- **Webhooks** (`stripe-webhook-live`, `stripe-webhook-test`):
  `checkout.session.completed` with `metadata.type === 'payment_plan'` →
  `pp_record_success` (idempotent on attempt) and, when a card was saved,
  `pp_set_payment_method`. **Additive branch only; no existing branch changes.**
- **Booking:** `apps/booking/src/app/pay/plan/[token]/page.tsx` — calls
  `payment-plan-pay`, redirects, or shows "Already paid — thank you".
- **Cron snippet** (not applied): `run-payment-plans` every 15 minutes.

---

## 9. UI (portal v2, canary `northwind` only)

Gate: `tenant.slug === 'northwind'` **and** the tables exist (a PostgREST
"relation does not exist" → the feature hides; nothing breaks before the
migration is applied).

- **Entry point:** on the canary, the create flow's four cards become three:
  *Fixed dates (pay in full)*, **Payment plan** (replaces PAYG + Installments —
  the fusion), *Auto-extend* (kept until slice 3). Existing rentals get **"Set
  up a payment plan"** on the v2 rental detail.
- **The one form** — a sentence the operator completes, not a plan-type menu:
  *Collect* [spread evenly · by days covered · fixed amount] *every*
  [rhythm chips: Weekly · Every 2 weeks · Twice a week · Monthly · Every N days
  · Pick dates] *on* [weekday(s) / day of month] *starting* [rental start ·
  a date] *until* [the rental ends · after N payments · a date] *by* [card
  auto-charge · emailed link · I'll record it]. Reminders: chips −2 / 0 / +2
  days. Beside it, **live preview**: a list and a month calendar of the
  generated dates with amounts and what each covers; the stub is labelled;
  dates can be moved in the preview. The total line must read "N payments ·
  $X total · rental balance $Y" and warns when they differ.
- **Plan card** on the rental: the math line — **Charged · Paid · Failed ·
  Remaining · Next** — then the occurrences table: #, due date, covers,
  amount, method, status (text colour, not pills — design system), provider id
  with a Stripe dashboard link via the existing payment-routing rules (a
  verified URL or a plain-English limitation, never a guessed URL), and row
  actions: Retry · Send link · Record payment · Move date · Skip. Missed
  occurrences show the recovery sentence: *"Missed on Fri 9 Oct — $200.00 is
  outstanding. Send a payment link · Record a payment · Retry the card."*
  Plan actions: Edit (smooth change, shows what changes), Pause/Resume,
  Cancel. Timeline from `payment_plan_events`.

---

## 10. The Developer-tab simulator (spec §9)

`components/dev/payment-plan-simulator.tsx`, a section of `/dev` (northwind).
Runs the **real engine** (`runTick`) in the browser against the memory store
and a simulated provider. **It writes nothing to the database** — the `/dev`
blast-radius sentence stays true.

- A scenario list (from `_shared/payment-plans/scenarios.ts`), each with its
  expected outcome; **Run** / **Run all** → pass/fail per assertion.
- A clock: "Advance a day", "to the next due date", "to the end".
- The real **plan card** rendered from the simulated state — the same
  component the rental page uses.
- **Download evidence** (JSON: every tick, event, attempt, key, payment).
- The vitest suite runs **the identical scenario list** — "however you test
  it, I can test it the same way."

### 10.1 Scenarios and their expected outcomes (hand-derived)

Base fixture unless stated: rental outstanding **60000**; plan weekly [Fri],
interval 1, anchor **2026-10-02** (Fri), on_anchor, count 3, split_total 60000
→ occurrences **10-02, 10-09, 10-16 × 20000**; timezone America/New_York,
10:00 local → due_at **14:00Z** (all EDT); method auto_charge, maxAttempts 3,
retryAfterDays 2, fallbackToLink true, reminders [−2, 0, 2], simulated
account `acct_sim`.

| id | script | expected |
|---|---|---|
| S1 happy | card always succeeds; tick at each due_at | 3 attempts, all succeeded, keys `pp:acct_sim:{occ}:1`; 3 payments × 20000; all occurrences paid; plan completed; owed 0 |
| S2 retry | occ1 attempt 1 → insufficient_funds; then success | at 10-02T14:00Z occ1 failed, next_attempt_at **10-04T14:00Z**; tick 10-03 → no provider call; tick 10-04T14:00Z → attempt 2 key `…:2` succeeded; occ1 has exactly 1 payment of 20000 |
| S3 SCA | occ1 → authentication_required | occ1 requires_action; attempt 2 method checkout_link in_flight; events fallback_to_link + link_sent; link paid → occ1 paid, 1 payment, **0 further card calls** for occ1 |
| S4 dead card | occ1 → expired_card | occ1 failed, next_attempt_at null; link sent; operator records 20000 Cash → occ1 paid |
| S5 indeterminate | occ1 charge returns 5xx **after** the provider has charged | occ1 processing; next tick recovery replays key `…:1` → same provider ref → recordSuccess once; provider holds **1** charge for occ1; 1 payment row |
| S6 in use | occ1 → 409 once | attempt stays in_flight; next tick recovery → succeeded; 1 payment |
| S7 double webhook | occ1 link paid; webhook delivered twice | 1 payment row; occ1 paid |
| S8 manual | method manual | 10-02T14:00Z occ1 due + occurrence_due event; 0 provider calls; operator records 20000 → paid |
| S9 early payment | after occ1 paid, customer pays 40000 outside the plan on 10-05 | occ2 and occ3 → skipped + covered_by_balance; 0 provider calls for them; plan completed |
| S10 partial | 10-01 operator records 5000 on occ1 | occ1 partially_paid (5000); 10-02 charge amount **15000**; occ1 paid |
| S11 skip | 10-05 operator skips occ2 | occ2 skipped; occ3 amount **40000**; charged 40000 on 10-16; total collected 60000 |
| S12 move | 10-05 move occ2 to 10-12 | no charge for occ2 at 10-09T14:00Z; charged at **10-12T14:00Z** |
| S13 plan change | after occ1 paid, change to every 2 weeks [Fri], anchor 10-16, count 2 | occ2, occ3 superseded; new seq 4 (10-16) and 5 (10-30) × 20000; version 2; one revision row; both charged |
| S14 refund | occ1 paid, then 20000 refunded | occ1 back to due, attempt_no 1; **no provider call on any later tick for occ1** |
| S15 month-end | monthly day 31, anchor 2027-01-31, count 3, split 90000 | charged 2027-01-31T15:00Z, 02-28T15:00Z, 03-31T14:00Z × 30000 |
| S16 pause | pause 10-05, resume 10-12 | no charge at 10-09; occ2 charged at the first tick after resume |
| S17 reminders | method manual; ticks twice each day 09-30 → 10-06 | reminder events: occ1 on 09-30 (−2), 10-02 (0), 10-04 (+2, if unpaid) — each **once** despite two ticks a day |
| S18 exhausted | insufficient_funds every time | attempts 1, 2, 3 at 10-02, 10-04, 10-06 14:00Z; then occ1 failed, next_attempt_at null, fallback link sent |

---

## 11. Evidence

- **Golden tests** (§3.1) — `tests/payment-plans/`.
- **SQL suite on real Postgres** — PGlite (`@electric-sql/pglite`, Postgres
  compiled to WASM, runs in Node, no network, no production). Loads the live
  schema fixture, the live FIFO/trigger bodies, then both migrations; proves
  the constraints, the state machine, the claim, the one-transaction success
  path, the owed cap, the FIFO fixes and the drift view.
- **Scenario suite** — §10.1 against the memory store **and** against a PGlite
  store (the same SQL functions) — the memory store is only trusted because the
  two agree.
- **Sync test** — the portal mirror is byte-identical to the canonical files.
- **Browser** — the same scenarios in `/dev`.
- Run: `npm run test:spine` (root) and `cd apps/portal && npx vitest run`.

---

## 12. File ownership (slice 1 build)

| agent | owns |
|---|---|
| **Engine** | `supabase/functions/_shared/payment-plans/{schedule,amounts,dates,engine,classify,memory-store,providers}.ts` · `supabase/functions/_shared/payment-plans-deno/**` (Supabase store, Stripe provider, notifier) · `supabase/functions/{payment-plan-manage,run-payment-plans,payment-plan-pay}/**` · webhook branches · `supabase/config.toml` entries · `apps/booking/src/app/pay/plan/**` · `scripts/sync-payment-plans.mjs` · the portal mirror + its sync test |
| **Database & evidence** | both migrations · `tests/payment-plans/**` · `tests/vitest.config.ts` include · root devDependency `@electric-sql/pglite` · `supabase/functions/_shared/payment-plans/scenarios.ts` (scripts + expected outcomes, from §10.1) |
| **UI** | `apps/portal/src/components/payment-plans/**` · `hooks/use-payment-plan*.ts` · `lib/payment-plans-ui/**` · the rentals-v2 entry points · `components/dev/payment-plan-simulator.tsx` + its `/dev` section · TRAX catalogue/docs · portal tests |
| **Lead (me)** | `types.ts`, this document, commits |

`types.ts` may be extended **additively** by the Engine agent (new optional
fields or store methods), reported in its hand-back. Nobody edits
`apps/portal/src/lib/payment-plans/` by hand — it is generated.

---

## 12a. Revisions after the build (Sep 25 2026)

Found while building; the code follows these, and so does this document now.

- **Claims.** Only an `auto_charge` claim moves the occurrence to
  `processing`. A manual claim may take a `scheduled` occurrence (an early
  payment). `pp_collect_due` also returns `partially_paid` rows.
- **Refunds re-settle in production** through a trigger on `payments`
  (refund amount or status changes on a row linked to an occurrence) — without
  it the webhook's refund path left the occurrence `paid`.
- **Manual records keep who and why:** `pp_record_success` takes the note and
  the actor.
- **Auth.** `run-payment-plans` accepts the platform secret (read from
  `private.platform_config`, never a literal in `cron.job`) or a super-admin
  JWT — not the service-role bearer. `payment-plan-manage` also refuses tenants
  outside `PAYMENT_PLANS_TENANT_SLUGS` (default `northwind`) server-side.
- **Square tenants are manual-only** in slice 1 (card and link refused at
  creation).
- **Cards.** The tenant's current platform account is charged and the Stripe
  customer is resolved at charge time; a card saved on the other platform
  account fails as "needs a new card" → link. Until a plan Checkout saves a
  card, the customer's default card is used.
- **Links.** Every reminder or re-send mints a fresh token, so an older
  email's link stops working and the page says so. Plan sessions never set
  `client_reference_id`, because the existing expiry branch would cancel the
  rental.
- **Webhook failures that a retry cannot fix** (unknown attempt, invalid
  record) raise an operator alert and return 200, so they do not burn the
  endpoint's auto-disable budget.
- **Known follow-ups:** the existing `payment_intent.payment_failed` branch
  also rings an operator bell for a plan charge (two bells for one failure);
  `payment_intent.succeeded` flips plan payment rows `Completed → Applied`
  (harmless: settle counts both).

## 13. Not in slice 1 (and why)

Finances tab merge (§7) · customer balance adjustments + off-platform credit
(§8, needs the lead's revenue decision) · auto-extension and manual extension
on the engine (§6, D1 staged) · open-ended plans that post charges (D9) ·
Square collection (provider interface is ready; Square needs its own ≤45-char
key) · customer self-serve plans (D10) · the drift repair (per-row sign-off).

## 14. Questions for Ghulam

1. Twice a week = two named weekdays (D2) — yes?
2. Off-platform credit: does it count toward the tenant's revenue? (Under our
   P&L that is the same as "does it create a payments row".)
3. Every auto-charge is a merchant-initiated transaction: **we carry fraud
   liability** on it (no 3DS liability shift). Accept for all tenants?
4. Stripe dashboard deep links work for tenants on their own (Standard)
   Stripe account; for Drive247-managed Express accounts Stripe has no
   per-payment URL — we show the reference and a plain-English route instead.
   Acceptable?
