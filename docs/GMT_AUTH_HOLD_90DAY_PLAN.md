# GMT 90-Day Deposit Hold — Authoritative Engineering Plan

**Tenant:** Global Motion Transport (GMT), `ada84c6f-eb17-43b6-a14d-d16518165349`, slug `globalmotiontransport`, US, live Connect `acct_1SrIFEPcUIaEGCY0`
**Repo root:** `/home/haseeb-raza/Desktop/drive-247`
**Stripe API version pinned:** `2023-10-16` (`supabase/functions/_shared/stripe-client.ts:22`, `:313`)

---

# 1. What is actually going on (the diagnosis)

## 1.1 A deposit hold is not a deposit

Drive247 does not charge GMT's renters a security deposit. It places a **card authorization** — a manual-capture Stripe PaymentIntent (`capture_method: "manual"`, `place-deposit-hold/index.ts:261`) that reserves funds on the renter's card without moving them. The money is ringfenced by the issuer, not held by GMT. Two consequences follow and they drive everything below:

1. **An authorization has an expiry clock set by the card network, not by us.** When it expires the issuer releases the funds and Stripe transitions the PaymentIntent to `canceled`. Nothing in this codebase listens for that.
2. **The DB row is a claim, not a fact.** `rentals.deposit_hold_status = 'held'` is our assertion. Stripe is the only source of truth, and today nothing reconciles the two.

## 1.2 Why GMT's holds die

Three independent mechanisms, in order of how much damage they do.

**(a) The base window is ~7 days, possibly ~4d18h.** The repo comment at `_shared/stripe-client.ts:173-176` asserts that `acct_1SrIFEPcUIaEGCY0` throws `"This account is not eligible for the requested card features."` when premium card features are requested, so GMT falls to the network default. Both hold paths confirm with `off_session: true` (`place-deposit-hold/index.ts:263`, `refresh-deposit-holds/index.ts:175`). Stripe's card-not-present table gives Visa **merchant-initiated** transactions 5 days ("exactly 4 days and 18 hours") versus 7 days customer-initiated; Mastercard/Amex/Discover are 7 days for both. Stripe warns classification uses "signals of cardholder participation, not solely on API parameters like `off_session`", so the real window is **UNVERIFIED for GMT** and must be measured from `capture_before`.

**(b) The refresh cron destroys the hold before it has a replacement, and one failure is permanent.** `refresh-deposit-holds/index.ts` cancels the live PaymentIntent (verified, in the "Step 1: Cancel the old hold" block) *before* creating the replacement via `createDepositHoldIntentWithFallback`. Every throw between those points — hard decline, SCA, transient Stripe 5xx, rate limit, a missing `tenants` row, a `getConnectAccountId` throw that happens **before Stripe is ever called** — lands in one catch that writes `deposit_hold_status: "expired"`. That state is terminal: the driver query filters `.eq("deposit_hold_status", "held")`, so the row is never selected again. No retry, no backoff, no decline-code branching, and zero notification anywhere in the file.

**(c) The primary hold path silently forfeits extended authorization.** `place-deposit-hold/index.ts:279-322` hand-rolls a **two-rung** fallback: attempt 1 sends `DEPOSIT_HOLD_CARD_OPTIONS` (extended auth **and** multicapture, `stripe-client.ts:165-168`); on the ineligibility string (`:293`) attempt 2 sends bare `basePayload` (`:300`) which contains **no `payment_method_options` block at all** (`:256-273`). The `{ request_extended_authorization: 'if_available' }`-only middle rung defined at `stripe-client.ts:187` is never attempted. Every other hold path uses `createDepositHoldIntentWithFallback` (`stripe-client.ts:205-232`), which walks all three rungs. So if GMT is ineligible only for **multicapture** — plausible, since Stripe's multicapture docs state some networks "don't permit multicapture for installment or deposit workflows" — then GMT is entitled to ~30-day holds today and this one code path is throwing them away at every key handover. The log line at `:295` even asserts `"Multicapture not granted on this account"`, an attribution the code cannot support because the failing request asked for both.

## 1.3 The hard ceiling — is a single 90-day authorization possible?

**No. Definitively no, on every network, at any price, with any Stripe configuration or support outcome.**

- Stripe: "extended validity periods can go up to 30 days depending on the card network"; "The exact extended authorization window for Visa is 29 days and 18 hours, to allow time for clearing processes." (`docs.stripe.com/payments/extended-authorization`)
- Visa's own merchant guide caps Lodging/Vehicle Rental/Cruise Line **estimated** authorizations at "30 days from day of estimated authorization approval", and instructs: "In the case of extended stays, cruises or rentals, authorizations requiring longer than the maximum validity period of the original estimated authorization **need to be reversed and a new authorization must be requested**."
- Incremental authorization cannot help: Stripe — "incremental authorizations don't extend the validity period"; Visa — "Do incremental authorizations extend authorization validity timeframes? No."
- Multicapture does not extend it either; the PaymentIntent leaves `requires_capture` when "The authorization window expires."

The only 30-day-by-default exception in any source is JPY on Japan-based accounts — irrelevant to GMT.

**Therefore "90 days" means N consecutive cancel-and-recreate cycles.** At today's ~7-day window that is 13–18 cycles per rental; at 30 days it is 3–4. Every cycle is an independent chance to lose the deposit. **The reliability of the cycle, not the duration of a single hold, is the engineering problem.**

## 1.4 A compliance fact that may void the whole duration strategy

Stripe's own compliance callout on the extended-authorization page: "for many networks extended validity windows are only for cases where you **don't know the final amount** that you'll capture at the time of authorization." Visa is blunter: an estimated authorization "must not contain incidental spend amounts such as tips or **a buffer for damage**." GMT's hold is a fixed, known damage buffer. Whether extended authorization is a permitted use for it is **UNVERIFIED** and is the first question in the Stripe ticket (§7). If Stripe says no, the entire duration workstream is void and the plan collapses to reliability plus card-on-file.

---

# 2. Verdict on the team lead's four ideas

| # | Idea | Verdict | Evidence | What to actually do |
|---|---|---|---|---|
| 1 | Stripe **configuration** change to lengthen the hold | **Impossible as stated. Partially useful.** Ceiling is 30 days / Visa 29d18h. | `docs.stripe.com/payments/extended-authorization`; Visa merchant guide 30-day cap | There is no self-serve toggle. Two config levers exist and are free: (a) fix `place-deposit-hold`'s two-rung fallback so the extended-auth-only rung is actually tried (**W3**); (b) set `business_profile.mcc = 7512` on the connected account — `create-connected-account/index.ts:73` never sets an MCC, so Stripe auto-assigned one, and MCC gates Amex/Discover extended auth entirely and Visa's fee/CIT footnote (**W3**). |
| 2 | Stripe **support ticket** | **Partially works. Best case 30 days, not 90.** | Extended auth, multicapture and incremental auth are each documented as IC+-pricing features with "contact us using the form at Stripe support" as the only remedy | File it (**§7**) — in parallel, blocking nothing. Lead with the fixed-amount-deposit compliance question (§1.4), because a "no" there voids the ask. Also ask whose pricing plan governs a Connect **direct** charge — `place-deposit-hold/index.ts` passes only `{ stripeAccount }` with no `transfer_data`/`on_behalf_of`/`application_fee_amount`, and Stripe's docs never say whether platform or connected-account IC+ status is evaluated (**UNVERIFIED**). If it's the platform, one move fixes all 28 tenants. |
| 3 | Application-level **refresh cron** | **Works, and is mandatory.** It is also the network-prescribed pattern, and it is currently the most dangerous code in the deposit system. | Visa: "need to be reversed and a new authorization must be requested"; defects in `refresh-deposit-holds/index.ts` per §4 | Keep it. Do **not** extend it before hardening it: non-terminal failures, in-invocation retry with fresh PM resolution, decline-code triage, alerting, currency stamping, idempotency keys that vary per attempt (**W2**). Add a separate reconciler that treats Stripe as truth (**W6**). |
| 4 | Direct **charge the saved card** | **Works today, technically. The button just doesn't exist.** | Off-session charging is in production at `process-installment-payment/index.ts` and `auto-extend-rentals/index.ts:562-567`; `setup_future_usage: 'off_session'` is set on every checkout path | Build it (**W4**). Note the portal button labelled "Charge via Stripe" (`add-payment-dialog.tsx:1055`) does **not** charge — it opens a Checkout URL (`:620`). This is needed in *every* scenario: it is how you collect a `deduct-from-deposit` shortfall, and how you collect damage after a hold has expired. Gate damage charges on a persisted mandate (**W5**) — this is a legal prerequisite, not paperwork. |

