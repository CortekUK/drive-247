I verified the load-bearing cross-domain claims directly against the code. Here is the seam analysis.

---

# CROSS-DOMAIN COMPLETENESS CRITIQUE

## 0. The one file every domain read and nobody joined

`apps/admin/components/admin/tenant-payments-tab.tsx:251-285` — `flipPaymentModel`:

```ts
await supabase.from('tenants').update({ payment_model: next }).eq('id', tenantId);
if (next === 'own') {
  await supabase.from('customers')
    .update({ stripe_customer_id: null })
    .eq('tenant_id', tenantId)          // ← EVERY customer of the tenant
    .not('stripe_customer_id', 'is', null);
}
```
with the in-code justification: *"Readiness blocks flips with active saved-card flows (installment plans / auto-extend), so this is safe."*

That premise is false three times over, and each falsification lives in a different domain. This is the single highest-damage seam in the whole review and no domain owns it.

---

## 1. EDGE CASES THAT ONLY EXIST AT A SEAM

### S1 — The UAE flip amputates the recovery path for every live chain (D2 × D5 × D1) — CRITICAL

Post-flip, the chain itself survives: `refresh-deposit-holds:171-172` uses `rentals.deposit_hold_stripe_customer_id` (record-anchored), and `getStripeClientForRecord` + the `platform_account === 'uae' ? 'own' : 'managed'` override at `:110-112` correctly keep re-authorizing on UK. **But every recovery action is now dead:**

| Action | Post-flip behaviour |
|---|---|
| Operator clicks "Add Hold" / "Refresh & Charge" | `place-deposit-hold` re-resolves `customers.stripe_customer_id` → NULL → `stripe.customers.retrieve(null)` → 400/throw. No hold can ever be re-placed on a UK-anchored rental again. |
| Renter updates their card | `update-payment-method:74` uses `getChargePlatformAccount(tenantData)` = **current** model = `uae`. New customer + new `pm_` minted on the UAE platform. |
| D2's proposed fix (write that `pm_` onto `rentals.deposit_hold_payment_method_id`) | Writes a **UAE** payment method onto a **UK**-anchored chain. Every subsequent link → `resource_missing`. |
| That `resource_missing` reaching `release-deposit-hold:86-99` | **Swallowed as success**, and `:102-105` writes terminal `deposit_hold_status='released'`. Funds still authorized on UK; DB says released; excluded from every future query. |

So **D2's fix, shipped without D5's record-anchoring, converts a recoverable stale-card decline into a silent, terminal, funds-still-frozen lie.** Neither domain could see this because D2 never read `flipPaymentModel` and D5 never read `update-payment-method`.

The gate that is supposed to prevent all of it (`check-migration-readiness:239-243`) filters `.in("deposit_hold_status", ["held","processing"])` — it cannot see `refreshing` or `failed`, which are precisely the states a crashed link leaves behind. And the admin button at `:663` is literally labelled **`Flip anyway`** with no server-side enforcement (`:254-258` writes `payment_model` straight from the browser).

**Handling:** `place-deposit-hold` must fall back to `rentals.deposit_hold_stripe_customer_id` when `customers.stripe_customer_id` is null; the flip must exclude customers with a rental in a non-terminal hold state; the readiness filter must cover all non-terminal statuses; the flip must move server-side into an RPC that re-runs the check.

### S2 — 03:00 UTC is *evening* for GMT, not dead of night (D1 × D3)

D1's reviewer downgraded the refresh-vs-operator race to "rare" on the reasoning that `0 3 * * *` UTC is 22:00–23:00 US Eastern. GMT operates from Madison, Tennessee — **21:00–22:00 Central**. D3 independently documented that GMT is a self-service **lockbox** operator (`lockbox_enabled`, `notify-lockbox-code`, `delivery_method='lockbox'`). After-hours key drops and late returns are the *design intent* of that product.

So the collision window between `refresh-deposit-holds` marking `refreshing` (`:84-87`) and `use-key-handover.ts:398` writing `status='Closed'` + invoking `release-deposit-hold` (`:413`) sits squarely inside GMT's real activity. Compose the two verified facts:

- `release-deposit-hold:41` **deliberately accepts `refreshing`**, cancels the already-cancelled old PI, hits the `payment_intent_unexpected_state` swallow, and writes `released` at `:102-105`.
- `refresh-deposit-holds:195-203` then completes with **no status predicate** (`.eq("id", rental.id)` only) and overwrites with the NEW PI id and `held`.

