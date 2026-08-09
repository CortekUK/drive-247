# GMT Gate 0 — manual test plan (deposit holds + Stripe webhooks)

Covers the Deno edge-function work that Vitest cannot execute:

| Build | What it changed |
|---|---|
| **B1** | `stripe-webhook-live`, `stripe-webhook-test`, `stripe-webhook` — a `payment_intent.canceled` for a deposit hold no longer cancels the rental; a `security_deposit_hold` checkout no longer books phantom revenue |
| **B2** | new `verify-deposit-hold`; `create-hold-checkout` and `place-deposit-hold` now probe Stripe before refusing on a stale `held` |

The portal-side work (B3) is covered by Vitest in `apps/portal/src/__tests__/` and is
**not** repeated here.

**Time budget: ~60 minutes.** Section 2 (~20 min) is the customer-facing fix and is the
one to run if you only have time for one.

---

## 0. Setup

### 0.1 Environment

Run everything in **Stripe test mode against the staging Supabase project**, never
production.

> ⚠️ Staging shares production's Stripe test account (`acct_1SqMGnB9wIYWaRK0`), so
> Stripe **webhooks fired by staging land on the production endpoint**. That means:
> - Steps that use the Stripe **CLI** (`stripe listen --forward-to <staging fn URL>`)
>   are safe — you control where the event goes.
> - Steps that rely on Stripe delivering a webhook *by itself* (completing a real
>   Checkout session) will hit prod's webhook, not staging's. Those steps are marked
>   **[CLI-forward required]** and tell you how to route them.

```bash
export SUPABASE_URL="https://<staging-ref>.supabase.co"
export SERVICE_KEY="<staging service_role key>"   # NOT the repo .env copy — that one is invalid and 401s misleadingly
export FN="$SUPABASE_URL/functions/v1"

# Deploy the changed functions to STAGING only
npx supabase functions deploy verify-deposit-hold  --project-ref <staging-ref>
npx supabase functions deploy create-hold-checkout --project-ref <staging-ref>
npx supabase functions deploy place-deposit-hold   --project-ref <staging-ref>
npx supabase functions deploy stripe-webhook-test  --project-ref <staging-ref>
```

Handy shell helpers:

```bash
sql() { psql "$STAGING_DB_URL" -qAt -c "$1"; }          # or run in the Supabase SQL editor
fn()  { curl -s -X POST "$FN/$1" -H "Authorization: Bearer $SERVICE_KEY" \
          -H 'Content-Type: application/json' -d "$2" | jq .; }
hold() { sql "select deposit_hold_status, deposit_hold_payment_intent_id, deposit_hold_amount,
               deposit_hold_expires_at, platform_account, payment_status, status
               from rentals where id='$1';"; }
```

### 0.2 Fixtures

Create on staging, under a tenant with `security_deposit_enabled = true` and a non-zero
`global_deposit_amount` (mirror GMT: tenant `ada84c6f-eb17-43b6-a14d-d16518165349`,
`stripe_mode='test'`):

| Ref | What | Why |
|---|---|---|
| **R-STALE** | Active rental, `deposit_hold_status='held'`, `deposit_hold_payment_intent_id` = a PI you will kill in §0.4 | GMT's actual broken state |
| **R-LIVE** | Active rental with a genuinely `requires_capture` hold | proves the fix does not open a door that should stay shut |
| **R-NONE** | Active rental, `deposit_hold_status` NULL, no PI | the untouched majority |
| **R-PENDING** | **Pending** rental with a normal (non-hold) PI in `payments` | the one case a cancel *should* still cancel |
| **R-ACTIVE** | **Active** rental with a normal (non-hold) PI in `payments` | must survive a cancel |

Every rental needs a customer with a saved card (`customers.stripe_customer_id` +
a default payment method) for §2.4 to work.

### 0.3 Test cards

| Card | Behaviour | Used in |
|---|---|---|
| `4242 4242 4242 4242` | succeeds, authorises cleanly | placing every hold |
| `4000 0000 0000 3220` | forces 3D Secure | §2.6 (`requires_action` → must be treated as *not* dead) |
| `4000 0000 0000 0341` | attaches fine, **fails when charged off-session** | §2.4 failure path |
| `4000 0000 0000 9995` | insufficient funds | optional: `failed` status |