---

# 3. The plan

Ordered by ship date. **Nothing is blocked on Stripe.** The Stripe ticket runs in parallel and only changes cycle *count*.

## Cross-cutting rollout rule (adopt before W2)

All three candidate designs edit `place-deposit-hold` and `refresh-deposit-holds` — the two functions that move real money for **28 tenants**. `PER_VEHICLE_DEPOSIT_TENANT_IDS` (`place-deposit-hold/index.ts:120-122`) scopes the deposit *amount*, not behaviour, so "GMT-only" is nowhere enforced.

**Rule:** every behavioural change in W2–W3 lands behind a module-level allowlist mirroring the existing pattern:

```ts
const DEPOSIT_V2_TENANTS = new Set(["ada84c6f-eb17-43b6-a14d-d16518165349"]);
```

Non-allowlisted tenants take today's code path byte-for-byte. Delete the flag after two clean weeks. **Never deploy `place-deposit-hold` and `refresh-deposit-holds` in the same release** — they are the two ends of the lifecycle; if a deposit dies you must be able to name which one killed it.

---

## W0 — Verify five facts before writing behavioural code

**Ship: today. Effort: hours. Blocked on: nothing. Code changes: none.**

**Goal:** three of these change the plan; two change the ticket.

| Fact | How | Why it matters |
|---|---|---|
| Is the pg_cron job live? | `select jobid, jobname, schedule, active from cron.job where jobname ilike '%deposit%'` on `hviqoaokxvlancmftwuo`; then `cron.job_run_details` for the last 30 days; cross-check edge logs for `[DEPOSIT-REFRESH] Complete. Refreshed:` | Its **only** evidence is `supabase/functions/sim-control/cron-manifest.json:8` (`"0 3 * * *"`, `authType: "none"`). **No migration schedules it.** This exact job was silently never scheduled once before — commit `9ab190f2` (2026-06-15): "the refresh-deposit-holds function was never scheduled … First seen on Global Motion Transport (5 dead holds)." If it is not live, the diagnosis changes from "our refresh is fragile" to "we have never refreshed anything." Note `job_run_details.status='succeeded'` only means pg_net dispatched. |
| The real window | On a live GMT hold charge read `payment_method_details.card.capture_before` **and** `payment_method_details.card.extended_authorization.status` (`enabled`/`disabled`) | Distinguishes ~30d / ~7d / ~4d18h. The 4d18h case makes the 2-day lookahead in `refresh-deposit-holds` too narrow. |
| Which feature is refused | Two throwaway manual-capture PIs on `acct_1SrIFEPcUIaEGCY0`: one with `request_extended_authorization` alone, one with `request_multicapture` alone | Nothing in this repo has ever tested them in isolation — every path requests both, and the error string cannot distinguish. Decides whether W3's ladder fix pays off. |
| Damage histogram | `select deposit_hold_status, count(*) from rentals where tenant_id='ada84c6f-…' group by 1`; plus `held` with past expiry; `held` with NULL `deposit_hold_expires_at`; rows stuck in `refreshing`/`processing` | Sizes the backfill for W1. NULL-expiry rows are invisible forever because `.lt()` against NULL yields NULL, not true. |
| Any GMT rental with `auto_extend_enabled = true`? | one query | If yes, the cron **releases** their deposit (`refresh-deposit-holds`, the `isLongRunning` branch) — and does so *after* the unconditional cancel, so the money is already gone when that branch evaluates. Also `place-deposit-hold:48-51`, `create-hold-checkout:47-49`, `create-checkout-session:156-158` all refuse. No engine improvement reaches those rentals. |

Also read `tenants.email_notifications_enabled` for GMT — the operator-email trigger returns early without it (`supabase/migrations/20260718050300_add_operator_email_dispatch_trigger.sql:41-46`), and that migration's own comment says the switch is off for "~all tenants."

**Verify:** all five answers written down before W2 starts.

---

## W1 — Alerting and the backfill sweep

**Ship: day 1–2. Effort: 1 day. Blocked on: W0 (histogram). Strictly additive — cannot lose money.**

**Goal:** make silent deposit loss impossible, and establish the baseline that proves whether later changes help.

**Why first:** it is the only change that cannot make things worse, and right now nobody can tell whether any subsequent change improved anything.

**Files:**
- `supabase/functions/refresh-deposit-holds/index.ts` — call `notifyOperatorsInApp` in the per-rental catch and on any write of a failure state
- `supabase/functions/sandbox-refresh-deposit-holds/index.ts` — mirror
- `supabase/functions/_shared/notify-inapp.ts` — no change, use as-is

**What changes:** `notifyOperatorsInApp({ tenantId, type: "payment_failed", title, message, link: '/rentals/'+id, dedupeKey })`. Verified suitable: the params interface is at `_shared/notify-inapp.ts:38-56`, `type` is a free-form string (`:42`), it supports `dedupeKey` for cron retries (`:51-55`), and its contract is that it never throws — safe inside a money-path catch. `payment_failed` is on the operator-email trigger allowlist (`20260718050300_…sql:32-37`) and maps to the `payments` category in `notify-operator-email/index.ts:30`, so **bell plus email arrive with zero DDL**.

**Known v1 compromise, state it explicitly:** a deposit-hold failure surfacing to GMT staff as "payment failed" will send them hunting for a missing rent payment. Minting `deposit_hold_failed` requires editing the trigger allowlist (DDL, via Supabase MCP) and `CATEGORY_BY_TYPE`. Ship on `payment_failed`; raise the dedicated type as a fast-follow.

**Backfill first, alerting second.** Run a one-off reconciliation sweep over the accumulated `expired` / stuck-`refreshing` / `held`-with-past-expiry rows **before** enabling alerting, or day one is an alert storm, the channel gets muted, and the alerting is worthless.

**Add a daily 08:00 heartbeat digest** of GMT's hold book (count by status, holds expiring in 72h). Absence of alerts must not be indistinguishable from a dead cron.

**Do not build on `reminders-generate` / `reminders-digest`.** `reminders-digest/index.ts:111-112` is a literal `// TODO: Send email using Resend or similar service` followed by a `console.log`. `reminders-generate` has one caller inside a hook nothing calls. Dead code.

**Verify:** force a failure in the sandbox (see W-Test), confirm a bell within 30s (`use-notifications.ts:50` polls at 30000ms) and, if `email_notifications_enabled` is true, an email.

---

## W2 — Make refresh failure non-terminal

**Ship: week 1. Effort: multi-day. Blocked on: W0, W1. Behind `DEPOSIT_V2_TENANTS`.**

**Goal:** one bad night stops destroying a deposit for the rest of the rental.

**DB (apply via Supabase MCP per the standing project rule — do NOT write files into `supabase/migrations/`):**

```sql
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_deposit_hold_status_check;
ALTER TABLE rentals ADD CONSTRAINT rentals_deposit_hold_status_check
  CHECK (deposit_hold_status = ANY (ARRAY[
    'processing','held','captured','released','expired','refreshing','failed',
    'retrying','action_required'
  ]));

ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_refresh_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_hold_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_last_error_code text,
  ADD COLUMN IF NOT EXISTS deposit_hold_last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_currency text,
  ADD COLUMN IF NOT EXISTS deposit_hold_extended_auth text,
  ADD COLUMN IF NOT EXISTS deposit_hold_prev_payment_intent_id text;
```

The existing 7-value CHECK is at `supabase/migrations/20260527010000_expand_deposit_hold_status_values.sql:11-15`. **If any new column is ever read by the booking site's anon tenant query, it needs `GRANT SELECT … TO anon`** — per prior incident, a missing column grant 403s the whole `tenants` query and every booking site falls back to default branding. (These are `rentals` columns, so this is a caution for W7's `tenants` columns, not these.)

