# Payments unification — the remaining work, and how it will be built

**Status:** Sep 26 2026, branch `haseeb/payment-unification`. Slice 1 (payment
plans) and slice 2 (Finances) are built, tested and committed; nothing is
applied to production or deployed. This document is the plan for everything
else in `docs/PAYMENT_PLANS_UNIFIED_SPEC.md` — 12 points partly done and 6 not
started (coverage table: §6 below). Each wave is built, verified by an
independent reviewer, and committed before the next begins.

Where the lead has not decided something, the work proceeds under a stated,
reversible **assumption** (§1). Each is one setting or one small switch to
change; none is buried.

---

## 1. Assumptions made to keep building (the lead may overturn any)

| # | Open question (spec §13) | Assumption | Why this one | Cost to reverse |
|---|---|---|---|---|
| A1 | Off-platform credit — revenue or display? | **Two operations, told apart by one question**: money that really changed hands outside the platform is an *off-platform payment* (a normal payment row flagged `is_off_platform`, so it counts as revenue like cash and is excluded from Stripe/Square reconciliation, badged "Off-platform"); a goodwill reduction is a *balance adjustment* (a negative, reason-coded Adjustment charge — no revenue). "Display-only" is not offered: it would make the shown balance disagree with the real one, which §5.4 exists to prevent. | Research E3: every mature system separates money received from credit granted (Stripe cash balance vs credit balance; Chargebee refundable vs adjustment credits) | the flag column + one label |
| A2 | Customer-created plans | The operator enables **plan templates** in Settings (e.g. "weekly on the rental's weekday", "3 equal payments"); on the booking site the customer picks one at checkout; the first payment at checkout saves the card for later charges. Customers never write a free-form schedule. | Keeps §2's "a customer can create a plan" without letting a stranger define a charge schedule | a Settings switch per tenant |
| A3 | Extension inside a plan — who moves the end date? | **Renewal periods move the end date after the period is paid** (auto-extend's proven order). The operator's **Extend** action on the plan asks one question: "Give the days now and collect on the plan" (manual-extension order) or "Give the days when paid". | Both orders exist today and both are wanted; making it an explicit choice removes the silent difference research found | default choice |
| A4 | Bonzah on extended periods | Before charging a period that includes insurance, **buy that period's policy** through the existing quote → confirm path; if Bonzah cannot cover it (the Pacific-tomorrow rule), **charge no premium** and alert the operator. Never charge a premium without a policy. | Today auto-extension charges a premium and buys nothing — a live defect in waiting | none — this is a fix |
| A5 | Agreement on extension | Plan setting "Send an extension agreement for each new period": **on** for an operator's Extend, **off** for automatic renewals, changeable. Uses the existing `extension` agreement template (falls back to standard, as today). | Today manual always sends (never asked), automatic never sends; the lead asked "should we ask?" — yes | the default |
| A6 | Testing environment | **Two tiers from one scenario list**: a local full stack (Docker Supabase + real edge functions + Stripe test mode via the Stripe CLI) for development and repeatable runs; and a **northwind live runner** in the Developer tab (Stripe test mode only, fixture-flagged rentals only, server-side guards) so the lead can press the buttons himself. The live runner is built but **not run** until approved. | §9: "however you test it, make sure I can test it that same way" | — |

**Needed from people, not code:** Docker running on the dev machine and a Stripe
**test** key (`sk_test_…`/`rk_test_…`, never live) for the local tier; the
lead's yes to A1–A6; approvals to apply migrations and deploy.

---

## 2. Waves

### Wave 1 — balance and the customer (spec §8, §7 fine element, §3 method per payment)
- **Adjust balance panel** on the v2 rental and the v2 customer, three
  operations behind one "What happened?" question (A1): *correct a charge*
  (credit or debit against a specific charge), *money received outside the
  platform* (off-platform payment), *goodwill adjustment* (signed Adjustment
  with reason code and internal note). Append-only; undone only by a reversing
  entry; every one shows in Finances and the customer's statement with who,
  when and why. Reuses `adjust-customer-balance` (it already accepts
  `rentalId`/`extensionId`, which no screen sent) and the record-payment path.
- **Request a payment "for" something** from the customer tab: amount + "what
  it's for" → the charge carries that text as its reference, then the existing
  link flow sends it.
- **Scoped Finances**: the same Billed / Received / Fines views on the rental
  (its **fines section**, spec §7) and on the customer (balance first — "how
  much does this customer owe me").
- **Per-payment method** on the plan card (the hook exists).
- Friendly refusal text on the old auto-extend / PAYG / installment screens
  when a plan is live.

### Wave 2 — reconciliation without blockers (spec §5.3)
- **Reallocate a payment** (move money from one charge to another), as one
  atomic SQL function with an audit trail (who, why, before, after) — never a
  silent delete.
- **"Reconcile this bill"** for a bill that doesn't add up: shows the gap and
  offers the fixes that make it tie out (re-link a payment, record an
  adjustment), each through the operations above.
- **Deposits in the transaction view**: holds, captures and releases visible
  in Received and the side panel.

### Wave 3 — the green line: extension and auto-extension on the plan (spec §4, §6)
- Engine: **open-ended plans** that post each period's charges and move the
  end date (A3), with the insurance (A4) and agreement (A5) rules; one more
  stage in the same cron.
- Plan card **Extend** action; create flow becomes *Fixed dates* ·
  *Payment plan* (with "keeps renewing until stopped" as an answer in the same
  form — not a separate card).
- **Shadow comparison** for existing auto-extend rentals: the engine computes
  what it would charge next to what the old job charges, for review before any
  rental is moved. Moving RevTek's rentals is an operations step with its own
  approval.

### Wave 4 — end-to-end testing (spec §9, §1, §6 "verify simple booking first")
- One scenario list across **simple booking, manual extension, auto-extend,
  PAYG, installments and payment plans**, plus cron safety (overlap, crash
  after charge, double webhook) and a Finances tie-out after every scenario.
- Tier 1 local full stack; tier 2 northwind live runner in the Developer tab
  with a results table the lead can reopen (A6).

### Wave 5 — customer-created plans (spec §2, A2)
- Settings: plan templates; booking checkout: choose a template; customer
  portal: see the schedule, pay the next payment, request a change.

---

## 3. Strategy rules every wave follows
1. **Canary first** (northwind, by slug); other tenants unchanged, proven by tests.
2. **No silent money path**: new money-writing code only as SQL functions that
   assert their row counts, with an audit trail, tested on real Postgres
   (PGlite) and mutation-proven; the UI reuses live mutations wherever one exists.
3. **Evidence, not assurance**: expected values hand-derived; every wave ends
   with an independent verifier and real test counts.
4. **Nothing applied or deployed** without an explicit approval; migrations
   are files, functions are source.
5. **Plain language** everywhere; never PAYG / installment / FIFO on screen.

## 4. Order and why
Wave 1 first because it is visible and low-risk (reuses live paths). Wave 2
before Wave 3 because reconciliation is how an operator recovers from any
mistake the engine change could make. Wave 3 is the riskiest (live RevTek
money) and goes behind a shadow comparison. Wave 4 runs across everything built
before it. Wave 5 last because it touches the customer-facing booking site.

## 5. Not code
Rotate the Supabase token and the platform secret in cron jobs 57/63; apply the
credit-view remediation; deploy the pending edge functions — each needs its owner.

## 6. Coverage after all waves
All 30 points in the coverage review of Sep 26 2026, with A1–A6 as the
lead-confirmable choices; Square's per-payment dashboard link stays a
documented reference (Square publishes no per-payment URL).