Any future expiry, any CVC, any postcode.

### 0.4 How to force an expired authorization

A real Stripe authorization takes ~5–7 days to lapse. You cannot wait, and Stripe has no
"expire now" button — but **an expired authorization and a cancelled one are the same
object state**: `payment_intent.status = 'canceled'`, funds released. So cancel it, using
the reason Stripe itself uses for expiry:

```bash
# Cancel the hold PI exactly as an expiry would. --stripe-account only if the
# hold was placed on a connected account (check rentals.platform_account).
stripe payment_intents cancel pi_XXXX \
  --cancellation-reason=abandoned \
  --stripe-account acct_XXXX
```

Then confirm the DB is now **lying** — this is the bug, reproduced:

```bash
hold R-STALE
# expect: held | pi_XXXX | 500.00 | <some future date> | ...
stripe payment_intents retrieve pi_XXXX --stripe-account acct_XXXX | jq .status
# expect: "canceled"
```

`deposit_hold_status='held'` over a `canceled` PI **is** the state GMT is stuck in.
Everything below is measured against getting out of it.

---

## 1. B1 — `payment_intent.canceled` must not cancel rentals

Point the CLI at staging:

```bash
stripe listen --forward-to "$FN/stripe-webhook-test" \
  --events payment_intent.canceled,checkout.session.completed \
  --skip-verify   # staging fn verifies its own signature; use the printed whsec if it doesn't
```

Use `stripe events resend <evt_id>` for real events, or craft one with
`stripe trigger payment_intent.canceled --override payment_intent:metadata.type=deposit_hold`.

### 1.1 A released/expired hold leaves an Active rental alone ✅ core

1. Cancel R-LIVE's hold PI (§0.4). Stripe emits `payment_intent.canceled`.
2. Expected function log: `Ignoring payment_intent.canceled for deposit hold`.
3. Expected DB:

```sql
select status from rentals where id = 'R-LIVE';   -- Active   (NOT Cancelled)
```

**Before the fix**, if that PI also appeared in `payments.stripe_payment_intent_id`
(which `capture-deposit-hold` does write), the rental flipped to `Cancelled`.

### 1.2 Pre-metadata holds are caught too

Repeat 1.1 with a PI carrying **no** `metadata.type`, but whose id equals
`rentals.deposit_hold_payment_intent_id`.
Expect the same skip, logged as `(matched rentals.deposit_hold_payment_intent_id)`.

### 1.3 A genuine cancel still voids the payment row, but not an Active rental

Cancel R-ACTIVE's ordinary PI.

```sql
select status from rentals  where id = 'R-ACTIVE';                    -- Active
select status, capture_status, verification_status from payments
  where stripe_payment_intent_id = 'pi_ACTIVE';                       -- Refunded | cancelled | rejected
```

Log: `Payment cancelled; rental left untouched (status: Active)`.

### 1.4 The one case that must still cancel

Cancel R-PENDING's ordinary PI.

```sql
select status from rentals where id = 'R-PENDING';   -- Cancelled
```

Log: `Payment and rental cancelled from webhook`. If this stops working, the guard is
too wide and abandoned bookings will pile up as Pending.

### 1.5 Repeat on the live handler

`stripe-webhook-live` and `stripe-webhook` carry the same code. At minimum re-run **1.1**
and **1.4** forwarded to `$FN/stripe-webhook` (the legacy handler drifted furthest and
has its own `if (!rentalId) break;` above the new branch).

---

## 2. B1/B2 — placing, syncing and reconciling a hold

### 2.1 A hold checkout no longer books phantom revenue ✅ core **[CLI-forward required]**

1. In the portal open R-NONE → Payment Breakdown → Security Deposit → **Add Hold** →
   **Place via Stripe**. Complete with `4242…`.
2. **Close the tab before the redirect** — this is the orphan case the webhook now covers.
3. Make sure the resulting `checkout.session.completed` reaches *staging*
   (`stripe events resend <evt_id> --forward-to "$FN/stripe-webhook-test"`).