**Changes to `supabase/functions/refresh-deposit-holds/index.ts`:**

1. **In-invocation retry, 2 extra attempts with short backoff**, before any status write. On attempt 2, re-resolve the payment method *fresh* — `customers.retrieve` with `expand: ["invoice_settings.default_payment_method"]` then `paymentMethods.list` fallback, exactly as `place-deposit-hold/index.ts:170-195` already does. Today the refresh reuses `rental.deposit_hold_payment_method_id` verbatim and **nothing anywhere updates that column when a customer changes their card** — `update-payment-method` writes only `invoice_settings.default_payment_method` and `installment_plans.stripe_payment_method_id`. On a 90-day rental that guarantees eventual failure.

2. **Vary the idempotency key per attempt.** Today it is `deposit-refresh-${rental.id}-${rental.deposit_hold_payment_intent_id ?? "new"}` and the failure path never updates `deposit_hold_payment_intent_id`, so **any retry within 24h replays Stripe's cached decline verbatim** — Stripe saves "the resulting status code and body of the first request … regardless of whether it succeeds or fails," retained 24h. Append `-a${attempts}`. This bug is invisible in staging (fresh fixture per run ⇒ always a new key) and silent in prod. **This must have a unit test.**

3. **Decline triage**, branching on `err.code` / `err.decline_code` / `outcome.advice_code`. Copy the detection idiom from `process-installment-payment/index.ts:199-200` — the only place in the repo that detects `authentication_required`.

| Class | Codes | Action |
|---|---|---|
| Transient | `processing_error`, `issuer_not_available`, `reenter_transaction`, `approve_with_id`, `rate_limit`, `lock_timeout`, any 5xx/network, `advice_code: try_again_later` | `retrying`, backoff 5m/30m/2h/6h/24h |
| Funds | `insufficient_funds`, `withdrawal_count_limit_exceeded`, `card_velocity_exceeded` | `retrying` on 12h/24h; notify customer after attempt 2 |
| SCA | `authentication_required` | `action_required` immediately — Stripe: "notify your customer to return to your application". No server-side fix exists. |
| Dead card | `expired_card`, `lost_card`, `stolen_card`, `pickup_card`, `resource_missing`, `advice_code: do_not_try_again` | Re-resolve the PM once; if that also fails → `action_required` |
| Unknown | — | `retrying` ×2, then `action_required` |

Cap total attempts at **8** — Stripe: "We recommend a maximum of eight retries … Card issuers might see creating additional retries as potential fraud."

4. **`expired` is written only when Stripe confirms the authorization is gone** (W6), never as a synonym for "our code threw." Note two throws happen **before Stripe is contacted** — the `tenants` lookup and `getConnectAccountId` — and because the tenant cache re-fetches on a falsy value, one transient `tenants` read failure currently marks *every* held deposit for that tenant `expired` in one pass. Guard those explicitly.

5. **Driver query:** select `deposit_hold_status IN ('held','retrying')` AND (`deposit_hold_next_attempt_at IS NULL OR <= now()`); treat `deposit_hold_expires_at IS NULL` as due-now; widen `status` to `IN ('Active','Pending')` (real domain is `Pending|Active|Closed|Rejected|Cancelled`, `20251219083413_remote_schema.sql:5021`; the portal creates rentals as `Pending` and three writers set `held` with no status guard); add `.limit()` + cursor — the loop is serial with no bound and Supabase edge functions die at 150s idle / 400s wall clock, and a mid-loop kill currently strands rentals in `refreshing`.

6. **Compare-and-set on every write.** The `refreshing` write and the final write both lack a prior-status guard and both discard their `{ error }` return (supabase-js resolves rather than throws). A discarded final-write error strands the rental in `refreshing` with a live untracked PaymentIntent. Also: `place-deposit-hold`'s busy-set covers only `held` and `processing`, so it will happily claim a rental sitting at `refreshing` → two live holds.

7. **Move the `auto_extend_enabled` release branch above the cancel.** Today it evaluates after the cancel, so "release instead of refresh" actually means "destroy, then record that we released." One-line move, not a policy change.

8. **Stamp currency at placement, read it on refresh.** The refresh reads `currency_code` from the **current** `tenants` row while correctly anchoring the platform to `rentals.platform_account`. A tenant whose `currency_code` changes mid-rental — **which is exactly what a UK→UAE migration does** — produces a replacement hold in a new currency on the old platform account against a card saved in the old currency. Guaranteed failure → today, terminal `expired`. Write `deposit_hold_currency` in `place-deposit-hold` and read it in `refresh-deposit-holds`.

**Explicit decision — we are NOT reordering cancel/create.** Design 2 proposed creating the replacement before cancelling the incumbent. Rejected, for three reasons: (i) Visa's wording is reverse-first ("need to be reversed and a new authorization must be requested"); (ii) it creates a **new** failure mode nobody modelled — two simultaneous $1,500 authorizations on the same card means a card near its limit returns `insufficient_funds`, i.e. the replacement fails *because* the old hold is holding the funds, which is the likely path for a gig driver, not an edge case; (iii) it worsens debit stacking (§5). In-invocation retry recovers transient failures in seconds and next-run retry recovers the rest within 24h, delivering most of the benefit with none of the new risk. Reordering stays a gated experiment — run the double-authorization test in W-Test first.

**Mirror everything into `supabase/functions/sandbox-refresh-deposit-holds/index.ts`** or staging stops modelling production.

**Verify:** sandbox fixture forced through decline, SCA and transient paths; assert status transitions and that the idempotency key differs between attempts.

---

## W3 — The free duration probe: ladder, MCC, expiry truth

**Ship: week 1, separate release from W2. Effort: 1 day. Blocked on: W0 (feature probe). Behind `DEPOSIT_V2_TENANTS`.**

**Goal:** find out whether GMT is already entitled to 30-day holds, and stop the DB lying about expiry.

**Files:** `supabase/functions/place-deposit-hold/index.ts`, `supabase/functions/_shared/stripe-client.ts`, `supabase/functions/create-connected-account/index.ts`

1. **Delete the hand-rolled fallback** at `place-deposit-hold/index.ts:279-322` and call `createDepositHoldIntentWithFallback(stripe, basePayload, requestOpts)` — the same helper `refresh-deposit-holds`, `capture-deposit-hold`, `create-hold-checkout` and `create-preauth-checkout` already use. Keep the `-recollect-{status}` `idemSuffix` (`:276`) and keep the `'processing'`-claim rollback in the catch (`:307-311`, `:315-319`). Net ≈ 35 lines deleted. **Watch the key collision:** the helper suffixes downgraded attempts `-cf1`/`-cf2` (`stripe-client.ts:216-218`), whereas the old path used `-no-mc` — a rental that already burned `-no-mc` will now issue a distinct key, which is correct but means one extra Stripe request for in-flight rentals.

2. **Add a 4th ladder rung.** `DEPOSIT_HOLD_CARD_VARIANTS` (`stripe-client.ts:185-189`) never tests multicapture alone. Make it `[{ext,mc}, {ext}, {mc}, null]`. **Frame this honestly: it is a probe with unknown payoff**, not a fix. If GMT is ineligible for both features it delivers zero duration.

3. **Consider dropping `request_multicapture` from the deposit path entirely.** It confers zero duration benefit; Stripe's docs warn some networks "don't permit multicapture for installment or deposit workflows"; it disables Stripe's platform pricing tools on those payments; and it is a live candidate for the very error GMT hits. Before deleting, confirm `capture-deposit-hold`'s runtime multicapture branch — it is already unreachable from the UI (`charge-deposit-dialog.tsx:135` always sends the full hold amount, so remainder is 0).

4. **Persist the granted window.** `resolveHoldExpiry` (`stripe-client.ts:247-272`) reads `capture_before` at `:260-262` and throws away `payment_method_details.card.extended_authorization.status`. Return it and write it to `deposit_hold_extended_auth`. Without this the DB can never answer "did this hold get 30 days or 7?" and you cannot prove a Stripe grant landed.