Net: the renter returned the car, the operator saw "Deposit Released", and a fresh full-amount authorization is live on their card with the DB claiming `held` on a `Closed` rental — which `refresh-deposit-holds:52` (`.eq("status","Active")`) will never look at again. Nothing releases it, ever.

### S3 — SCA composed with the recollect idempotency key = a wrong error message and a 24h lockout (D2 × D1)

`refresh-deposit-holds:188-189` throws on `requires_action` → catch writes terminal `expired`. Operator retries via `place-deposit-hold`; `priorHoldStatus === 'expired'` so `:276` appends `-recollect-expired`. First retry: fresh key, fine. **Second retry the same day: identical key.** Stripe replays the cached response — the `requires_action` PI — so `:326` fails and `:334` returns *"Hold failed with status: requires_action. The card may have been declined."*

The card was not declined. The operator now asks the renter for a different card, which cannot help, for 24 hours. D1 found the key defect; D2 found the SCA defect; the composition is a specific, wrong, unactionable operator message that neither predicted.

### S4 — After the rebase, the *only* working capture path books to a category FIFO refuses (D4 × D6 × D1)

Two capture paths exist and the rebase breaks both differently:

- `deduct-from-deposit` is category-locked to `Excess Mileage` (`:29-38`) **and** gated behind `availableDeposit <= 0` at `:91-93`, computed from `Security Deposit` ledger charges that migration `20260420120500` stopped creating. The hold-capture branch at `:124` is unreachable. Of the design's four named components (unpaid rent, fuel, late return, mileage), **three have no settlement path at all and the fourth's path is dead code.**
- `capture-deposit-hold` takes no category, is hardcoded full-hold-only in the UI (`charge-deposit-dialog.tsx:135` sends `amount: holdAmount`), and books a synthetic `Security Deposit` charge (`:244-307`) that `payment_apply_fifo_v2` deliberately excludes.

So the rebased money path is: **capture the entire anticipated-charges estimate, book it as a phantom deposit charge, leave the real rent charge fully open, keep dunning, and keep auto-extend billing the same money.** That is one over-capture problem (Visa), one accounting problem (D4), and one customer-communication problem (D8) produced by a single seam — and it is *created by* the rebase, not inherited.

### S5 — Extension mid-flight: three domains each saw one third (D3 × D1 × D6)

`place-deposit-hold:52-65` counts **all** `rental_extensions` rows with no status filter and blocks every automatic caller. Compose with the rest:

1. Extension paid 14:00, `finalize_rental_extension` rolls `end_date` — nothing rebases the amount (`refresh-deposit-holds:159` re-reads the frozen scalar).
2. If last night's link went terminal-`expired`, automatic recovery is **permanently blocked** by the extension guard.
3. The extension agreement (`default-agreement-template.ts:219`) told the renter an *additional* hold would be placed.
4. `EXTENSION_AGREEMENT_TEMPLATE` (`:179-242`) contains **no** deposit placeholder at all, so there is no figure to compare against.

Result: the extended period runs with no authorization, on a contract promising one, with no number ever disclosed, and no automatic path back.

### S6 — The PM columns are the auto-extend billing registry, and three domains propose rewriting them (D2 × D7 × D8 × D3)

`auto-extend-rentals:547, 565-566` reads `rental.deposit_hold_stripe_customer_id` / `deposit_hold_payment_method_id` as its **only** card-on-file source. `refresh-deposit-holds:146-152` correctly nulls only the PI id and expiry on the auto-extend release branch and leaves the PM columns intact — deliberately.

D2 proposes writing new PM ids into them; D7 proposes a reconciler that "resolves to the truth" for non-terminal statuses; D8 proposes the same PM propagation. **None of the three knows these columns bill real revenue.** Any reconciler or cleanup that nulls them on release kills auto-extend billing tenant-wide, silently. This must be recorded as an explicit invariant before any of those three fixes ships.

### S7 — The reconciler re-arms the rental-cancel landmine (D7 × D1)