4. Expected DB:

```sql
select deposit_hold_status,            -- held
       deposit_hold_payment_intent_id, -- pi_...
       deposit_hold_amount,            -- the deposit, in major units
       deposit_hold_expires_at,        -- the charge's real capture_before, NOT now()+7d
       platform_account,
       payment_status                  -- UNCHANGED (must NOT be 'fulfilled')
  from rentals where id = 'R-NONE';

select count(*) from payments where stripe_checkout_session_id = 'cs_...';
-- MUST be 0. Before the fix this inserted a Completed/captured row for the full
-- uncaptured amount and ran apply-payment FIFO against real rent charges.

select stripe_customer_id from customers where id = '<R-NONE customer>';  -- backfilled
```

Log: `Deposit hold checkout completed for rental: …` then `Deposit hold recorded: pi_… amount: …`.

### 2.2 Redelivery is idempotent

Resend the same `checkout.session.completed`.
Expect `Deposit hold sync skipped: hold_already_held` and **no** further DB change
(re-run both queries from 2.1; the `payments` count is still 0).

### 2.3 `verify-deposit-hold` tells the truth ✅ core

```bash
fn verify-deposit-hold '{"rentalId":"R-STALE"}'
```

| Fixture | Expected response | Expected DB after |
|---|---|---|
| **R-STALE** (dead PI) | `{ verified:true, liveHold:false, status:"expired", changed:true, expiresAt:null }` | `deposit_hold_status='expired'` |
| **R-STALE**, called again | identical but `changed:false` | unchanged (proves it does not thrash the row) |
| **R-LIVE** | `{ verified:true, liveHold:true, status:"held" }`, `expiresAt` == the charge's `capture_before` | `deposit_hold_expires_at` re-synced |
| **R-LIVE**, called again | `changed:false` | unchanged — if `changed` is `true` every time, the expiry comparison has regressed to a string compare |
| **R-NONE** | `{ verified:true, liveHold:false, status:null, changed:false }` | unchanged; **no Stripe call at all** |
| PI id from another account | `{ verified:false, needsReview:true }` | **unchanged** — this is the case where guessing either strands a real hold or double-charges |

To build the last row: `update rentals set deposit_hold_payment_intent_id='pi_3NonExistent000000000000' where id='R-STALE';`
(remember to put it back).

### 2.4 The actual GMT unblock ✅ core

With R-STALE back in its broken state (`held` + dead PI):

```bash
fn create-hold-checkout '{"rentalId":"R-STALE","successUrl":"https://example.com/ok","cancelUrl":"https://example.com/no"}'
```

- **Before**: `{"skipped":"hold_already_active"}` — the dead end.
- **Now**: a Checkout `url`, plus the log line
  `stale hold on rental … corrected held -> expired; placing a fresh hold`, and

```sql
select deposit_hold_status from rentals where id='R-STALE';   -- expired
```