5. **Fix the silent fallback.** When the charge retrieves fine but `capture_before` is simply absent, `:260-263` falls through to the `+7d` fallback at `:268-271` with **no warning** — the `console.warn` at `:265` lives only in the `catch`. Log both paths, and tighten the fallback from 7 days to **4**. An under-estimate costs one harmless early refresh; an over-estimate produces a DB row that outlives the real authorization, which the 2-day lookahead then never examines in time.

6. **MCC.** `create-connected-account/index.ts:73` sets only `type: 'express'` — no `business_profile.mcc` anywhere in the repo. If W0 shows a non-vehicle-rental MCC, `stripe.accounts.update('acct_1SrIFEPcUIaEGCY0', { business_profile: { mcc: '7512' } })`, and patch account creation so the remaining 27 tenants don't inherit an auto-assigned code. Stripe explicitly instructs Connect platforms to "set the merchant category code for your connected accounts to match their businesses." Caveat: Stripe must verify it fits the industry, and an MCC Stripe itself assigned during review cannot be changed by the platform.

**Verify:** place a hold in test mode against the shared test Connect account with `pm_card_credit_disableEnterpriseCardFeatures`; assert all rungs attempted and `deposit_hold_extended_auth` persisted.

---

## W4 — `charge-saved-card`: the button the team lead asked for

**Ship: week 2. Effort: 1–2 days. Blocked on: nothing (damage-category use blocked on W5).**

**Goal:** collect money without emailing a link. Needed in **every** scenario — deduct shortfalls, post-expiry damage, and the whole card-on-file model if W7 goes that way.

**New file:** `supabase/functions/charge-saved-card/index.ts`, plus `supabase/config.toml` registration (leave `verify_jwt` at the default `true`).

**Shape** (cloned from `process-installment-payment/index.ts:143-162`):
- Resolve the platform **record-anchored** (`getStripeClientForRecord(rental, mode)` + `rentals.platform_account`), never from the tenant's current `payment_model`
- Read `customers.stripe_customer_id` **through `validateStripeCustomerId`** (`stripe-client.ts:418-440`) — `place-deposit-hold` notoriously skips this, which is how the Kedic go-live incident happened
- `paymentIntents.create({ amount, currency, customer, payment_method, off_session: true, confirm: true })`, idempotency key `charge-saved-card-{rentalId}-{clientRequestId}`
- Insert a `payments` row with `booking_source: 'admin'` — **verified valid**: `payments_booking_source_check` allows exactly `admin` and `website` (`20251219083413_remote_schema.sql:4669`). `'auto_extend'` is rejected, per prior incident.
- Branch on `authentication_required` and return a distinct code so the UI falls back to emailing a link rather than reporting a generic failure
- Require an operator-entered reason; write an audit row; RBAC-gate to `head_admin`/`admin` (not `viewer`, not unscoped `manager`)

**UI:** `apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx` — add "Charge saved card" beside `handleStripePayment` (`:565`), enabled only when a card is on file. **Rename the existing "Charge via Stripe" button (`:1055`) to "Send payment link"** — it opens a Checkout URL (`:620`) and does not charge. `AddPaymentDialog` is instantiated five times on the rental page (`:5788`, `:5808`, `:5836`, `:5899`, `:5959`), so one change lights up every collection surface.

**Verify:** test-mode charge against `pm_card_visa`; SCA path against `pm_card_authenticationRequired`; assert the `payments` row settles against the right ledger charge.

---

## W5 — Stored-credential mandate and agreement disclosure

**Ship: week 2–3. Effort: multi-day. Blocked on: legal sign-off, not code. Blocks damage-category use of W4.**

**Goal:** make repeated re-authorization and any card-on-file damage charge defensible.

The current template describes something we do not do. `apps/portal/src/lib/default-agreement-template.ts:337` promises a hold "placed on the Renter's card at the start of the rental period and released after the vehicle is returned in acceptable condition" — a single static hold, not a cancel-and-replace series run 3–18 times. `:219` (extension template) is similarly silent. **This gap, not the hold duration, is the real deception exposure**, and it is sharper in Texas and Florida which have no rental-deposit statute and fall back to DTPA/FDUTPA where disclosure quality is the whole case.

**Required by card-network rule, not invented:** Visa's Stored Credential Transaction Framework requires disclosing "the frequency (recurring) or event (unscheduled) that will prompt the transaction"; Stripe restates it — "the anticipated timing and frequency of payments; how you determine the payment amount; … Keep a record of each customer's agreement to your terms."

**Changes:**
- Rewrite `default-agreement-template.ts:337` and `:219` into a standalone authorization block: a hold is not a charge; it will be released and re-placed as often as required by card-network rules and at least monthly for the life of the rental; two pending items may briefly overlap; on debit cards the bank may take days to release the superseded one; the card may be charged for damage with itemised evidence. **Write to the mechanism, never to a number** — do not put "30 days" in customer-facing text, since the granted window varies by network and MCC.
- Persist consent: new `rental_card_mandates` table (`rental_id`, `customer_id`, `tenant_id`, `payment_method_id`, `mandate_version`, `accepted_at`, `source`), written when `boldsign-webhook` receives the signed agreement. Gate `charge-saved-card` on a mandate row for damage-category charges.

**Two statutory constraints, both scoped by rental length:**
- California Civ. Code §1939.15(a) forbids "causing a debit or block to be placed on the renter's credit card account" to recover damage without express permission granted **after** the damage. So `deduct-from-deposit` must never fire unilaterally for damage — operator reason + renter notification, always.
- New York GBL §396-z(7) flatly bans card deposits for damage on agreements "not to exceed thirty continuous days."
- **Both are scoped to short rentals** (CA §1939.01 "less than 30 days"), so a genuine 90-day agreement sits outside them — **which is exactly why GMT must NOT paper long rentals as chained ≤30-day extensions.** The chaining pattern would drag every segment back inside NY's outright ban. Flag this to the team as a legal trap. GMT's operating state is inferred from a marketing script (`scripts/update-cms-content.js:32-42`, "Madison, Tennessee") and is not recorded in tenant data — confirm it (§8).

---

## W6 — `reconcile-deposit-holds`: Stripe as the only source of truth

**Ship: week 3. Effort: multi-day. Blocked on: W2 (needs `deposit_hold_prev_payment_intent_id` and the widened status set).**

**Goal:** the safety net that makes every other change survivable, including "the refresh cron was never deployed."

**New file:** `supabase/functions/reconcile-deposit-holds/index.ts`, every 6 hours, registered in `supabase/config.toml` and `sim-control/cron-manifest.json`, scheduled in live pg_cron and **verified against `cron.job`**.

For every rental in a non-terminal deposit state, retrieve the PaymentIntent using the record-anchored platform resolution, and force the DB to match Stripe:

| Stripe | DB | Action |
|---|---|---|
| `requires_capture` | not `held` | write `held` — recovers rows stranded in `refreshing`/`processing` (invisible to every query and to all three portal branches) and rows wrongly marked `expired` by a pre-Stripe throw |
| `requires_capture` | `held` | overwrite `deposit_hold_expires_at` with the true `capture_before` and `deposit_hold_extended_auth` with the status — permanently kills the fallback lie |
| `canceled` / `succeeded` | `held` | write the true state and alert. Stripe: "If the authorization expires before you capture the funds, the funds are released and the payment status changes to `canceled`." **Nothing consumes this today.** |
| `deposit_hold_prev_payment_intent_id` still `requires_capture` | — | cancel it. Guards against Visa's Misuse of Authorization System Fee, assessed on authorizations "that cannot be matched to a clearing transaction or an authorization reversal." |
| `refreshing`/`processing` older than 1h | — | reap to `retrying` |

**Why a poller, not a webhook — deliberate choice.** A `charge.expired` handler looks cheaper but may accomplish nothing: GMT's holds are **direct charges on the connected account** (`place-deposit-hold` passes `{ stripeAccount }`), so those events arrive only if the endpoint was registered with `connect: true`, and `docs/GYM-RETURN-CHECKLIST.md:28-31` leans toward the booking webhooks **not** being Connect-scoped (**UNVERIFIED**). A poller has no such dependency.