D7's reconciler maps a `succeeded` hold PI → `captured` and *"ensure a `payments` row exists."* `capture-deposit-hold:229` already keys `payments.stripe_payment_intent_id` to the hold PI, and `stripe-webhook-live:1274-1305` turns a cancel of any PI with a payments row into `rentals.status = 'Cancelled'`. A reconciler backfilling payments rows across historical holds arms that landmine on **every rental it touches** — including ones whose PI is still cancellable.

### S8 — Frequency increase before concurrency guard multiplies the race 4× (D5 × D3 × D7)

D5 proposes `0 */6 * * *`. Every write in the loop is unguarded (`:84-87` and `:195-203` both bare `.eq("id")`), and `release-deposit-hold` accepts `refreshing`. Running the *current* code four times more often quadruples the S2 window and the stranded-`refreshing` rate. D5 presented the schedule change as a cheap standalone win; it is only safe **after** optimistic concurrency lands.

### S9 — Every fix lands twice or the only harness validates dead code (D5 × all)

`sandbox-refresh-deposit-holds` is a hand-maintained verbatim fork and, with zero tests anywhere, is the de-facto verification path. Extracting the per-rental body into `_shared/` is not a cleanup item — it is a **prerequisite** to every gate below, or you pay the double-landing tax fifteen times and the Time Machine silently green-lights code production no longer runs.

---

## 2. CONTRADICTIONS BETWEEN DOMAINS

| # | Conflict | Resolution |
|---|---|---|
| **C1** | **D2**: narrow the refresh threshold to ~18h. **D5**: widen to 3 days + run 6-hourly. | **D5 is right; D2 is dangerous.** The threshold (`:37-38`) controls *retry runway*, not overlap — the cancel at `:117` and create at `:166` are seconds apart, and the overlap the renter feels is the issuer's reversal lag, which no threshold touches. An 18h threshold on a daily cron drops any hold whose deadline falls 18–24h after a run. |
| **C2** | **D1**: create-before-cancel. **D3**: same, for funds availability. **D2**: stacking is already the top CX problem. | Genuinely irreconcilable at 5–7 days — cancel-first gaps coverage, create-first *deliberately* stacks 2× a rent-scale amount, 13–18× per rental. See §5.2. |
| **C3** | **D3**: add `'Pending'` to the cron status filter. **D7**: drive off hold state, exclude finished rentals. **D3-missed / D8**: an advance-booking hold on a Pending rental should be **released**, not chained. | Three incompatible treatments. Correct answer: **never chain a Pending hold.** Re-authorizing a card every 5 days for a car nobody has collected is indefensible under 5.7.2.4. Release aged Pending holds; force-replace at handover instead of short-circuiting on `place-deposit-hold:73`. |
| **C4** | **D6**: rename `metadata.type` → `anticipated_charges_auth`. **D1**: webhook guard keys on `metadata.type` matching `deposit_hold*`. | If the rename lands first, the guard stops matching and the rental-cancel landmine **re-arms silently**. Guard must ship first and must match by PI-id-equals-`rentals.deposit_hold_payment_intent_id` as well as by metadata. |
| **C5** | **D4**: route captures through `payment_apply_fifo_v2`. **D6**: damage must never be captured from the hold. | FIFO is category-blind. The moment a `Damage` charge exists, a FIFO-routed hold capture silently pays it — a Visa violation *created by an accounting fix*. Capture must carry an explicit **non-damage allowlist** in `target_categories`, never plain FIFO. |
| **C6** | **D6**: defer an increased authorization to the next cron pass pending renter notice. **D5**: preserve retry runway. | On a 5–7 day window with a daily cron and a 2-day threshold, deferring one pass burns ~half the runway; if the deferred link then fails there is none left. Notice must be **concurrent** with the higher authorization, not a gate on it. |
| **C7** | **D7**: reconciler ensures payments rows exist. **D1**: payments rows on hold PIs are the cancel landmine. | Strict ordering (see §4). |

---

## 3. PROPOSED HANDLING THAT VIOLATES THE VERIFIED VISA RULES

### V1 — The design's own four components are not all inside 5.7.2.4 or 5.8.8.4. **This is the biggest unchallenged assumption in the entire review.**

Every domain took "unpaid rent, fuel, late return, mileage overage" as given. Check them against the verified text:

- **5.7.2.4**: the request *"does not include any amount covering potential damage, theft, **other delayed charges**, insurance premiums, or tips."*
- **5.8.8.4**: over-authorization for extended rentals is permitted but *"must not include an amount to cover for potential damage, theft, **or other delayed charge**."*
- **Table 5-19** treats post-return recoveries as **delayed charges**.