Then the off-session path (this is what the Charge dialog's **Refresh hold** button calls):

```bash
fn place-deposit-hold '{"rentalId":"R-STALE","manualOverride":true}'
```

Expect success and `deposit_hold_status='held'`, with a **different** PI id:

```sql
select deposit_hold_payment_intent_id from rentals where id='R-STALE';
```

> If the new PI id equals the dead one, the Stripe **idempotency key replayed** — the
> re-collection suffix (`deposit-hold-<rentalId>-recollect-<status>-<deadPi>`) has
> regressed. That is the silent failure mode here: the operator is told the hold was
> placed while no new authorization exists.
>
> If it instead returns `Hold slot already claimed (status=expired)`, `priorHoldStatus`
> stopped tracking the correction and the atomic claim is looking for the old value.

### 2.5 A real hold is still refused

```bash
fn create-hold-checkout '{"rentalId":"R-LIVE","successUrl":"https://example.com/ok","cancelUrl":"https://example.com/no"}'
# -> {"skipped":"hold_already_active"}   and NOTHING written
fn place-deposit-hold '{"rentalId":"R-LIVE"}'
# -> {"success":true,"alreadyHeld":true}
```

Placing a second authorization here would hold the customer's card twice.

### 2.6 Mid-flight authorisations are not declared dead

Place a hold with `4000 0000 0000 3220` (3DS) and abandon the challenge, so the PI sits
at `requires_action`.

- `verify-deposit-hold` → `liveHold:false`, **`changed:false`**, DB untouched.
- `create-hold-checkout` / `place-deposit-hold` → still skip (treated as alive).

The two disagree on wording but agree on the only thing that matters: **change nothing,
authorise nothing**.

### 2.7 Third re-collection

Kill the hold from 2.4 and place again. Expect a **third distinct** PI id. This is what
folding the dead PI id into the idempotency key buys over a fixed `-recollect` suffix.

---

## 3. Regression sweep — the other 27 tenants (~10 min)

Note the two functions report skips differently: `create-hold-checkout` returns a machine
code (`{"skipped":"deposit_disabled_for_tenant"}`, which the portal maps to plain English),
while `place-deposit-hold` returns `{"success":true,"skipped":true,"message":"…"}`. Check
both shapes.

| Case | `create-hold-checkout` | `place-deposit-hold` |
|---|---|---|
| Tenant with `security_deposit_enabled=false` | `skipped:"deposit_disabled_for_tenant"` | `"Security deposit is disabled for this tenant"` |
| Rental with `auto_extend_enabled=true` | `skipped:"auto_extend_rental"` | `"Auto-extend rental — deposit hold skipped…"` |
| Rental with `deposit_amount_override = 0` | `skipped:"deposit_amount_is_zero"` | `"Deposit amount is 0"` |
| Brand-new booking, end to end | webhook calls `place-deposit-hold`, first hold lands on a `deposit_hold_status IS NULL` rental with an **unsuffixed** idempotency key |
| Rental whose tenant row is missing | now returns `404 Tenant not found` **before** the already-held skip (deliberate ordering change; no production tenant is in this state) |

### 3.1 Concurrency

Fire simultaneously at the same rental:

```bash
fn verify-deposit-hold '{"rentalId":"R-LIVE"}' &
fn capture-deposit-hold '{"rentalId":"R-LIVE","amount":500,"reason":"test"}' &
wait
```

`verify` must never re-assert `held` over the capture. The losing call returns
`changed:false` with *"Another update changed this deposit hold while it was being
checked."*

---

## 4. Sign-off

- [ ] 1.1 expired/released hold does **not** cancel an Active rental
- [ ] 1.4 an ordinary cancelled PI **still** cancels a Pending rental
- [ ] 2.1 hold checkout writes `deposit_hold_*` and **zero** `payments` rows
- [ ] 2.3 `verify-deposit-hold` correct on all six fixtures, idempotent on repeat
- [ ] 2.4 R-STALE goes stale-`held` → `expired` → fresh `held` with a **new** PI id
- [ ] 2.5 a live hold is still refused on both paths
- [ ] 3 all four skip codes unchanged; a normal booking still places its first hold

Record the PI ids from 2.4 and 2.7 in the sign-off — they are the evidence that the
idempotency key is doing its job, and it is the part most likely to regress silently.

---

## Appendix — known test-infrastructure gap

`apps/portal` cannot render components under Vitest today. It pins **React 18.3.1** while
the monorepo root hoists **React 19** for `admin`/`web`, so every root-hoisted UI package
(`@radix-ui/*`, `lucide-react`, `@tanstack/react-query`, `react-hook-form`) resolves
`react` to the root copy and hands React-19 elements to portal's React-18 renderer
(*"Objects are not valid as a React child"*). `@testing-library/react`'s
`@testing-library/dom` peer is also absent.

Because of that, the portal suites in `apps/portal/src/__tests__/` execute the extracted
pure helpers for real (`describeHoldExpiry`, `formatHoldExpiry`, the skip-message table)
and assert the surrounding state wiring against source. To upgrade them to real render
tests:

```ts
// apps/portal/vitest.config.ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
    react: path.resolve(__dirname, './node_modules/react'),
    'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
  },
},
```

plus `npm i -D @testing-library/dom -w apps/portal`. Neither was done here — both are
outside the deposit-hold change set.