**Also fix, defensively:** `stripe-webhook-live/index.ts:1274-1305` handles `payment_intent.canceled`, looks the PI up in `payments.stripe_payment_intent_id`, and sets `rentals.status = 'Cancelled'` guarded **only** by `if (payment.rental_id)` — no check of the rental's current status. `place-deposit-hold` inserts no `payments` row (grep confirms), but `create-preauth-checkout` does (`:204-223`), so on that path an authorization aging out can flip a live Active rental to Cancelled. Add a status guard. Mirror to `stripe-webhook-test`.

---

## W7 — Deposit policy tiering (the strategic fork)

**Ship: week 3–4. Effort: multi-day. BLOCKED ON THE TEAM LEAD (§8 Q1), not on Stripe.**

**Goal:** stop pretending a 90-day rental and a 3-day rental are the same product.

**DB (Supabase MCP):** `tenants.deposit_policy text default 'hold' check (deposit_policy in ('hold','on_file','charge_refund'))`, `tenants.deposit_hold_max_days integer default 30`. **If the booking site ever reads either column, `GRANT SELECT … TO anon`** — a missing column grant 403s the whole `tenants` query and every booking site falls back to default branding.

- `hold` — today's behaviour. Correct for rentals inside the network window.
- `on_file` — no reserved funds past the window; one short authorization at handover as a card-validity probe, allowed to expire naturally, plus a signed mandate (W5) and `charge-saved-card` (W4). This is what the two going-concern comparables do: SIXT+ releases the deposit "after the first rental term"; Turo runs monthly trips as "a series of consecutive, automatically renewing 30-day trips."
- `charge_refund` — actually take the money and refund at return. **Read the caveat below before offering this.**

**Read in:** `place-deposit-hold/index.ts` (alongside the existing `deposit_mode`/`global_deposit_amount` fetch), `refresh-deposit-holds/index.ts` (driver query filter), `create-hold-checkout/index.ts:70-78`.

**Two hard constraints on `on_file`, both of which the candidate designs missed:**

1. **`rentals.deposit_hold_payment_method_id` is dual-purpose.** It is the deposit-hold PM **and** the auto-extend rent-charging card: `auto-extend-rentals/index.ts:547` gates on `deposit_hold_stripe_customer_id && deposit_hold_payment_method_id` and charges it at `:565-566`; the UI warns on it at `auto-extension-section.tsx:251`. It is written **only** by `place-deposit-hold:352-353` and `sync-deposit-hold:102-103`. The `on_file` probe hold preserves it — but the first person who deletes the "pointless probe hold" silently kills auto-extend auto-charge for every affected rental. **Make this an explicit invariant, or better: split out a dedicated `rentals.saved_payment_method_id` and stop overloading a deposit column with a rent-billing responsibility.**

2. **`charge_refund` has no ledger representation.** Migration `20260420120500_remove_security_deposit_charge.sql` *deliberately* removed the Security Deposit ledger charge — "it lives on `rentals.deposit_hold_*` and is held as a Stripe preauth, not written as a Charge row." The portal row is synthesised in JS (`rentals/[id]/page.tsx:3054`) and the booking app explicitly excludes it (`bookings/[id]/page.tsx:664-666`). A `charge_refund` deposit would land as an **unallocated payment**. That mode requires re-introducing what the platform deliberately deleted — a schema decision, not a config flag. Cost it properly before offering it.

---

## W8 — Close the adjacent leaks that end coverage mid-rental

**Ship: week 4. Effort: multi-day. Blocked on: W6 (the reconciler proves the fixes worked).**

1. **Partial capture silently kills the remainder.** `deduct-from-deposit/index.ts:131-135` does a bare `paymentIntents.capture` with `amount_to_capture` and then unconditionally writes `deposit_hold_status: "captured"` at `:139`, with no `deposit_hold_amount` update and no rollover. Stripe: "A partial capture automatically releases the remaining amount… you can't perform another capture for the difference." So deducting $200 of a $1,500 deposit on day 20 of a 90-day rental **silently releases the other $1,300**. `capture-deposit-hold/index.ts:173-211` already implements the correct rollover — port it, and write the reduced amount back.

2. **Checkout-placed holds are orphaned by a closed tab.** `create-hold-checkout/index.ts:114-125` stamps `metadata.type = 'security_deposit_hold'`, but that string appears **nowhere else in the repo** — no webhook handles it. The `deposit_hold_*` columns are written only by the `success_url` redirect calling `sync-deposit-hold`. Close the tab and Stripe holds the renter's money with no DB record: no refresh, release or capture can reach it. Add a `checkout.session.completed` branch keyed on that metadata.

3. **`create-hold-checkout` under-holds GMT.** It resolves the amount from `deposit_amount_override` else `tenants.global_deposit_amount` (`:70-78`) and never consults `deposit_mode`, while `place-deposit-hold:115-137` honours per-vehicle deposits for GMT. Extract that resolution into `_shared` and use it in both.

4. **`sync-deposit-hold` can corrupt the platform anchor.** `sync-deposit-hold/index.ts:106` writes `platform_account` on the rental **unconditionally**, derived from the tenant's *current* model. A rental with existing `uk` payments can be re-stamped `uae` by a browser redirect after Checkout success, after which every later capture/release/refresh targets the wrong Stripe account. Never overwrite a non-null `platform_account`.

5. **`create-preauth-checkout/index.ts:89-91`** hardcodes `preauth_expires_at` to `now+7d` at session-creation time and never reconciles it. Point it at `resolveHoldExpiry`.

---

## W9 — Operator surface

**Ship: week 4–5. Effort: multi-day. Blocked on: W2 (new statuses).**

- **Dead-end states.** `apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx` branches on exactly `held` (`:3491`), `expired` (`:3536`) and falsy (`:3548`). A rental in `refreshing`, `processing` or `failed` renders **no deposit action at all**. Add branches for those plus `retrying` and `action_required`.
- **The deadline is invisible.** `deposit_hold_expires_at` is rendered nowhere in portal or booking — only the super-admin tab (`apps/admin/components/admin/tenant-payments-tab.tsx:591`), which is additionally hard-filtered to `platform_account = 'uk'` and `status IN ('held','processing')`, so every `expired`/`failed` row and every UAE hold is invisible there. Surface expiry, attempt count, last error code, extended-auth badge, and a "verified against Stripe" timestamp. Add a cross-tenant hold-health view with no platform filter. (Note the same filter feeds `check-migration-readiness/index.ts:239-244`, where stale `held` rows become false UK→UAE migration blockers.)
- **Force refresh** button invoking `refresh-deposit-holds` with `{ only_rental_id }` — the parameter already exists and is already applied as a filter.
- **Fix the hardcoded copy.** `charge-deposit-dialog.tsx:210` says "Stripe card holds only last about **7 days**"; `page.tsx:3537` comments "Stripe ~7-day boundary". Both become wrong the moment W3 lands. Drive from `deposit_hold_expires_at`.
- **Ungate the customer card-update flow.** `apps/booking/src/app/(customer-portal)/portal/payments/page.tsx:1222` hides "Update Card" behind `activePlans.length > 0`, so a GMT long-term renter with no installment plan **cannot update their card and staff cannot do it for them.**
- **Customer-facing strings.** `apps/booking/src/components/customer-portal/PaymentBreakdown.tsx:572-581` renders `held → "Held"` straight off the column with no Stripe cross-check.

---

## W10 — Harden the cron endpoint

**Ship: after W2–W4 have settled. Effort: 1 day.**

`supabase/config.toml:68-69` sets `verify_jwt = false` for `refresh-deposit-holds`, and the function goes from `handleCors` → service-role client → body parse with no token check, while accepting a caller-supplied `only_rental_id` and applying it as a filter. Any unauthenticated caller who knows a rental UUID can force a cancel-and-reauthorize cycle on a live deposit — under today's code, one that destroys it. Add an `X-Cron-Secret` header check (the `authType: "platform-secret"` pattern already used by `onboarding-daily-digest`, `cron-manifest.json:24`). **Do not** solve this with a service-role bearer in the cron command — a valid prod service_role JWT is already committed in plaintext at `supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql:14` and is pending rotation. Sequence this after W2 deliberately: until the refresh is non-destructive, an auth gate is second-order.

---

# 4. Known bugs found along the way

Ranked by severity.