Unpaid rent and rent-to-end-of-term are unambiguously *"what the Cardholder will spend."* **Speculative fuel shortfall, projected mileage overage and late-return exposure are potential delayed charges** — the same category as damage, excluded by *both* rules, not just one. D4's proposed `computeAnticipatedCharges` (open charges + projected rent + **expected fuel gap + projected mileage overage at run-rate + late-return exposure**) therefore builds the forbidden components straight into the authorized amount, and does so with an auditable calculation that makes the violation *provable from our own code*.

The only unambiguously safe basis is **unpaid + anticipated rent**. Escalate before anyone writes the estimator.

### V2 — Create-before-cancel authorizes 2× the estimate, systematically

Two concurrent authorizations for the full anticipated-charges amount is not "a genuine estimation of what the Cardholder will spend" — it is 2× that estimate, deliberately, as an engineering convenience, 13–18 times per rental. D1 and D3 both proposed it without pricing the compliance side. It is defensible **only** with (a) explicit disclosure of the overlap, (b) the incumbent cancelled within seconds not minutes, and (c) never on debit. No domain proposed all three.

### V3 — D4's "shrink the hold as rent is paid" forfeits 5.8.8.4 for nothing

Already flagged by D4's own reviewer, restated here because it interacts with V1: 5.8.8.4 *explicitly* permits authorizing more than the anticipated final amount for extended rental periods. Shrinking discards that safe harbour in exchange for a 5.7.2.4 claim that V1 shows is harder to sustain than the safe harbour it replaces.

### V4 — `deduct-from-deposit`'s Stripe `reason: "requested_by_customer"`

`:192-212` labels operator-initiated deductions as customer-requested. That is a bad fact in a dispute file and directly contradicts the representment story every disclosure fix is being built to support.

---

## 4. ORDERING CONSTRAINTS

Strict. Violating any arrow makes the chain less safe than doing nothing.

**GATE −1 — de-fork.** Extract the per-rental refresh body to `_shared/deposit-hold-refresh.ts`; both cron and sandbox import it. Everything after this ships once instead of twice.

**GATE 0 — disarm before amplifying.** *Nothing else may ship first.*
- `payment_intent.canceled` must ignore deposit-hold PIs (by `metadata.type` **and** by id-equals-`rentals.deposit_hold_payment_intent_id`) and must never cancel a non-`Pending` rental. All three webhook files.
- `checkout.session.completed` must route `metadata.type='security_deposit_hold'` to `sync-deposit-hold` and `break` — no payments row, no `payment_status='fulfilled'`, no `apply-payment`.

  *Why first:* the chain multiplies cancels 13–18×, and **D4's capture fix, D7's reconciler and D1's link table all create more payments rows keyed on hold PIs.** Each of those is a rental-cancellation weapon until Gate 0 lands.

**GATE 1 — record-anchoring.** *Blocks the UAE migration for any hold-bearing tenant, and blocks every card-update fix.*
- Store `deposit_hold_connect_account_id`, `deposit_hold_stripe_mode`, `deposit_hold_currency` at placement; read them verbatim on refresh/capture/release.
- `resource_missing` must **never** write terminal `released`/`expired` — write `needs_review` + alert.
- Readiness gate widened to all non-terminal statuses; the flip moved server-side; "Flip anyway" removed.
- `flipPaymentModel` must not null `customers.stripe_customer_id` for customers with a live hold; `place-deposit-hold` falls back to `rentals.deposit_hold_stripe_customer_id`.

  → **D2/D8's PM-propagation fix may not ship before this.** Before Gate 1 it writes a wrong-platform `pm_`, and without the `resource_missing` fix that becomes a silent terminal lie (S1).

**GATE 2 — state machine.** *Blocks the cron frequency increase and any batch-size change.*
- Optimistic concurrency (`.eq('deposit_hold_status', expected)`) on every write in refresh, capture, release, deduct.
- `release-deposit-hold` refuses `refreshing`; `place-deposit-hold` bails on `refreshing`.
- Non-terminal `refresh_failed` + attempt counter + error classification (transient / hard / systemic-abort).
- Idempotency keys from a monotonic attempt counter, not an enumerated prior-status set (fixes S3 and the `captured`/`failed` dead-ends).
- Sweeper for stale `refreshing`/`processing`; check the unchecked update at `refresh-deposit-holds:195-203`.

  → **D5's `0 */6 * * *` may not ship before this** (S8).

**GATE 3 — money semantics.** *Blocks turning the rebase on.*
- Capture routes to real charges via an explicit **non-damage category allowlist**, not plain FIFO (C5).
- Partial capture re-enabled, bounded by selected charges.
- `deduct-from-deposit` merged into `capture-deposit-hold`; rollover failure fatal.
- Amount floor at the network minimum; `capture_before` fallback dropped 7d → 4d.

**GATE 4 — disclosure.** *Must precede the FIRST rebased hold, not follow it.*
- `place-deposit-hold` is invoked from `booking-success` **before any agreement exists**, so the agreement can never be the sole notice vehicle → the checkout copy must carry the estimate + repeat-authorization notice.
- Fix the `security_deposit_amount` resolver; add an authorization clause to **all four** engines via `injectAgreementClauses` (22/37 tenants have their own template row).
- Persist `rentals.disclosed_hold_amount` at the moment the figure is rendered.

**GATE 5 — observability.** Heartbeat, invariant queries, `deposit_hold_events`, reconciler. **Reconciler after Gate 0 and Gate 1** (S7, S1).

**NEVER** until its gate is complete: raise cron frequency, enable rebasing, or start the UAE cutover for a hold-bearing tenant.

---

## 5. WHAT THE DESIGN CANNOT HANDLE — ESCALATE TO A HUMAN

**5.1 — GMT cannot migrate to UAE while the chained design is live.** 60–120 day rentals + a gate requiring zero live UK holds = the gate is essentially never green, and back-to-back rentals mean it may never go green at all. Three options, all bad: freeze new holds ~120 days before cutover (uncovered rentals in the gap); break chains mid-flight (**no path exists** — a PI, Customer and PaymentMethod cannot move between platform accounts, and re-authorizing on UAE needs a fresh on-session mandate the renter may never complete); or keep the UK platform, its keys, and every UK Connect account alive for 120 days past the last UK-anchored rental start. Nobody has costed the third, and the migration is described as in-flight *this week*. **This needs the migration owner, now, with the 120-day number attached.**

**5.2 — Debit-card stacking.** Cancel-first gaps coverage; create-first stacks 2–3× a rent-scale amount. Nothing in the codebase reads `card.funding`. Only commercial answers exist: refuse debit above 30 days, get GMT onto extended authorization (an IC+ pricing conversation with Stripe — MCC 7512 is a favoured category, so this is plausible and would cut 13–18 links to 3–4, which fixes more of this review than any code change), or fund the support cost.

**5.3 — Whether speculative fuel / mileage / late-return may be in the authorized amount at all** (V1). Both 5.7.2.4 and 5.8.8.4 exclude "other delayed charges." Counsel + acquirer, before the estimator is written.

**5.4 — What happens to a vehicle on the road when the chain dies unrecoverably** (hard decline, SCA never completed, closed card). Recall? Fee? Accept 60 unsecured days? No policy exists in code, docs, or this review.

**5.5 — Is a 90-day GMT rental one agreement or chained ≤30-day extensions?** If chained: the short-rental statutory scoping inverts, *and* `place-deposit-hold:52-65` blocks the hold on every one of them. Nobody has asked GMT. This single unanswered question determines whether the design is legal *and* whether it functions.

**5.6 — The auto-extend exclusion is now inverted and nobody has re-decided it.** `refresh-deposit-holds:130-155` releases on `auto_extend_enabled` because "renewal pricing replaces the deposit" — true for a damage buffer, false for an anticipated-charges hold, since auto-extend rentals are precisely the ones that fail to collect rent. Reversing it means re-litigating the RevTek/Jeffrey incident. Whichever way it goes, **the PM/customer columns must never be nulled on release** (S6).

**5.7 — Damage recovery after the rebase.** Table 5-19's delayed-charge workflow (documentation, repair quote, alternative-estimate right, 20-business-day wait, 90-day window) is 0% implemented, and the capture dialog's own placeholder still instructs operators to capture the hold for *"damage to rear bumper."* Removing damage from the hold without building the claim workflow leaves the fleet policy absorbing every loss including sub-deductible ones — an unpriced insurance decision, not an engineering gap.