| # | Severity | Defect | File:line | Failure scenario |
|---|---|---|---|---|
| 1 | **Critical** | Any error in the refresh loop writes terminal `deposit_hold_status='expired'`; the driver query only selects `'held'`, so it is never retried. No decline triage, no backoff, no alert. | `refresh-deposit-holds/index.ts` catch block; driver `.eq("deposit_hold_status","held")` | One transient Stripe 500 on day 40 of a 90-day rental destroys the deposit for the remaining 50 days. Nobody is told. Staff discover it at vehicle return. |
| 2 | **Critical** | Cancel happens before the replacement exists; failure leaves the rental with **no** hold. | `refresh-deposit-holds/index.ts` "Step 1: Cancel the old hold" precedes `createDepositHoldIntentWithFallback` | Combined with #1: cancel succeeds, create declines, status goes terminal, money gone. |
| 3 | **Critical** | Pre-Stripe throws mark live holds dead. `tenants` lookup and `getConnectAccountId` throw *before* any Stripe call, into the same catch. Tenant cache re-fetches on falsy. | `refresh-deposit-holds/index.ts` tenant fetch + `getConnectAccountId` | One transient `tenants` read failure marks **every** held deposit for that tenant `expired` in a single pass. Collides directly with the in-flight UK→UAE migration. |
| 4 | **High** | `place-deposit-hold` skips the extended-auth-only ladder rung, dropping straight to no `payment_method_options`. | `place-deposit-hold/index.ts:279-322`, esp. `:300` vs `stripe-client.ts:187` | If GMT is ineligible only for multicapture, every key-handover hold gets ~7 days instead of ~30 — turning a 3-cycle rental into a 15-cycle one. |
| 5 | **High** | Retry replays Stripe's cached decline. Idempotency key is `deposit-refresh-{rentalId}-{oldPI}` and the failure path never updates `deposit_hold_payment_intent_id`. | `refresh-deposit-holds/index.ts` `idempotencyKey` | Any retry within 24h returns the identical decline. **Invisible in staging** (fresh fixture ⇒ new key every run). Silently defeats any retry logic added in W2. |
| 6 | **High** | Partial capture silently releases the remainder; status forced to `captured` with no rollover and no amount update. | `deduct-from-deposit/index.ts:131-139` | $200 deducted from a $1,500 hold on day 20 releases $1,300 and leaves 70 days uncovered. Staff believe a deposit is still held. |
| 7 | **High** | Checkout-placed holds are recorded only by a browser redirect; `metadata.type='security_deposit_hold'` has no webhook handler anywhere. | `create-hold-checkout/index.ts:114-125`; only writers of `deposit_hold_*` are the `sync-deposit-hold` callers | Renter authorizes and closes the tab. Stripe holds their money; Drive247 has no record; no function can ever release or capture it. |
| 8 | **High** | Currency read from the *current* tenant on refresh while platform is record-anchored. | `refresh-deposit-holds/index.ts` `tenants … currency_code` → `currencyCode` | A UK→UAE currency change mid-rental produces a replacement hold in a new currency on the old platform account against a card saved in the old currency. Guaranteed failure → bug #1 → deposit gone. |
| 9 | **Medium-High** | `payment_intent.canceled` sets `rentals.status='Cancelled'` with no guard on the rental's current status. | `stripe-webhook-live/index.ts:1274-1305` (mirrored in `-test`) | On the `create-preauth-checkout` path (which does insert a `payments` row) an authorization aging out can flip a live Active rental to Cancelled. Conditional on the endpoint being Connect-scoped — **UNVERIFIED**. |
| 10 | **Medium-High** | Unauthenticated destructive endpoint accepting a caller-supplied rental id. | `supabase/config.toml:68-69` + `only_rental_id` filter | Anyone knowing a rental UUID can force one cancel-and-reauthorize per hold per window. |
| 11 | **Medium** | `sync-deposit-hold` overwrites `rentals.platform_account` unconditionally from the tenant's current model. | `sync-deposit-hold/index.ts:106` | A browser redirect can re-anchor a `uk` rental to `uae`; every later capture/release/refresh targets the wrong Stripe account. |
| 12 | **Medium** | Stale payment method: refresh reuses `deposit_hold_payment_method_id` verbatim; nothing updates it when a customer changes cards. | `refresh-deposit-holds/index.ts` PM read; only writers are `place-deposit-hold:352` and `sync-deposit-hold:102` | Customer replaces their card on day 30; every subsequent refresh fails `resource_missing`/`expired_card` → bug #1. |
| 13 | **Medium** | Silent `+7d` fallback. Charge retrieves fine but `capture_before` absent ⇒ falls through with **no** warning (the `console.warn` is only in the `catch`). | `stripe-client.ts:260-271` | DB claims 7 days on a possibly 4d18h Visa MIT window; the 2-day lookahead first examines the row at day 5, after the authorization died. |
| 14 | **Medium** | Rows invisible to the cron forever: `deposit_hold_expires_at IS NULL` (`.lt()` on NULL yields NULL); `status='Pending'` rentals (three writers set `held` with no status guard; the portal creates rentals as `Pending`). | `refresh-deposit-holds/index.ts` driver query | Holds that never refresh and never alert. |
| 15 | **Medium** | Unguarded writes + no compare-and-set. All loop writes discard `{ error }` (supabase-js resolves, doesn't throw); `place-deposit-hold`'s busy-set covers only `held`/`processing`, not `refreshing`. | `refresh-deposit-holds/index.ts` writes; `place-deposit-hold/index.ts:73-81` | Discarded write error ⇒ rental stranded in `refreshing` with a live untracked PI. Concurrent place ⇒ two live holds. |
| 16 | **Medium** | Serial unbounded loop, no `.limit()`, no cursor, single response after all rentals. | `refresh-deposit-holds/index.ts` | Supabase edge functions: 150s idle / 400s wall clock. A mid-loop kill strands rentals in `refreshing`, which nothing reaps. |
| 17 | **Medium** | `auto_extend_enabled` release branch evaluates **after** the unconditional cancel. | `refresh-deposit-holds/index.ts` `isLongRunning` branch | "Release instead of refresh" actually means "destroy, then record that we released." |
| 18 | **Low-Medium** | The ladder trigger is a substring match on an English error string. | `stripe-client.ts:192-196` | If Stripe rewords the message, the helper rethrows and `refresh-deposit-holds` marks **every** hold on **every** ineligible account `expired` in one nightly pass. Nobody has captured the real string from Stripe logs. |
| 19 | **Low-Medium** | `deposit_hold_status='failed'` is near-unreachable. Written by the webhooks guarded on `.is("deposit_hold_status", null)`, but `place-deposit-hold` resets its claim to `null` inside the same request. | `stripe-webhook-live/index.ts:1176-1180`; `place-deposit-hold/index.ts:307-319` | Only reachable when the invoke fails at the HTTP layer. Consider deleting it rather than adding UI for it — a state that is both unreachable and a dead end is worse than no state. |
| 20 | **Low** | `create-hold-checkout` ignores `deposit_mode`. | `create-hold-checkout/index.ts:70-78` vs `place-deposit-hold/index.ts:115-137` | The portal "Add Hold" button under-holds GMT's per-vehicle fleet. |
| 21 | **Low** | Two different things are both called "deposit hold." Booking pre-auths (`create-preauth-checkout`) have a `payments` row; rental deposit holds do not. | `use-payment-links.ts:93-99`; `payment-links-panel.tsx:56` | Any reporting or reconciliation merging these double-counts. |
| 22 | **Info** | Zero tests. `apps/portal/src/__tests__/` contains only `hooks/`, `lib/`, `setup.ts`; grep for `deposit` returns nothing. | — | None of this logic has ever been asserted. All three candidate designs assumed a test layer to extend; there isn't one. |

---

# 5. Risks, edge cases and how each is handled

**Debit cards — the sharpest customer-harm risk.** Stripe: "credit card holds are usually clear within three to seven business days, whereas **debit card holds can occasionally take up to several weeks** to process back into a checking account balance." At a ~5-day re-auth cadence a debit renter can carry two or more simultaneously ringfenced deposits while Stripe shows exactly one live authorization. *Handled:* (a) we do **not** reorder to new-before-cancel, which would add deliberate overlap on top of unavoidable bank lag; (b) the W5 disclosure states it plainly; (c) recommend GMT prefer credit cards for long-term rentals; (d) W7's `on_file` tier removes the problem entirely for rentals past the window. Note this is the single strongest argument for `on_file`.

**Double holds.** Two sources: bank release lag (above) and code races — `place-deposit-hold` will claim a rental sitting in `refreshing` because its busy-set covers only `held`/`processing`. *Handled:* add `refreshing` and `retrying` to the busy-set (W2, bug #15); reconciler cancels any lingering `deposit_hold_prev_payment_intent_id` (W6). **If anyone still wants new-before-cancel, the blocking test is in §6: seed a customer at a low limit and confirm whether the second authorization returns `insufficient_funds`.** That single test validates or kills the idea.

**Card expiry mid-rental.** On a 90-day rental this is likely, and there is **zero** monitoring: grep for `payment_method.automatically_updated` returns nothing; the live webhook handles six event types only; `customers` stores no brand/last4/exp. Stripe's Card Account Updater is "widely supported in the United States" for Amex/Visa/Mastercard/Discover but "International support varies", and whether it applies to cards saved on a **connected account under direct charges** is **UNVERIFIED** — Stripe's docs never mention Connect. *Handled:* W2 re-resolves the PM fresh on retry; W9 ungates the customer card-update flow and surfaces a "card expires before rental end" warning; add `payment_method.updated` + `payment_method.automatically_updated` handlers as a fast-follow. **Card brand change is a hard stop:** Stripe — "When a card's brand changes, you can't charge it for any MITs until you get a new cardholder agreement." Mark the mandate stale and alert.

**SCA.** GMT's US connected account is out of SCA scope (Stripe: "Businesses based outside the EEA are considered out of scope"), and MITs "technically fall outside the scope of SCA." But `authentication_required` can still arrive from a non-US issuer, and there is **no server-side fix** — the customer must return on-session. *Handled:* dedicated `action_required` state, immediate operator + customer notification, and a link that re-places the hold **on-session** (which also converts the transaction to customer-initiated and buys the 7-day Visa CIT window instead of the 5-day MIT one). This does **not** generalise to Drive247's EEA/UK tenants, who are in scope.

**Network fees.** Visa's Misuse of Authorization System Fee is assessed on "approved and partially-approved authorizations that cannot be matched to a clearing transaction or an authorization reversal." The current cancel-first ordering is on the right side of that line. But at 13–18 auth/reversal pairs per 90-day rental, any systematic failure to deliver the reversal multiplies. *Handled:* W6's orphan sweep; per-cycle cost is unquantified and is a ticket question. Separately, Visa's non-favoured-MCC extended-auth surcharge is 0.08%/txn — another reason to fix MCC (W3).

**Disputes.** Card networks typically allow 120 days, and "when a customer pays for a future event or service … the dispute window starts on the event date, not the payment date." MITs get **no 3DS liability shift** — a fraud chargeback on a damage charge lands on GMT. *Handled:* the W5 mandate is the entire defence. This is why W5 blocks damage-category use of W4, not the other way round.

**UK/UAE dual platform.** Record-anchored resolution is correct in `refresh-deposit-holds`, `capture-deposit-hold`, `release-deposit-hold`, `deduct-from-deposit` — all key off `rentals.platform_account`. Three interactions bite: (i) currency is **not** record-anchored (bug #8); (ii) `sync-deposit-hold` can rewrite the anchor (bug #11); (iii) `check-migration-readiness/index.ts:239-244` treats `deposit_hold_status IN ('held','processing') AND platform_account='uk'` as a migration blocker, so every stale `held` row from the divergence paths is a **false** UK→UAE blocker — which for GMT, a permanent long-term-hold operator, is close to a permanent condition. The W1 backfill sweep clears these. Also note `_shared/stripe-client.ts:142` can return `null` ("no routing — payment goes to platform") for non-onboarded live tenants; GMT is onboarded so direct-charge behaviour holds, but do not generalise.

**Retries look like fraud.** Stripe: "card networks limit the number of times you can reattempt a single charge. We recommend a maximum of eight retries … Card issuers might see creating additional retries as potential fraud, which can result in increased declines for legitimate charges." The 8-attempt cap and per-code backoff in W2 are load-bearing.

**The 30-day ceiling holds even in the best case.** If Stripe grants extended authorization, a 90-day rental still needs 3–4 destructive cycles and a debit renter still stacks holds. **Getting 30 days improves the short-rental product; it does not make the long-term product a hold.** Do not let a successful ticket reopen the "just refresh forever" argument.

**Do not quote survival arithmetic.** "0.95^15 ≈ 46%" treats attempts as independent; same card, same customer, same amount are strongly correlated and the distribution is bimodal. Rhetorically effective, statistically wrong.

---

# 6. Testing plan

## 6.1 The sandbox cannot currently test the one change everything depends on

`sim-control/index.ts:158-174` (`doSeedHold`) creates the fixture PaymentIntent with **no `stripeAccount` option** — it runs on the *platform* test account (comment at `:129-132` confirms this is deliberate). And `_shared/stripe-client.ts:130-133` returns the **shared** `STRIPE_TEST_CONNECT_ACCOUNT_ID` for every test-mode tenant, whose card-feature eligibility is not GMT's live account's eligibility.

**Consequence: the "not eligible for the requested card features" branch — the entire premise of the W3 ladder fix — cannot be reproduced in the sandbox.** All three candidate designs implied otherwise.

**Fix before trusting the harness:**
1. Pass `{ stripeAccount: STRIPE_TEST_CONNECT_ACCOUNT_ID }` in `doSeedHold` so the fixture exercises the Connect direct-charge path.
2. Add a second fixture PM on `pm_card_credit_disableEnterpriseCardFeatures` (Stripe's documented card that refuses advanced features, listed on both the incremental-authorization and multicapture pages) so a real Stripe refusal walks the ladder at least once.

## 6.2 Unit (vitest) — this layer does not exist and must be created

Extract the pure logic out of the Deno functions so it is testable at all, then:

- **`resolveHoldExpiry`** — four cases: `capture_before` present; `latest_charge` as a string (retrieve path); throw → fallback; **and the silent case** where the charge retrieves fine but `capture_before` is absent (`stripe-client.ts:260-266`), which falls through to the fallback with no warning. That last path is bug #13.
- **Idempotency-key construction** — assert the key differs between attempt N and N+1. This is the test that catches bug #5, which is otherwise invisible in staging.
- **`isCardFeatureIneligibleError`** — against the real string and a reworded one, forcing an explicit decision about bug #18.
- **Decline-triage table** — every Stripe code → expected next state and `next_attempt_at`. Pure function, no network.
- **Status machine** — legal transitions only; assert `expired` is unreachable from the catch path.

## 6.3 Stripe test mode, against the shared test Connect account

- **Ladder walk** with `pm_card_credit_disableEnterpriseCardFeatures`: confirm all rungs are attempted, and that the helper's `-cf1`/`-cf2` suffixes do not collide with the legacy `-no-mc` key on a rental mid-migration.
- **Double-authorization test — this blocks any reordering decision.** Seed a customer at a low limit, create hold A, then create hold B while A is live. Observe whether Stripe returns `insufficient_funds`. Validates or kills new-before-cancel.
- **SCA** → `pm_card_authenticationRequired` (already attached by `sim-control/index.ts:150`): assert `action_required`, never `expired`.
- **Decline** → `pm_card_chargeDeclined` (`:149`): assert `retrying` then `action_required`, never `expired` on attempt 1.
- **Currency mismatch**: hold in GBP, flip tenant `currency_code` to AED, refresh; assert the stamped `deposit_hold_currency` is used.

## 6.4 Time Machine / cron simulator (staging `ksmreaadhbirzakkxqrq`, dev-only, tenant-locked)

- **Happy path:** backdate `deposit_hold_expires_at` −7d → fire `sandbox-refresh-deposit-holds` → assert new PI, new `capture_before`, status `held`. The fixture self-reverts per `sim-shift-manifest.json`.
- **The failure path is where the harness is weakest.** `apps/portal/src/app/api/dev/sandbox/services.ts:170-177` already documents that a failed run *burns* the fixture. Before testing retry, add a reseed action wired to `sim-control`'s `doSeedHold` — otherwise you get exactly one failure test per manual re-seed.
- **Multi-cycle is not writable today.** The deposit service is `stepping: "single"` and `scripts/sim/` contains only `helpers.mjs` and `scenario-payg-30-days.mjs`. `scenario-deposit-refresh.mjs` was specified in the design doc and never written. A 90-day chain needs it.
- **Re-verify blast radius after every query change.** `apps/portal/src/app/api/dev/sandbox/route.ts:92-104` aborts unless `preview` matches only the scoped rental. W2 **widens** the driver query (adds `Pending`, NULL-expiry, `retrying`). Widening the query widens the preview; if the fixture tenant has other matching rentals, `assertBlastRadius` throws and the Time Machine goes dark. Run `preview: true` before and after every query change.
- **Staging caveat:** staging shares prod's Stripe test account, so its webhooks fire into prod. Cron money flows settle inline (fine). Do not drive live UI payments on staging.

## 6.5 Untestable anywhere — one live, disposable canary

Whether `acct_1SrIFEPcUIaEGCY0` accepts extended-auth-alone; the real `capture_before`; whether `extended_authorization.status` is `enabled`; MIT vs CIT classification. Do these as read-only `accounts.retrieve` plus **one $1 disposable hold on a staff card**. Never on a customer rental.

---

# 7. The Stripe support ticket

File platform-side. Attach 2–3 real request IDs from Dashboard → Developers → Logs showing the ineligibility error, and **capture the exact error string** — the repo only has it in a code comment (`stripe-client.ts:175-176`), never as a captured API response.

**Do the two free platform-side checks first** (W0): `accounts.retrieve` for the MCC, and the isolated feature probe. Both change what to ask.

---

> **Subject:** Advanced card features (extended authorization) on Express connected account acct_1SrIFEPcUIaEGCY0 — eligibility and permitted use
>
> We operate a multi-tenant car-rental platform on Stripe Connect. Our connected account **acct_1SrIFEPcUIaEGCY0** (US, Express, created by our platform) is a long-term vehicle-rental operator. We place refundable security deposits as manual-capture PaymentIntents created as **direct charges** on that account (`Stripe-Account` header only — no `transfer_data`, no `on_behalf_of`, no `application_fee_amount`). API version 2023-10-16.
>
> When we create the PaymentIntent with `payment_method_options[card][request_extended_authorization]=if_available` (and `request_multicapture=if_available`), the request fails with an account-eligibility error rather than the documented "silently ignore" behaviour of `if_available`. Request IDs: `[[paste 2-3 request IDs]]`. Exact error text: `[[paste verbatim]]`.
>
> Rentals for this operator routinely run 60–120 days, so the deposit authorization must be re-placed periodically. We need written answers to the following before we finalise the design.
>
> 1. **Permitted use — please answer this first.** Your extended-authorization documentation states that "for many networks extended validity windows are only for cases where you don't know the final amount that you'll capture at the time of authorization." Our merchant holds a **fixed, known** refundable security deposit, not an estimated amount. **Is extended authorization a permitted use for a fixed-amount security deposit on Visa, Mastercard, Amex and Discover?** If it is not, we will not pursue it and the remaining questions are moot.
> 2. For a **direct charge on a connected account**, is advanced-card-feature eligibility (extended authorization, multicapture, incremental authorization) evaluated against **our platform's** pricing plan or against the **connected account's**? Your docs state these are IC+ features but do not define which party's plan governs a direct charge.
> 3. Is our platform account currently on IC+ or blended pricing? If blended, what is the process and expected timeline to move to IC+?
> 4. If our platform moves to IC+, does extended authorization become available on direct charges for **all** our Express connected accounts automatically, or must each be enabled individually?
> 5. What MCC is currently set on acct_1SrIFEPcUIaEGCY0? We never set `business_profile.mcc` at account creation. If it is not a vehicle-rental MCC, can we set **7512**, and will Stripe verify/approve it?
> 6. Does extended authorization apply to an **off-session, merchant-initiated re-authorization** on a saved card at a vehicle-rental MCC? Your card-not-present table gives Visa MIT 5 days (4d18h) versus 7 days CIT, and the Visa footnote restricts the extended window to Customer-Initiated Transactions for merchant categories outside vehicle rental. Please confirm which window applies to our case.
> 7. Is requesting `request_multicapture` on a **security-deposit** authorization itself non-compliant on any network? Your multicapture documentation notes that some networks "don't permit multicapture for installment or deposit workflows." If so, we will drop it from the request.
> 8. Please confirm whether the additional 0.08% per-transaction extended-authorization fee applies to this account given its MCC.
> 9. Please confirm there is **no** Stripe product, beta, or private preview providing a card authorization longer than 30 days, and that cancel-and-reauthorize before `capture_before` is the approach Stripe recommends for rentals exceeding the window.
> 10. Our compliance question on repeated re-authorization: over a 90-day rental we would issue roughly 3 (extended auth) to 15 (default window) authorization + reversal pairs per rental. Is there any per-cycle cost or network-rule exposure we should account for, given Visa's Misuse of Authorization System Fee applies to authorizations that cannot be matched to a clearing transaction **or an authorization reversal**?
> 11. Does Stripe's automatic Card Account Updater apply to cards saved on a **connected account under the direct-charge model**, and is it on by default for a US Express account?
> 12. We would like access to the `automatic_delayed_capture_beta_preview` private preview — is it available for Connect direct charges on Express accounts?

**Set expectations in writing with GMT before the ticket returns:** the maximum any Stripe answer can deliver is **30 days per authorization** (Visa 29d18h). Nobody should promise 90 days on a single hold, because no such product exists on any network.

---

# 8. Open questions for the team lead

Only what cannot be answered from code or docs. Each is decision-shaped and blocks a named workstream.

1. **Does GMT want reserved funds, or the ability to collect?** This is not a technical choice — it *is* the choice, and **nobody has asked GMT.** Reserved funds means 13–18 destructive cycles per rental with compounding debit-stacking harm. Ability to collect means a saved card plus a signed mandate and no reserved funds at all, which is what the two comparables still in business do (SIXT+ releases the deposit after the first term; Turo runs renewing 30-day segments). **Blocks W7.** Everything else in this plan is needed either way.

2. **Which US state does GMT operate in?** Tennessee is inferred from a marketing script (`scripts/update-cms-content.js:32-42`), not from tenant data. NY vs CA vs TN changes what is legal, not just what is prudent. **Blocks W5.**

3. **Does GMT paper 90-day rentals as one agreement, or as chained ≤30-day extensions?** Only GMT knows. Chaining drags every segment inside NY GBL §396-z(7)'s outright ban on card deposits for damage — the exact opposite of the intended effect. **Blocks W5.**

4. **Is a brief deliberate double-hold acceptable?** Relevant only if the §6.3 double-authorization test comes back clean. My recommendation is no (it may *cause* the decline it was meant to prevent, and it worsens debit stacking), but if GMT would rather see two pending items than risk an uncovered gap, that changes the W2 design.

5. **Ship W1 alerting on the misleading `payment_failed` type, or block on a dedicated `deposit_hold_failed` type?** The dedicated type needs a trigger-allowlist edit (DDL via Supabase MCP) plus a `CATEGORY_BY_TYPE` change. Recommendation: ship on `payment_failed` now, fast-follow the dedicated type. **Blocks W1 by hours, not days.**

6. **Is partial deposit capture needed, or is full-capture-only permanent?** The UI currently locks it off (`charge-deposit-dialog.tsx:239-253`). This determines whether `request_multicapture` is dropped in W3 and whether bug #6's rollover fix is required or merely correct.

7. **Who owns and signs off the agreement-template disclosure rewrite?** It is customer-facing contract language required by card-network rule, not engineering copy. **Blocks W5.**

8. **If Stripe answers "no" to ticket question 1 (fixed-amount deposits are not a permitted use of extended authorization), do we still want rolling re-authorization at the ~7-day window?** That is 13–18 cycles per rental with no path to fewer. My recommendation in that case is to move GMT to `on_file` and stop refreshing past the first window.