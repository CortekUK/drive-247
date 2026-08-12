# Drive247 — Chained Authorization Hold: Implementation Spec

**Scope:** tenant GMT (`ada84c6f-eb17-43b6-a14d-d16518165349`), live Connect `acct_1SrIFEPcUIaEGCY0`, direct charges, 60–120 day rentals.
**Status:** design spec, not yet built. Every file:line below was verified against the working tree at commit `c1a0dbbe`.
**Migration rule:** all DDL in §3 is applied via `mcp__supabase__*` tools. **Do not write files into `supabase/migrations/`.**

---

# 1. The design in one page

## What we are building

At key handover we place a manual-capture PaymentIntent — a Visa **Estimated Authorization Request** — for the renter's **anticipated charges**. Because a card authorization expires long before a 90-day rental ends, a cron cancels the incumbent and places a replacement before each deadline. The rental therefore carries a **chain** of authorizations, not one.

Four things change from today:

1. **The amount is rebased.** It represents unpaid and anticipated **rent**, not a damage buffer. (Read §6 and §8 first: the other three components the design names — fuel, mileage overage, late return — are *not* cleared for inclusion.)
2. **Damage leaves the hold entirely**, to an LDW/CDW waiver backed by fleet physical-damage insurance.
3. **Every link is disclosed** before it happens: the estimated amount, that subsequent authorization requests will be submitted, and that damage is not covered.
4. **The chain is observable**: an append-only per-link ledger, a reconciler that reads Stripe back, and a heartbeat that distinguishes "healthy" from "the cron never ran".

## Why the current code cannot carry it

The existing implementation stores a **chain in a single mutable row**. `refresh-deposit-holds/index.ts:195-203` overwrites `deposit_hold_payment_intent_id` in place; there is no history table, no attempt counter, no error field, no connect-account anchor, no verified-against-Stripe timestamp. `refresh-deposit-holds/index.ts:213-216` writes terminal `'expired'` on **every** error class, and the driver at `:53` selects only `'held'` — so one bad night ends a chain permanently and silently. Multiplying cancels 13–18× per rental also arms `stripe-webhook-live/index.ts:1274-1310`, which turns any `payment_intent.canceled` on a PI with a `payments` row into `rentals.status = 'Cancelled'`.

## Invariants — must ALWAYS hold

| # | Invariant | Enforced by |
|---|---|---|
| **I1** | A live Stripe authorization is always reachable from the DB. No `requires_capture` PI with `metadata.rental_id` may exist without a matching `deposit_hold_links` row. | `deposit_hold_links` written **before** the Stripe call; reconciler orphan sweep (§5 step 12) |
| **I2** | `deposit_hold_status = 'held'` ⟹ `deposit_hold_expires_at IS NOT NULL AND > now()`. Count of violations must be 0. | CHECK constraint + invariant cron (§5 step 11) |
| **I3** | Every Stripe operation on an existing hold uses the **account, mode and currency the hold was created under** — never the tenant's current values. | `deposit_hold_connect_account_id` / `_stripe_mode` / `_currency` (§3) |
| **I4** | No terminal status is ever written on an error we cannot classify. `resource_missing` and unclassified Stripe errors write `needs_review`, never `released`/`expired`. | `release-deposit-hold`, `refresh-deposit-holds` error taxonomy (§5 step 4) |
| **I5** | A deposit-hold PaymentIntent never causes a rental status change. | Guard at the top of all three `payment_intent.canceled` handlers (§5 step 1) |
| **I6** | `rentals.deposit_hold_payment_method_id` / `_stripe_customer_id` are **never nulled** while `auto_extend_enabled = true`. They are the only card-on-file registry `auto-extend-rentals/index.ts:547,565-566` reads. | Code comment + reconciler assertion |
| **I7** | The amount authorized never exceeds `rentals.disclosed_hold_amount` without a fresh renter notice recorded in `deposit_hold_links.disclosure_ref`. | `refresh-deposit-holds` rebase branch (§5 step 9) |
| **I8** | No capture is ever booked against a `Damage` category, and no capture reason may name damage. | Category allowlist + server-side tripwire (§5 step 8) |
| **I9** | The chain stops. `deposit_hold_chain_expires_at` is non-null on every `held` row and the cron refuses to re-authorize past it. | Driver predicate (§5 step 5) |
| **I10** | Exactly one code path performs a per-rental refresh. `sandbox-refresh-deposit-holds` imports it; it does not copy it. | `_shared/deposit-hold-refresh.ts` (§5 step 0) |

---

# 2. The state machine

`rentals.deposit_hold_status`. Current CHECK (`supabase/migrations/20260527010000_expand_deposit_hold_status_values.sql:15-23`) allows exactly: `processing | held | captured | released | expired | refreshing | failed`.

## 2.1 States

| State | Class | Meaning | Written by (after this spec) |
|---|---|---|---|
| `NULL` | initial | Never placed | migration default |
| `processing` | **claim** | Placement in flight. Set before the Stripe call. | `place-deposit-hold` |
| `refreshing` | **claim** | Refresh in flight. Set before the cancel. | `refresh-deposit-holds` |
| `capturing` | **claim — NEW** | Capture in flight. | `capture-deposit-hold` |
| `held` | **live** | An authorization exists and is capturable | place / refresh / capture(rollover, multicapture) / reconciler |
| `requires_action` | **recoverable — NEW** | Issuer demanded SCA. PI exists, not capturable. Customer action required. | place / refresh |
| `failed` | **recoverable (redefined)** | Transient decline or transient infra error. Retried with backoff. | place / refresh / `stripe-webhook-live:1176-1180` |
| `needs_review` | **recoverable — NEW** | DB/Stripe divergence we cannot safely resolve (e.g. `resource_missing`, suspected wrong account). Human or reconciler only. | release / refresh / reconciler |
| `disputed` | **frozen — NEW** | Chargeback on a hold. Capture and deduct are blocked. | `charge.dispute.created` handler |
| `expired` | terminal | Authorization confirmed dead at Stripe and not replaceable automatically | reconciler / capture self-heal (`capture-deposit-hold:99-102`) |
| `released` | terminal | Cancel **confirmed** by Stripe (or PI confirmed absent on BOTH platform accounts) | release / auto-extend branch |
| `captured` | terminal | Fully consumed, remainder zero | capture |

`failed` is deliberately **not** terminal. Today it is a dead end: the driver at `refresh-deposit-holds/index.ts:53` ignores it, and a manual retry from `place-deposit-hold` reuses the bare key `deposit-hold-${rentalId}` because the recollect suffix at `:276` only special-cases `expired`/`released` — so Stripe replays the cached decline for 24h.

## 2.2 Legal transitions

```
NULL ──────────────► processing ──┬─► held            (PI requires_capture)
                                  ├─► requires_action (SCA)
                                  ├─► failed          (transient decline / infra)
                                  └─► NULL            (hard decline, PI explicitly cancelled)

held ──► refreshing ──┬─► held           (replacement confirmed + DB write confirmed)
                      ├─► requires_action
                      ├─► failed         (retryable; incumbent NOT cancelled — see §5.3)
                      ├─► needs_review   (resource_missing / unclassified)
                      └─► released       (auto-extend branch, or chain_expires_at reached)

held ──► capturing ──┬─► held      (multicapture or rollover succeeded; amount decremented)
                     ├─► captured  (remainder 0)
                     └─► needs_review (capture succeeded, DB write failed)

held ──► released    (release confirmed)
held ──► disputed    (charge.dispute.created)
held ──► expired     (reconciler observes PI canceled/expired at Stripe)

requires_action ──┬─► held          (customer completed on-session confirmation)
                  ├─► failed        (timeout, N days)
                  └─► released      (operator abandons)

failed ──┬─► processing / refreshing  (retry, attempt_seq incremented)
         └─► expired                  (failure_count >= 5 AND expires_at passed)

needs_review ──┬─► held | released | expired   (reconciler or human, after Stripe truth established)

disputed ──► released | captured   (dispute closed; human)

captured / released / expired ──► processing   (deliberate re-collection; attempt_seq incremented)
```

**Every transition out of a claim state is guarded**: the update carries `.eq("deposit_hold_status", <expected>)` and, where the PI matters, `.eq("deposit_hold_payment_intent_id", <expected>)`. Zero rows updated ⟹ another worker owns the row ⟹ cancel anything just created at Stripe and abort. None of these guards exist today (`refresh-deposit-holds/index.ts:84-87`, `:195-203`, `:213-216` are all bare `.eq("id", …)`).

## 2.3 Stuck-claim recovery

Claim states have no timeout today and nothing sweeps them. `refreshing` is written at `refresh-deposit-holds/index.ts:86` *before* the cancel at `:117`; any interruption strands the row forever, invisible to the driver (`:53`), to `place-deposit-hold` (`:79-81` returns `alreadyHeld` for `processing`), to `capture-deposit-hold` (`:45-47` refuses), and to the portal (`rentals/[id]/page.tsx:3367-3378` renders **"No Hold"**).

Rule: any row in `processing | refreshing | capturing` whose `deposit_hold_status_changed_at < now() - interval '30 minutes'` is handed to the reconciler, which reads Stripe and resolves to truth. Never guess.

---

# 3. Schema changes

> Apply via `mcp__supabase__apply_migration`. Do **not** create files under `supabase/migrations/`.
> **anon grants:** `public.tenants` has **column-level** grants to `anon` (`supabase/migrations/20260723090000_lock_down_tenants_rls.sql:26`). Any new `tenants` column read by the booking app needs an explicit `GRANT SELECT (col) ON public.tenants TO anon` or the whole booking query 403s and every site falls back to default branding. `public.rentals` has **no** anon grant — new `rentals` columns need none.

## 3.1 Widen the status CHECK (do this first — several later writes violate the current one)

```sql
ALTER TABLE public.rentals DROP CONSTRAINT IF EXISTS rentals_deposit_hold_status_check;
ALTER TABLE public.rentals ADD CONSTRAINT rentals_deposit_hold_status_check
  CHECK (deposit_hold_status IS NULL OR deposit_hold_status = ANY (ARRAY[
    'processing','refreshing','capturing',
    'held','requires_action','failed','needs_review','disputed',
    'captured','released','expired'
  ]::text[]));
```

## 3.2 `rentals` — anchoring, diagnostics, disclosure

```sql
-- I3: anchor the Stripe context to the RECORD, never re-derive from the tenant.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_connect_account_id text,
  ADD COLUMN IF NOT EXISTS deposit_hold_stripe_mode        text,
  ADD COLUMN IF NOT EXISTS deposit_hold_currency           text;
ALTER TABLE public.rentals
  ADD CONSTRAINT rentals_deposit_hold_stripe_mode_check
  CHECK (deposit_hold_stripe_mode IS NULL OR deposit_hold_stripe_mode IN ('test','live'));

-- State machine + retry
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_attempt_seq       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_hold_failure_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_hold_last_error        text,
  ADD COLUMN IF NOT EXISTS deposit_hold_last_error_code   text,
  ADD COLUMN IF NOT EXISTS deposit_hold_next_retry_at     timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_verified_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_hold_release_requested_at timestamptz;

-- Expiry provenance + granted window (nothing records these today)
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_expiry_source  text,
  ADD COLUMN IF NOT EXISTS deposit_hold_extended_auth  boolean,
  ADD COLUMN IF NOT EXISTS deposit_hold_window_seconds integer,
  ADD COLUMN IF NOT EXISTS deposit_hold_chain_expires_at timestamptz;
ALTER TABLE public.rentals
  ADD CONSTRAINT rentals_deposit_hold_expiry_source_check
  CHECK (deposit_hold_expiry_source IS NULL
         OR deposit_hold_expiry_source IN ('stripe_capture_before','fallback'));

-- Card identity — so "which card is this on" is answerable, and debit is detectable
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_card_brand     text,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_last4     text,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_exp_month smallint,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_exp_year  smallint,
  ADD COLUMN IF NOT EXISTS deposit_hold_card_funding   text;

-- Rebase target vs what is actually authorized right now
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_hold_target_amount numeric(10,2);

-- Disclosure (Visa 5.7.2.4): the figure the renter was actually shown, when
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS disclosed_hold_amount  numeric(10,2),
  ADD COLUMN IF NOT EXISTS disclosed_hold_at      timestamptz,
  ADD COLUMN IF NOT EXISTS disclosed_hold_version text,
  ADD COLUMN IF NOT EXISTS disclosed_hold_source  text;  -- 'checkout' | 'agreement' | 'notice'

-- Fix the unconstrained override (20260527020000 added a bare `numeric`)
ALTER TABLE public.rentals ALTER COLUMN deposit_amount_override TYPE numeric(10,2);
ALTER TABLE public.rentals ADD CONSTRAINT rentals_deposit_amount_override_check
  CHECK (deposit_amount_override IS NULL OR deposit_amount_override >= 0);

-- I2 (add AFTER the backfill in §5 step 12, or it will fail on legacy rows)
-- ALTER TABLE public.rentals ADD CONSTRAINT rentals_held_needs_expiry
--   CHECK (deposit_hold_status <> 'held' OR deposit_hold_expires_at IS NOT NULL);
```

**Indexes** — none exist today (`grep CREATE INDEX supabase/migrations | grep deposit_hold` is empty):

```sql
CREATE INDEX IF NOT EXISTS idx_rentals_hold_due
  ON public.rentals (deposit_hold_expires_at)
  WHERE deposit_hold_status IN ('held','failed','refreshing','processing','capturing','requires_action');

CREATE INDEX IF NOT EXISTS idx_rentals_hold_open
  ON public.rentals (tenant_id, deposit_hold_status)
  WHERE deposit_hold_status IS NOT NULL
    AND deposit_hold_status NOT IN ('released','captured','expired');
```

## 3.3 `deposit_hold_links` — the authorization ledger (new)

One row per link. Written **before** the Stripe call so a crashed attempt is still discoverable by idempotency key. This is the substrate the reconciler, the operator panel, the renter timeline and any dispute-evidence packet all need.

```sql
CREATE TABLE IF NOT EXISTS public.deposit_hold_links (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id              uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  tenant_id              uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  attempt_seq            integer NOT NULL,
  action                 text NOT NULL,   -- place|refresh|rollover|capture|release|fail
  payment_intent_id      text,
  superseded_pi_id       text,
  platform_account       text,            -- 'uk' | 'uae'
  connect_account_id     text,
  stripe_mode            text,
  amount_cents           integer,
  currency               text,
  idempotency_key        text,
  estimate_inputs        jsonb,
  disclosed_amount       numeric(10,2),
  disclosure_ref         text,            -- notification/agreement id backing I7
  capture_before         timestamptz,
  extended_auth_status   text,
  card_funding           text,
  outcome                text,            -- pending|succeeded|failed|orphaned
  error_code             text,
  error_message          text,
  actor                  text,            -- 'cron' | app_user_id | 'webhook' | 'reconciler'
  created_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  UNIQUE (rental_id, attempt_seq, action)
);

CREATE INDEX idx_dhl_rental   ON public.deposit_hold_links (rental_id, created_at DESC);
CREATE INDEX idx_dhl_pi       ON public.deposit_hold_links (payment_intent_id);
CREATE INDEX idx_dhl_pending  ON public.deposit_hold_links (created_at) WHERE outcome = 'pending';

ALTER TABLE public.deposit_hold_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY dhl_tenant_read ON public.deposit_hold_links FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
-- writes: service_role only (edge functions). No anon grant.
```

## 3.4 `cron_runs` — heartbeat (new)

There is no heartbeat table anywhere under `supabase/`. `pg_cron` invokes via `net.http_post`, which records `succeeded` as soon as the request is *queued* — so "ran and refreshed 40 holds", "returned 500", and "job does not exist" are indistinguishable. Commit `9ab190f2` records this cron being silently unscheduled once already.

```sql
CREATE TABLE IF NOT EXISTS public.cron_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  total_due    integer,
  processed    integer,
  succeeded    integer,
  failed       integer,
  truncated    boolean DEFAULT false,
  error        text
);
CREATE INDEX idx_cron_runs_job ON public.cron_runs (job_name, started_at DESC);
```

## 3.5 `rental_card_mandates` — persisted card-on-file consent (new)

The checkout mandate text is rendered at `apps/booking/src/app/booking/checkout/page.tsx:1079`, `BookingCheckoutStep.tsx:1765`, `BookingCheckout.tsx:611` and Zod-required — but **nothing persists it** (every reference to `agreeCharges` is `setFormData` or error rendering). Contrast `sms_consent`, which *is* persisted for A2P 10DLC. A chain of 13–18 MITs with no stored consent record has nothing to represent with.

```sql
CREATE TABLE IF NOT EXISTS public.rental_card_mandates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id         uuid REFERENCES public.rentals(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_method_id text,
  card_brand        text,
  card_last4        text,
  mandate_version   text NOT NULL,
  mandate_text      text NOT NULL,
  disclosed_amount  numeric(10,2),
  source            text NOT NULL,   -- 'booking_checkout' | 'agreement' | 'portal_update'
  signed_document_id uuid,
  accepted_at       timestamptz NOT NULL DEFAULT now(),
  invalidated_at    timestamptz,
  invalidated_reason text            -- 'card_brand_change' | 'pm_replaced' | 'platform_migrated'
);
CREATE INDEX idx_rcm_customer ON public.rental_card_mandates (customer_id, accepted_at DESC);
ALTER TABLE public.rental_card_mandates ENABLE ROW LEVEL SECURITY;
```

## 3.6 `damage_claims` — hangs off the existing damage report (new; gated on §8-D3)

`rental_damage_reports` already exists (`supabase/migrations/20260502120000_add_rental_damage_reports.sql:6`, UNIQUE on `rental_id`) with `findings jsonb`, `overall_severity`, `has_new_damage`, photo counts and reviewer fields. It is the natural evidence artifact for a Visa **Table 5-19** delayed charge. Do not duplicate it.

```sql
CREATE TABLE IF NOT EXISTS public.damage_claims (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id               uuid NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  damage_report_id        uuid REFERENCES public.rental_damage_reports(id),
  description             text NOT NULL,
  quote_document_url      text,
  quoted_amount           numeric(10,2),
  renter_notified_at      timestamptz,
  alternative_estimate_deadline timestamptz,   -- notified_at + 20 business days
  charge_window_expires_at timestamptz,        -- return_date + 90 calendar days
  waiver_applies          boolean DEFAULT false,
  status                  text NOT NULL DEFAULT 'open',
  charged_at              timestamptz,
  stripe_payment_intent_id text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.damage_claims ENABLE ROW LEVEL SECURITY;
```

## 3.7 Ledger category — capture must settle real charges

`payment_apply_fifo_v2` (`supabase/migrations/20260603120000_fifo_v2_generic_pays_extension.sql:85-99`) has a 13-row `cat_order` that contains **no** `Security Deposit`, **no** `Excess Mileage`, **no** `Damage`. Categories absent from `cat_order` are dropped by the JOIN and are unpayable by any ordinary payment.

Add `Excess Mileage` (priority 12.5, i.e. renumber) to `cat_order`. **Do not** add `Security Deposit` — the fix is to stop minting synthetic deposit charges, not to make FIFO pay them (§5 step 8). **Do not** add `Damage` to `cat_order` at all: a FIFO-routed hold capture would then silently pay a damage charge, which is exactly the Visa violation the rebase exists to remove (I8).

**Do not rename the `'Security Deposit'` category value.** It is a data value matched by string equality in ~20 places (`PaymentBreakdown.tsx:303`, `rentals/[id]/page.tsx:2572,3054,3195,3467,3491,3536,3548`, `capture-deposit-hold:249,283`, `deduct-from-deposit:69,74`) plus an `invoices.security_deposit` column. Change the *presentation label* only.

---

# 4. Edge-case register

Ranked by severity × likelihood. **P0** = ship-blocking. **P1** = must land before the rebase is switched on. **P2** = must land before GMT-wide rollout. **P3** = accepted or deferred with a reason.

| ID | Trigger | What breaks | Handling | Where | Status |
|---|---|---|---|---|---|
| **EC-01** | Any hold PI with a `payments` row is cancelled — nightly refresh (`refresh-deposit-holds:117`), release (`release-deposit-hold:72`), `cancel-rental-refund:302`, or Stripe auto-expiry | `stripe-webhook-live:1279-1283` finds the payments row, marks it `Refunded`/`cancelled`/`rejected`, then `:1297-1305` sets `rentals.status='Cancelled'` on a live 90-day rental. Vehicle re-listed, dunning stops, revenue reversed. Rows are armed by `capture-deposit-hold:229` and by EC-02 | Bail out at the top of the handler when `pi.metadata.type IN (deposit_hold, deposit_hold_rollover, security_deposit_hold)` **and** when `pi.id = rentals.deposit_hold_payment_intent_id` for `metadata.rental_id` (compare ids — the DB may already point at the replacement). Independently hard-gate rental cancellation on `rental.status='Pending'` | `stripe-webhook-live/index.ts:1274`, `stripe-webhook-test/index.ts:1269`, `stripe-webhook/index.ts:658` | **designed** |
| **EC-02** | Operator uses the portal "Add Hold" button; renter completes the hosted session | `create-hold-checkout:113-125` sets `metadata.type='security_deposit_hold'` and no `preauth_mode`, so the session misses every branch at `stripe-webhook-live:138-145` and falls into the `else` at `:834` ("Auto mode: Payment was captured"). Sets `payment_status='fulfilled'` (`:840-848`), inserts a `payments` row `Completed`/`captured` for the full uncaptured hold (`:899-912`), then fires `apply-payment` FIFO (`:934-960`) against real rent. Collected overstated; balance zeroed; dunning suppressed; EC-01 armed | Early branch in `checkout.session.completed` for `metadata.type='security_deposit_hold'` → call `sync-deposit-hold` and `break`. No payments row, no `payment_status`, no `apply-payment`. Reconcile existing rows: `payments` joined to `rentals` on `stripe_payment_intent_id = deposit_hold_payment_intent_id` | all three `stripe-webhook-*` | **designed** |
| **EC-03** | Every capture, once the hold means anticipated rent | `capture-deposit-hold:244-307` mints a synthetic `category='Security Deposit'` charge and a direct `payment_applications` row. `payment_apply_fifo_v2` excludes that category (`20260603120000:85-99`), so the real `Rental` charge stays fully open. Renter is charged; arrears unchanged; reminders keep firing; `auto-extend-rentals:447-470` bills the same week again | `capture-deposit-hold` accepts `chargeEntryIds` / `targetCategories` (an explicit **non-damage allowlist**, never plain FIFO — I8), inserts the payment with `target_categories`, calls `payment_apply_fifo_v2(payment_id)`. Keep the `Security Deposit` path only for pre-cutover legacy rentals | `capture-deposit-hold/index.ts:213-307` | **designed** |
| **EC-04** | Super admin flips a tenant to `payment_model='own'` while UK-anchored holds are live | `tenant-payments-tab.tsx:266-276` nulls `customers.stripe_customer_id` for **every** customer of the tenant, on the stated premise that "readiness blocks flips with active saved-card flows". It does not: `check-migration-readiness:243` filters only `held|processing`, and `:663` renders a literal **"Flip anyway"** button with the write done client-side at `:254-258`. Afterwards `place-deposit-hold:155-157` cannot re-place any hold (null customer id), `update-payment-method:74` mints the new PM on the **UAE** platform, and a UAE `pm_` written onto a UK chain declines with `resource_missing` — which `release-deposit-hold:86-99` swallows and `:102-105` records as terminal `released` while the funds stay frozen | (a) exclude customers with a non-terminal hold from the null-out; (b) widen the readiness filter to all non-terminal statuses; (c) move the flip into a server-side RPC that re-runs readiness; (d) delete "Flip anyway"; (e) `place-deposit-hold` falls back to `rentals.deposit_hold_stripe_customer_id`; (f) EC-06 | `tenant-payments-tab.tsx:251-285,662-663`; `check-migration-readiness/index.ts:239-243` | **designed** + see §8-D1 |
| **EC-05** | Any exit from `status='Active'` other than the key-handover receive | `refresh-deposit-holds:52` filters `.eq("status","Active")`, so the chain silently stops; and nothing releases. Confirmed non-releasing writers: `close-rental-dialog.tsx:76-91`, `rentals/[id]/page.tsx:6595-6605`, `finalize-payg-rental:400`, `reject-rental:309-320`, `stripe-webhook-live:1301,1365`, `stripe-webhook-test:1296,1360`, `cancel-booking-preauth:172,202` — none of those files contains the string `deposit`. Funds stay frozen up to 30 days; portal keeps rendering a green "Held" badge | AFTER UPDATE trigger on `rentals`: any transition of `status` out of `Active`/`Pending` sets `deposit_hold_release_requested_at`. Cron sweep selects `deposit_hold_status='held' AND deposit_hold_release_requested_at IS NOT NULL` with **no** status filter and releases. Do not "just add Pending to the cron filter" — that re-authorizes uncollected cars (EC-24) | DDL §3.2 + `refresh-deposit-holds` sweep branch | **designed** |
| **EC-06** | Release/capture/refresh on any hold whose tenant's Connect fields changed since placement, or during UK→UAE | `refresh-deposit-holds:109-112` and `release-deposit-hold:62-67` **re-derive** the connected account from the live tenant row (only the `payment_model` axis is anchored). Cleared `stripe_account_id` → `getConnectAccountId` returns null (`stripe-client.ts:142`) → `stripeOptions` undefined → cancel and create target the **platform** account. Cancel throws `resource_missing`; on a reordered create the replacement lands on the Drive247 balance | Anchor `deposit_hold_connect_account_id`, `_stripe_mode`, `_currency` at placement and use them verbatim thereafter (I3). A null connect account on a record that was created with one is always a bug — write `needs_review`, never fall through | `place-deposit-hold:344-358`; §3.2 | **designed** |
| **EC-07** | Any Stripe error at all in the refresh loop | `refresh-deposit-holds:213-216` writes terminal `expired` for every class — card decline, 429, 5xx, expired platform key, bad deploy, `resource_missing`. The driver at `:53` never re-selects it. One systemic fault at 03:00 kills every live hold across all 28 tenants in one run (the `tenantCache` at `:77` means one worker handles them all) | Error taxonomy: **transient** (`insufficient_funds`, `try_again_later`, `processing_error`, `issuer_not_available`, HTTP 429/5xx) → `failed` + `failure_count++` + backoff 6h/24h/72h, retried by the driver; **SCA** (`authentication_required`) → `requires_action`; **hard** (`lost_card`, `stolen_card`, `pickup_card`, `card_not_supported`) → `failed` + operator alert + renter email; **ambiguous** (`resource_missing`, unclassified) → `needs_review`; **systemic** (auth/key errors) → abort the run, alert, touch **no** rows. Circuit-break after 5 consecutive failures or >30% failure rate | `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-08** | Crash/timeout/deploy between a claim write and its completion | `refreshing` (`:86`) and `processing` (`place-deposit-hold:218`) are unrecoverable. Driver takes only `held`; `place-deposit-hold:79-81` no-ops on `processing`; `capture-deposit-hold:45-47` refuses; the portal shows **"No Hold"** (`rentals/[id]/page.tsx:3376`) with no action button at all | `deposit_hold_status_changed_at` + a 30-minute sweeper that hands the row to the reconciler (never guesses). Add `refreshing`/`processing`/`capturing`/`failed`/`requires_action`/`needs_review` rendering + a Verify-against-Stripe action to both portal and customer portal | §3.2; `rentals/[id]/page.tsx:3367-3378`; `PaymentBreakdown.tsx:573-581` | **designed** |
| **EC-09** | Every write in the refresh loop | `refresh-deposit-holds:84-87` and `:195-203` are bare `.eq("id", …)` with no status predicate, and `:122-128` swallows `payment_intent_unexpected_state` as benign and proceeds to place a **fresh full-amount** authorization. A rental released or captured mid-loop is silently re-authorized after the car came back | `.eq("deposit_hold_status","held")` on the claim; `.eq("deposit_hold_status","refreshing").eq("deposit_hold_payment_intent_id", <incumbent>)` on the completion. Zero rows ⟹ cancel the just-created PI and abort. Treat `payment_intent_unexpected_state` on the cancel as **stop and re-read**, not "continue" | `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-10** | Operator closes/returns a rental during the cron window. `0 3 * * *` UTC is **21:00–22:00 Central** — GMT is a Madison, TN lockbox operator whose after-hours drops are the product | `release-deposit-hold:41` deliberately accepts `refreshing`. It cancels the already-cancelled incumbent, hits the swallow at `:86-99`, writes `released` at `:102-105`. The cron then completes at `:195-203` with no predicate and overwrites with the NEW PI and `held` — on a `Closed` rental the driver (`:52`) will never look at again. Operator saw "Released"; renter's funds are frozen indefinitely. The reverse interleaving leaves the new PI uncancelled with the DB saying `released` | `release-deposit-hold` refuses `refreshing` with a retry-in-a-minute response (or takes an atomic claim). Cron re-reads `rentals.status` and `deposit_hold_status` immediately before the create at `:166`; if the rental left `Active`, release and exit | `release-deposit-hold/index.ts:41`; `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-11** | Operator clicks "Place hold" / "Refresh & Charge" while the cron is mid-refresh | `place-deposit-hold`'s bail-outs cover only `held` (`:73`) and `processing` (`:79`); the atomic claim at `:216-223` matches the exact prior status it read, so `refreshing` and `failed` both claim successfully — and `:344-358` overwrites the PI id **without cancelling the incumbent**. Two live authorizations, one orphaned with no DB reference | Add `refreshing` and `capturing` to the bail-out set. Both cron writes get status predicates (EC-09) | `place-deposit-hold/index.ts:73-81,216-223` | **designed** |
| **EC-12** | `resolveHoldExpiry` cannot read `capture_before` — charge not materialised, expand fails, or the pinned `apiVersion: '2023-10-16'` does not surface the field | `stripe-client.ts:268-271` stores `now + 7 days`. Visa's card-absent **MIT** window is 4d18h. The driver threshold is `now + 2d` (`refresh-deposit-holds:37-38`), so the row is first selected at t≈5.0d — ~6 hours **after** the authorization died. The cancel then no-ops (swallowed at `:123`) and the gap is invisible: the DB never left `held` | (a) **Verify against GMT's live account at API version 2023-10-16 that `capture_before` is returned** — see §8-D5; (b) drop the fallback to **4 days**; (c) persist `deposit_hold_expiry_source` and alert when the fallback rate is non-trivial; (d) widen the threshold to `max(3 days, 40% of observed window)` | `_shared/stripe-client.ts:247-272`; `refresh-deposit-holds:37-38` | **designed** |
| **EC-13** | Nightly, per link | The refresh chain re-uses `rental.deposit_hold_payment_method_id` verbatim for the full 60–120 days (`:172`). It never re-resolves the customer's current default PM (contrast `place-deposit-hold:181-195`, which does). A card that expires, is reissued after fraud, or is replaced by the renter declines every subsequent link → `expired`, unretried, unalerted. Across a 90-day rental, crossing a card expiry is a base-rate event, not a corner case | Re-resolve the PM at each link (default PM → stored id → `paymentMethods.list`), persist the resolved id and card identity, and treat a PM-level failure as `requires_action` with a customer email — never a terminal status | `_shared/deposit-hold-refresh.ts`; `place-deposit-hold:181-195` | **designed** |
| **EC-14** | Renter replaces their card in the customer portal | `update-payment-method:191-222` writes only `installment_plans.stripe_payment_method_id` — never `rentals.deposit_hold_*`. It *does* set the Stripe customer default at `:184-188`, so a **new** hold picks the new card, but the **running chain** keeps targeting the dead PM. The same frozen columns bill real revenue via `auto-extend-rentals:565-566`, so the renter's auto-extension charges also keep failing while dunning blames them | After `:188`, update `rentals` SET `deposit_hold_payment_method_id`, `_stripe_customer_id`, card identity WHERE `customer_id = :c AND deposit_hold_status IN ('held','failed','requires_action','needs_review')`. **Must not ship before EC-06**, or it writes a UAE `pm_` onto a UK chain (EC-04) | `update-payment-method/index.ts:190-222` | **designed** — ordering-gated |
| **EC-15** | Renter's rental has no installment plan and they need to change their card | `apps/booking/src/app/(customer-portal)/portal/payments/page.tsx:1222` gates the Update Card control on `activePlans.length > 0`. No self-serve control exists for a hold-only rental. Every card-lifecycle failure above escalates from "renter fixes it in 30 seconds" to "operator phones them, chain dead meanwhile" | Gate on `activePlans.length > 0 \|\| hasActiveHold` | `portal/payments/page.tsx:1222` | **designed** |
| **EC-16** | Any GMT renter submits a new card | `apps/booking/src/config/stripe.ts:4` is the repo's **only** `loadStripe` call, passes no `{ stripeAccount }`, and falls back to a hardcoded `pk_test_` literal. `update-payment-method:74-76,111-121` creates the SetupIntent **on the connected account**, so `confirmCardSetup` (`UpdatePaymentMethodDialog.tsx:82`) fails with "No such setupintent". The renter's only self-service remedy is inoperative for direct-charge tenants | Per-tenant Stripe.js: `loadStripe(pk, { stripeAccount })`. `get-stripe-config` must be **extended** to return the connect account id — it does not today (it selects only `id, slug, stripe_mode, company_name` and never imports `getConnectAccountId`). Remove the hardcoded fallback | `apps/booking/src/config/stripe.ts:1-7`; `get-stripe-config/index.ts:46-48,78-85` | **designed** |
| **EC-17** | Issuer soft-declines an off-session re-auth requiring 3DS | `place-deposit-hold:326-335` collapses every non-`requires_capture` status into "The card may have been declined" — factually wrong for `requires_action` — and abandons the PI **without cancelling it**. `refresh-deposit-holds:188-189` throws → terminal `expired`. `next_action` is discarded, so nothing can be sent to the renter. `process-installment-payment:199-201` already handles `authentication_required` correctly; the deposit chain does not | Branch explicitly. `requires_action` → persist the PI id, set status `requires_action`, email+SMS the renter a link to an on-session confirm screen (re-fetch `client_secret` server-side on click — **never store it in the DB**), operator alert reads "Waiting on customer verification". `processing` → poll, do not declare failure. Hard-dead statuses → explicitly `paymentIntents.cancel` before resetting so no orphan is left | `place-deposit-hold:326-335`; `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-18** | Operator captures, then places a fresh hold the same day — **the design's normal rhythm** | `place-deposit-hold:276` appends a recollect suffix only for `expired`/`released`. `captured` and `failed` fall through to the bare key `deposit-hold-${rentalId}`, which Stripe replays for 24h. From `captured`: the replayed PI is now `succeeded`, so `:326` fails with "Hold failed with status: succeeded. The card may have been declined." From `failed` (written by `stripe-webhook-live:1176-1180`): the retry replays the cached **error**, so it fails identically no matter what the renter fixed | Replace the enumerated-suffix scheme entirely with `deposit_hold_attempt_seq`, incremented before every Stripe call and embedded in the key: `deposit-hold-${rentalId}-${attempt_seq}-${amountCents}` | `place-deposit-hold:274-277`; §3.2 | **designed** |
| **EC-19** | The rebase changes the amount, and a prior link left the old PI id in place | `refresh-deposit-holds:185` keys on `deposit-refresh-${rentalId}-${oldPiId}`; the failure path never updates `oldPiId`. Reusing that key with a different `amount` returns Stripe `idempotency_error`, which `isCardFeatureIneligibleError` (`stripe-client.ts:192-196`) does not match, so the ladder rethrows → terminal `expired`. Reliable trigger is a same-day operator retry after a rebase | Same fix as EC-18: `deposit-refresh-${rentalId}-${attempt_seq}-${amountCents}`. Widen error classification so a non-card Stripe 400 is surfaced as an alertable failure, not silently `expired` | `refresh-deposit-holds:185`; `stripe-client.ts:192-196` | **designed** |
| **EC-20** | Volume — GMT's fleet self-synchronizes because holds placed on the same day come due on the same day | `refresh-deposit-holds:40-58` has no `.limit()`, no `.order()`. The loop at `:79` is strictly serial with 3–6 Stripe round trips per rental (cancel + up to 3 ladder attempts + `charges.retrieve`). PostgREST silently truncates at the max-rows ceiling and the wall clock truncates well before that — both pick an **arbitrary** subset, not the most urgent. Truncation leaves the in-flight row in `refreshing` and every remaining row unrefreshed | `.order('deposit_hold_expires_at', {ascending:true}).limit(25)`, re-invoke until drained, small concurrent chunks with per-call timeouts. Record `total_due` separately (`count:'exact', head:true`) in `cron_runs` and alert when `total_due > batch` twice consecutively. Set `timeout_milliseconds := 300000` on the `net.http_post` (it is set nowhere under `supabase/`) | `refresh-deposit-holds:40-58,79` | **designed** |
| **EC-21** | Any refresh where the DB write fails after Stripe returned 200 | `refresh-deposit-holds:195-203` **does not destructure or check `error`** (contrast `place-deposit-hold:344-371`, which at least attempts a compensating cancel). A live authorization sits on the card with the row pointing at the cancelled PI and status stuck at `refreshing`. Nothing in the repo ever lists Stripe PIs to reconcile against the DB | Check the error and, on failure, immediately `paymentIntents.cancel(newIntent.id, stripeOptions)`. Plus the reconciler orphan sweep (I1) | `refresh-deposit-holds:195-203` | **designed** |
| **EC-22** | Any DB/Stripe divergence: auto-expired hold, dashboard action, issuer reversal, half-failed link | **No reconciler exists.** `ls supabase/functions \| grep reconcile` returns only `reconcile-subscriptions`, `reconcile-orphaned-registrations`, `inshur-reconcile`. `sync-deposit-hold` is not one — it demands a caller-supplied `sessionId` (`:24-25`) and bails when status is already `held` (`:50-52`), so it structurally cannot correct a wrong `held`. The only truth check is the lazy self-heal at `capture-deposit-hold:92-116`, at the counter, after the damage | New `reconcile-deposit-holds` (6-hourly). DB→Stripe for every non-terminal row: `requires_capture`→ write back `amount_capturable`, `capture_before`, `extended_authorization.status`, `verified_at`; `canceled`→`expired`+alert; `succeeded`→`captured` (**without** minting a payments row — see EC-23); `requires_payment_method`→`failed`; `resource_missing`→`needs_review`. Then Stripe→DB orphan sweep over `metadata.type IN (deposit_hold, deposit_hold_rollover, security_deposit_hold)` matched against `deposit_hold_links` | new function | **designed** |
| **EC-23** | A reconciler that "ensures a payments row exists" for captured holds | Backfilling `payments` rows keyed on hold PIs **re-arms EC-01 on every rental it touches**, including ones whose PI is still cancellable | Reconciler must never insert a `payments` row. It records to `deposit_hold_links` only. Payments rows are written exclusively by `capture-deposit-hold`, and only after EC-01 has shipped | `reconcile-deposit-holds` | **designed** — ordering-gated |
| **EC-24** | Any booking made more than one auth-window before pickup | Every booking path creates the rental `Pending` and the hold is placed from the browser at `booking-success/page.tsx:140,390`, `BookingSuccess.tsx:120`, or by the webhook at `stripe-webhook-*:1148`. The driver requires `Active` (`:52`), so the hold is outside the chain, dies before collection, and then `place-deposit-hold:73-75` returns `alreadyHeld` at handover — the renter drives away with **no** authorization and the operator's screen says "Held" | Do **not** chain Pending holds — re-authorizing a card every 5 days for an uncollected car is indefensible under 5.7.2.4. Instead: a sweeper **releases** any `Pending` hold whose expiry is within the threshold, and the handover path force-replaces when `deposit_hold_expires_at` is past rather than short-circuiting on status. Move the browser-initiated placement server-side into the checkout webhook | `refresh-deposit-holds` sweep; `place-deposit-hold:73-75`; delete the three browser calls | **designed** |
| **EC-25** | A rental left `Active` past `end_date` — the most common operational slip in a 60–120 day fleet | The driver filters on status/hold-status/expiry only; `end_date` appears **nowhere** in the function. The card is re-authorized every ~5 days indefinitely after the car came back. `send-return-reminders` is not a backstop: `:84-85` is forward-only (`end_date BETWEEN now AND cutoff`) and `:83` is one-shot on `return_reminder_sent_at`; `:82` also filters on `'Approved'`, which is not a legal `rentals_status_check` value (`20251219083413_remote_schema.sql:5021` permits only Pending/Active/Closed/Rejected/Cancelled) | `deposit_hold_chain_expires_at`, set at placement to `end_date + tenant grace`, rolled forward by the extension finalizer, enforced as a driver predicate (I9). Past it: stop, capture what is owed or release, raise an operator reminder. **Grace window needs a product decision** (§8-D6) | §3.2; `_shared/deposit-hold-refresh.ts` | **needs decision** |
| **EC-26** | Staff click "Key Received" before entering the return odometer — the normal order, since they are separate controls | `use-key-handover.ts:396-399` writes `Closed`, `:411-423` invokes `release-deposit-hold` **unconditionally** and swallows failure with `console.warn`. Excess mileage is computed by a **different** mutation (`:607-611`), and `calculate-excess-mileage:87-97` cannot run before the receiving reading exists. So the hold is cancelled seconds before the charges it existed to secure become computable. Recovery is then a Table 5-19 delayed charge with a 20-business-day wait | Invert: block "Key Received" until receiving mileage is present where an allowance exists; inside the mutation compute final charges first, capture what is owed (bounded by the open charges), release only the excess; make release failure a real error that sets `deposit_hold_release_requested_at` for the sweeper | `use-key-handover.ts:387-425,578-620` | **designed** |
| **EC-27** | Any rental with a `rental_extensions` row — including an abandoned `pending` one, and every legacy row minted by the backfill at `20260417120000:251-281` | `place-deposit-hold:52-65` counts rows with **no status filter** and blocks every automatic caller (`use-key-handover:361`, `rentals/[id]/page.tsx:781`, `booking-success:140,390`, `BookingSuccess:120`, `stripe-webhook-*:1148`). Only `charge-deposit-dialog.tsx:94` passes `manualOverride`. GMT's entire fleet is manually-extended, so this is the default case: a broken chain has **no automatic recovery path** | Narrow to `.in("status",["approved","paid"])`. Distinguish *first placement* (the RevTek/Fabri spam the guard exists for) from *relinking an existing chain* (`deposit_hold_payment_intent_id IS NOT NULL` and prior status in `expired/released/failed`) — never spam, always allowed, rate-limited by `deposit_hold_failure_count` | `place-deposit-hold:52-65` | **designed** |
| **EC-28** | Extension paid mid-chain | `finalize_rental_extension` rolls `end_date` and touches no deposit column; `refresh-deposit-holds:159` re-reads the frozen scalar; `default-agreement-template.ts:219` told the renter an **additional** hold would be placed (the mechanism is actually cancel-and-replace); and `EXTENSION_AGREEMENT_TEMPLATE` (`:179-242`) contains **no deposit placeholder at all**, so no figure was ever disclosed to compare against | Extension triggers a re-estimate + re-authorization via a distinct `extensionRebase: true` flag (not `manualOverride`); roll `deposit_hold_chain_expires_at` forward; rewrite `:219` to the real mechanism; add the authorization clause + `{{disclosed_hold_amount}}` to the extension template | `place-deposit-hold`; `default-agreement-template.ts:219,179-242` | **designed** |
| **EC-29** | Every refresh, forever | `refresh-deposit-holds:159` computes cents from `rental.deposit_hold_amount` verbatim. There is **no** anticipated-charges estimator anywhere in the repo, and no path to **raise** the amount: `capture-deposit-hold:49-51` and `deduct-from-deposit:125-127` both reject amounts above it, and nothing calls Stripe's incremental-authorization API (which per the verified facts does not extend validity anyway). So the design's central promise is unimplemented in both directions | New `_shared/estimate-anticipated-charges.ts` returning `{amount, inputs, computed_at}`, called at each link, writing `deposit_hold_target_amount` and `deposit_hold_links.estimate_inputs`. **Scope of the formula is blocked on §8-D2.** Clamp: floor at the network minimum (EC-30), ceiling at a configured multiple, and I7 for anything above the disclosed figure. Note prepaid credit sits on `payments` as `status='Credit'` with `remaining_amount>0` (`20260603120000:137-138`), **not** on the ledger — an open-charges-only formula over-holds by exactly the prepaid amount | new shared module | **needs decision** |
| **EC-30** | A shrinking estimate late in a rental | Everything multiplies through `Math.round(amount*100)` (`place-deposit-hold:200`, `refresh:159`, `capture:182`) with no lower bound but zero. Stripe rejects a card PaymentIntent below ~$0.50 and rejects `amount=0`. That throw lands in the catch → terminal `expired`, so the hold does not merely shrink to nothing, it is marked dead and never retried | Floor at the network minimum; "below floor" is an explicit release-and-record decision, never a Stripe call | `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-31** | Every signed agreement | `apps/portal/src/app/api/esign/route.ts:367` resolves `{{deposit_amount}}` from `rental?.security_deposit_amount` — **that column does not exist** (repo-wide, line 367 is its only occurrence; `rentals` has `deposit_amount_override` / `deposit_hold_amount`). The ternary always renders "Refundable hold per tenant policy". Visa 5.7.2.4's notification requirement has never been met | Resolve from `rentals.disclosed_hold_amount`, written by the shared resolver at the moment the figure is rendered (EC-33) | `esign/route.ts:367` | **designed** |
| **EC-32** | Any standard (non-installment) GMT rental | `{{deposit_amount}}` and the deposit clause exist in **one** template — `DEFAULT_INSTALLMENT_AGREEMENT_TEMPLATE` (`default-agreement-template.ts:336-337`). `DEFAULT_AGREEMENT_TEMPLATE` (`:4`), `PAYG_AGREEMENT_TEMPLATE` (`:76`) and `EXTENSION_AGREEMENT_TEMPLATE` (`:179`) contain **no deposit or authorization clause at all**. And `agreement-injection.ts:5-8` records 22 of 37 tenants using their own stored `agreement_templates` row, which `esign/route.ts:1306-1324` prefers — so editing the built-in default reaches ~15 tenants and possibly not GMT | Ship the clause as a **non-tenant-editable code constant** injected via `injectAgreementClauses` (the mechanism proven for the Bonzah addendum), in all **three** byte-identical copies (`apps/portal/src/lib/`, `apps/booking/src/lib/`, `supabase/functions/_shared/`) and wired into all **four** engines. Add a post-substitution stripper `replace(/\{\{(?!@)[a-z0-9_]+\}\}/gi,'')` + `console.error` — `apps/booking/src/app/api/esign/route.ts:243-245` and `create-boldsign-document` never map `deposit_amount` and have no generic stripper, so a template using it emits the raw `{{deposit_amount}}` into a signed PDF | §6; `agreement-injection.ts` | **designed** |
| **EC-33** | Every booking, before any agreement exists | Four sites resolve the amount and they disagree. `place-deposit-hold:104-137`: override → per-vehicle `vehicles.security_deposit` (GMT-only allowlist `:120-122`) → tenant global. `create-hold-checkout:70-78`: override → global, **no per-vehicle branch**. `create-checkout-session:77/95/121/146`: global + override, **no per-vehicle branch** — and this is the only figure the customer ever sees. `add-hold-dialog.tsx:44`: tenant global only. On GMT's Tesla the renter is told $100 and $200 is authorized. Worse, `place-deposit-hold` is invoked from `booking-success` **before any agreement exists**, so the agreement can never be the sole notice vehicle | Extract `_shared/resolve-hold-amount.ts` implementing the single precedence; call it from all four. Persist `disclosed_hold_amount`/`_at`/`_source` at the moment the figure is rendered. Move `PER_VEHICLE_DEPOSIT_TENANT_IDS` out of code into a tenant column | `place-deposit-hold:104-137`; `create-hold-checkout:70-78`; `create-checkout-session:77-146`; `add-hold-dialog.tsx:44` | **designed** |
| **EC-34** | Every checkout render | `create-hold-checkout:102`: "Authorisation only. This amount is held on your card and will be released when the rental ends." `create-checkout-session:172`: "security deposit hold (not a charge)… Released when your rental ends". `booking/checkout/page.tsx:1351` and the byte-identical `BookingCheckoutStep.tsx:2105`: "A temporary hold placed on your card **to verify it** — released after your rental. **This is not part of your total.**" Under the rebase all three are false at the point of sale, authored by us, and contradicted by our own capture | Rewrite all four in the same release as the agreement clause. Copy in §6. Add a test asserting checkout copy, hold-checkout line item and the injected clause all carry the same three claims (renewal, non-damage, settled-not-extra) | §6 | **designed** |
| **EC-35** | Every one of 3–18 links | `refresh-deposit-holds`, `place-deposit-hold`, `capture-deposit-hold`, `release-deposit-hold` and `deduct-from-deposit` contain **zero** notification calls. `notify-preauth-expiring` has **zero callers** repo-wide (grep across `.ts/.tsx/.sql/.json/.toml/.sh` returns only its own directory) and is operator copy about approving a pending booking anyway. The renter learns about the chain from their bank statement | `notify-hold-reauthorized` (renewal, amount, last4, prior released), `notify-hold-action-required` (failure/SCA), `notify-hold-released` (clean return, with the cancelled PI id as a bank cancellation reference). Write `customer_notifications` + email via the existing Resend plumbing. **Tier by chain length**: on a short-window account, in-app + timeline every link, email only when the amount changed or a link failed, plus a monthly consolidated summary — 18 identical emails train the renter to filter exactly the ones that matter | new functions; `_shared/notify-inapp.ts` exists | **designed** |
| **EC-36** | Every authorization | **No** `statement_descriptor` / `statement_descriptor_suffix` anywhere under `supabase/functions/` (grep is empty). 13–18 identical unlabelled pending lines. The PI `description` at `place-deposit-hold:264` / `refresh:176` is Stripe-dashboard-only. This is the single highest-probability driver of unrecognised-charge disputes, and an MIT gets no liability shift | Add `statement_descriptor_suffix: <8-char rental ref>` (already computed on both lines) to `basePayload` in place/refresh and to the rollover at `capture:179`. Verify GMT's Connect account has a stable prefix. Surface the descriptor verbatim in the portal hold row | `place-deposit-hold:256-273`; `refresh:166-186`; `capture:179-199` | **designed** |
| **EC-37** | Every authorization | `description` reads "**Security deposit hold** for rental XXXX" (`place-deposit-hold:264`, `refresh:176`) — the merchant's own transaction metadata naming the exact thing 5.7.2.4/5.7.2.5/5.8.8.4 forbid the amount from covering. Self-incriminating in a representment | Change the `description` strings to "Authorization — anticipated rental charges (ref XXXX)". **Do not** change `metadata.type` in the same commit: EC-01's guard keys on those literals, and renaming first re-arms the landmine silently. If renamed later, the guard must already match by `pi.id = rentals.deposit_hold_payment_intent_id` too | as above | **designed** — ordering-gated |
| **EC-38** | Every operator capture | `charge-deposit-dialog.tsx:51-62` deliberately removes the amount input ("locks to a FULL hold capture for now") and `:135` sends `amount: holdAmount`; `:246` tells the operator it captures the full amount. Collecting $200 of unpaid rent from a rent-scale hold takes the whole estimate — the over-capture the rebase exists to prevent, and the thing a dispute centres on | Re-enable the amount input, defaulted to the selected open charge(s), hard-capped at `min(deposit_hold_amount, Σ selected remaining_amount)`. Pass the charge ids through (EC-03). Gate on the PI's `payment_method_options.card.multicapture` (already read at `capture:118-119`), falling back to the rollover path | `charge-deposit-dialog.tsx:51-62,135` | **designed** |
| **EC-39** | Operator double-clicks Charge, or the portal retries a timed-out invoke | `capture-deposit-hold:130-157` has **no** idempotency key and **no** atomic claim (unlike `place-deposit-hold:216-241`). On a multicapture PI, both calls are legitimate additional captures — the renter is charged twice. Unreachable from today's only caller (which always sends the full hold, so `remainder=0`), but EC-38 makes multicapture the normal path | Atomic claim `held → capturing` gated on the current value before touching Stripe, plus `idempotencyKey: deposit-capture-${rentalId}-${piId}-${capturedInCents}`. UNIQUE partial index on `payments (stripe_payment_intent_id, amount)` for deposit captures | `capture-deposit-hold:130-157` | **designed** |
| **EC-40** | Any transient PostgREST error during a capture | Every ledger write in `capture-deposit-hold` is non-fatal `console.error`-and-continue — `paymentError:236-238`, `updateChargeError:267-268`, `chargeError:290-291`, `appError:304-306`, and even the rental update at `:332-334` — and the response at `:336` is unconditionally `{success:true}`. The card was charged, the operator saw a success toast, and there may be no payment, no charge, no application, and a row still showing `held` on a fully captured PI | Write the whole ledger side in one RPC so it is atomic. Make the payment insert fatal: return `success:false` with a `captured_but_not_recorded` code the UI must surface (a capture cannot be undone, so the operator must be told to reconcile manually). Make the rental update fatal too | `capture-deposit-hold:213-334` | **designed** |
| **EC-41** | Single-capture (GMT's normal path) with a remainder, and the rollover declines | `capture-deposit-hold:207-210` swallows the rollover error as non-fatal, then `:327-330` writes `captured` + `amount=0` after Stripe already released the remainder. Driver never revisits (`:53`). A 90-day rental runs 60+ days with no hold. Then the operator's re-place hits EC-18 and is locked out for 24h | Rollover failure → status `failed` (recoverable, retried by the driver) + operator alert that the remainder was released. Plus EC-18's attempt counter | `capture-deposit-hold:207-210,327-330` | **designed** |
| **EC-42** | Operator deducts an excess-mileage amount | `deduct-from-deposit` is dead code and its fix is a trap. It bails at `:91-93` when `availableDeposit <= 0`, computed from `Security Deposit` ledger charges that migration `20260420120500:63-64` stopped creating — so the hold branch at `:124-167` is unreachable. Its caller is also dead: `rentals/[id]/page.tsx:6106` sources from `invoiceBreakdown.securityDeposit`, hardcoded 0 for ledger-billed rentals. And the branch itself is worse than `capture-deposit-hold`: `:139` writes `captured` without decrementing `deposit_hold_amount` or clearing the PI id, does a plain partial capture with no `final_capture` and no rollover, writes **no `payments` row** (only a ledger `Payment` at `:145-150`), hand-mutates `remaining_amount` at `:154` with no `payment_application`, and has no idempotency key | **Delete `deduct-from-deposit` and route excess mileage through `capture-deposit-hold`** with `targetCategories:['Excess Mileage']`. Do not "move the branch above the ledger check" — that ships all five defects. Add `Excess Mileage` to `cat_order` (§3.7) | `deduct-from-deposit/index.ts` | **designed** |
| **EC-43** | Every capture | `capture-deposit-hold:213-307` writes `payments`, `ledger_entries` and `payment_applications` and never touches `pnl_entries`. `payment_apply_fifo_v2` does (`20260603120000:127-130`), and `dashboard-kpis:109-115` computes Monthly Revenue purely from `pnl_entries` where `side='Revenue'`. Captured deposits are invisible in revenue and per-vehicle P&L — and the more the rebased design succeeds, the more revenue disappears | Fixed for free by EC-03 (FIFO writes `pnl_entries` with correct attribution). If any direct-application path survives, mirror the upsert including its `ON CONFLICT (vehicle_id, category, source_ref)` | `capture-deposit-hold` | **designed** |
| **EC-44** | Two captures on the same day (routine once the hold covers several charge types) | `ux_rental_charge_unique` blocks a second same-day `Security Deposit` charge, so `capture-deposit-hold:255-271` rewrites the existing row as `amount = old + new` with `reference = old \|\| ' \| ' \|| new`. Two Stripe charges, one smeared ledger row — no per-charge record for a representment | Mostly resolved by EC-03 (each capture allocates to specific `charge_entry_ids`). For the residual, stop mutating: each capture is its own `deposit_hold_links` row | `capture-deposit-hold:240-295` | **designed** |
| **EC-45** | Operator changes Currency in Settings while long rentals are live | Currency is read from the **current tenant** in three places: `refresh:158` (known defect), `capture:76` feeding the rollover PI at `:183`, `deduct:106`. A $1,500 hold whose remainder rolls over after a USD→GBP flip becomes a 1,500 GBP authorization (~27% over-authorization). There is no `deposit_hold_currency` column, so a reconciler comparing `deposit_hold_amount` to `amount_capturable` cannot even know the units | `deposit_hold_currency` written at placement (I3). Belt-and-braces: read `preCaptureIntent.currency`, already retrieved free at `capture:82-85`. Warn on currency changes in Settings while any hold is non-terminal | §3.2; `capture:76,176-186`; `refresh:158` | **designed** |
| **EC-46** | Every link, once the estimate moves | `deposit_hold_amount` is a single scalar overwritten in place (`place:349`, `refresh` never writes it back, `capture:319/324/329` decrements it, `sync-deposit-hold:96` overwrites it). After 18 links there is no record of what was authorized when, at what amount, on which PI, whether extended auth was granted, or what the renter was told. 5.7.2.4 disclosure and Table 5-19 both put the evidentiary burden on the merchant | `deposit_hold_links` (§3.3), written by every writer, with `disclosed_amount` and `disclosure_ref` per link (I7) | **designed** |
| **EC-47** | Extended auth granted on link 1, refused on link 5 (account eligibility change, card reissue as a different BIN) — and `if_available` degrades **silently**, since the ladder at `stripe-client.ts:205-232` only fires on a hard eligibility error | Nothing records `payment_method_details.card.extended_authorization.status`. A 90-day rental silently goes from 3–4 links to 13–18: 6× the off-session confirmations, 6× the decline surface, 6× the pending lines the renter sees, and no operator can explain it. It also invalidates the design's own capacity assumption. Compounding: `place-deposit-hold` hand-rolls a 2-rung fallback (`:280-322`, both-features → **none**) while refresh uses the 3-rung shared ladder, so the **same rental** can be placed at ~7 days and refreshed at ~30 — any "{{n}} days" disclosure computed from link 1 is wrong for the next 80 days | Persist `deposit_hold_extended_auth` + `deposit_hold_window_seconds` in `resolveHoldExpiry`. Make `place-deposit-hold` use `createDepositHoldIntentWithFallback` (known defect #3) so both ends use the same ladder. Alert when the window shrinks between links. Compute the disclosed cadence at render time from `expires_at − placed_at` on the live hold, never a constant | `stripe-client.ts:247-272`; `place-deposit-hold:280-322` | **designed** |
| **EC-48** | Every re-authorization on a debit card | Stripe cancelling an authorization is not the issuer dropping the pending line; debit releases commonly take days. `refresh:117` cancels and `:166` creates seconds later, so 2× (sometimes 3×) a **rent-scale** amount is encumbered for the whole rental. It is self-compounding: the stacked prior hold is frequently why the next link declines for insufficient funds. Nothing reads `payment_method_details.card.funding` anywhere in `supabase/functions` | Record `deposit_hold_card_funding` at placement. Disclose the overlap explicitly (§6). **Ordering is a human decision** (§8-D4): cancel-first gaps coverage, create-first authorizes 2× the estimate systematically. Note: changing the *threshold* does **not** change the overlap — that is the issuer's reversal lag, not our timing | §3.2; §8-D4 | **needs decision** |
| **EC-49** | Every renewal, on the same card that bills the rental | `auto-extend-rentals:547,562-567` and `process-installment-payment:143-148` charge off-session using the same PM the hold is authorized on. Rebase the hold to "remaining unpaid rent" and the merchant encumbers roughly the amount it is about to charge, on the same card — the recurring charge declines for insufficient funds, and the failed collection then justifies raising the hold | The estimate must be **net of** scheduled collections falling inside the hold's own lifetime (~5–30 days), not the whole remaining term. Feed into EC-29's formula | `_shared/estimate-anticipated-charges.ts` | **needs decision** (part of §8-D2) |
| **EC-50** | Renter with two concurrent rentals at the same tenant | Each rental gets its own chain but both resolve the card from the same `customers.stripe_customer_id`, and `place-deposit-hold:185-188` falls back to `paymentMethods.list({limit:1})` — newest first. A card added for rental B silently becomes rental A's frozen pointer. The renter carries the sum of both holds and one chain's decline is caused by the other | Prefer `invoice_settings.default_payment_method`; pin the choice by persisting the resolved `pm_` plus card identity. Surface total live encumbrance per customer on the operator's customer page | `place-deposit-hold:181-195` | **designed** |
| **EC-51** | Renter disputes a pending authorization | **No** `charge.dispute.*` handler exists in any booking webhook — grep finds it only in `subscription-webhook:114-116` and `_shared/subscription-webhook-events.ts:40-42` (platform billing). `stripe-webhook-live` handles exactly six event types (`:134,1246,1274,1312,1347,1376`). Money and a dispute fee leave GMT's balance with zero signal; the operator may then attempt a capture on a disputed authorization | Add `charge.dispute.created/updated/closed` to the booking webhooks, resolving charge → PI → rental via `metadata.rental_id`. Set `deposit_hold_status='disputed'`; block capture and deduct while disputed; operator alert with the evidence-due date. Prevention is EC-48 | booking webhooks | **designed** |
| **EC-52** | Any tenant offboarding | `admin-delete-tenant:264-292` deletes `rentals` in a bare tenant sweep with **zero** deposit handling, destroying `deposit_hold_payment_intent_id` and `platform_account` — the only handles on `requires_capture` PIs still holding real customers' funds. The same function goes to extraordinary lengths for platform **subscriptions** (`:108-195`, per-row account, 2×2 account/mode grid, refuses deletion on any hard error at `:176-182`) | Add a deposit-hold cancellation stage modelled exactly on the subscription stage, before the table sweep, refusing the whole deletion on any hard failure. Same guard on any deactivate / Connect-deauthorize path | `admin-delete-tenant/index.ts` | **designed** |
| **EC-53** | Tenant goes live (test→live) or a super admin flips `stripe_mode` while holds exist | `refresh-deposit-holds:104` reads `tenant.stripe_mode` from the **current** row and `:108` builds the client with it. The incumbent PI does not exist on the new mode → `resource_missing` → terminal `expired` for every hold of that tenant in one run. `getConnectAccountId` also swings from the shared test account to the tenant's own across the same flip (`stripe-client.ts:132-140`) | `deposit_hold_stripe_mode` anchored at placement (I3). Block the test→live flip in the admin UI while non-terminal holds exist, or force-release as part of the go-live wipe with an operator instruction to re-collect | §3.2; `refresh:104` | **designed** |
| **EC-54** | Readiness check run while a hold sits in `refreshing` or `failed` | `check-migration-readiness:243` filters `.in("deposit_hold_status", ["held","processing"])` and `tenant-payments-tab.tsx:184` repeats it. A `refreshing` row is a real uncancelled UK authorization and the check reports the tenant clean. Once UK Connect is deauthorized, that hold cannot be cancelled from anywhere | Widen to every non-terminal status and **hard-block** (not warn) on `refreshing`/`failed`/`needs_review`, since those additionally mean the DB does not know the truth. Run the reconciler for the tenant as a precondition | `check-migration-readiness:239-243`; `tenant-payments-tab.tsx:184` | **designed** |
| **EC-55** | `{"only_rental_id": ""}` — and `sim-control`'s dispatcher makes this the default path (`:195,216` always sends the key) | `refresh-deposit-holds:30` accepts any string; `:57` gates on truthiness — an empty string runs **globally**. Combined with `config.toml:68-69` (`verify_jwt = false`) and a SERVICE_ROLE client (`:17-20`) with a bare `.eq("id", …)` and no tenant scoping, anyone with a rental UUID can force-cancel that customer's authorization at will, and repeated calls burn the idempotency key and drive auth/void cycles the cardholder sees. The sandbox fork already got this right (`sandbox-refresh-deposit-holds:51-55` validates a UUID) | Remove `only_rental_id` from the production function entirely — `sim-control` is staging-only and a dedicated sandbox fork exists, so it has no legitimate production caller. Set `verify_jwt = true` and have `pg_cron` pass the service-role bearer (`authType: "service"`, as several manifest entries already do) | `refresh-deposit-holds:27-31,57`; `config.toml:68-69`; `cron-manifest.json:8` | **designed** |
| **EC-56** | The cron is unscheduled, renamed, undeployed, or 500s every run | `net.http_post` records `succeeded` on enqueue, so silence is both the success and the failure signal. `refresh-deposit-holds:220-228` reports only to `console.log`; the `errors[]` array is returned in an HTTP body pg_cron discards. There is no heartbeat table anywhere under `supabase/`, and nothing reads `cron-manifest.json`'s `expectedRef`/`cronJobName` to drift-check against live `cron.job`. Commit `9ab190f2` is the precedent | `cron_runs` written at the top and bottom of every hold cron (§3.4); a dead-man alert when `max(finished_at) < now() - 2× interval`; a drift-check job comparing live `cron.job` against `cron-manifest.json` | §3.4; new drift job | **designed** |
| **EC-57** | Any hold whose real deadline passes while the row says `held` | No query anywhere asserts this. It is discovered at capture time (`capture-deposit-hold:92-116`), i.e. at the counter after the customer left. `notify-preauth-expiring` (241 lines) exists to warn and has zero callers | Invariant cron (30 min) asserting three counts are zero, writing `reminders` at critical severity: (1) `held AND expires_at < now()`; (2) claim state older than 30 min; (3) `held AND status NOT IN ('Pending','Active')`. Wire `notify-preauth-expiring` to (1) or delete it — a dead 241-line notifier that looks like coverage is worse than none | new SQL cron | **designed** |
| **EC-58** | Daily cadence + `now + 2 days` threshold | On a 4d18h MIT window, a hold placed 04:00 Mon dies 22:00 Fri; Wed's run threshold is Fri 03:00 and misses it, so first selection is Thu 03:00 — **~19 hours of margin, one attempt**. Any missed or failed run and the hold dies with no retry, and EC-07 consumes even that on a transient decline | `0 */6 * * *` + threshold widened to 3 days ⟹ ~12 attempts per link. **Unsafe before EC-09** — running the current unguarded code 4× more often quadruples EC-10 and the stranded-`refreshing` rate | `cron-manifest.json:8`; `refresh:37-38` | **designed** — ordering-gated |
| **EC-59** | Tenant turns `security_deposit_enabled` off, or an operator zeroes a rental's deposit | `refresh-deposit-holds:91-96` selects `currency_code` but never `security_deposit_enabled`, `global_deposit_amount`, `vehicles.security_deposit` or `deposit_amount_override`. `place-deposit-hold` checks all of them (`:96-98`, `:104-141`). So the two functions disagree and the cron wins for up to 120 more days of unwanted authorizations | Explicit policy branch after the tenant fetch: if disabled or the current effective deposit is 0, release the incumbent, set `released`, write a `reminders` row saying the chain was stopped by a settings change. Never silently continue | `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-60** | A `held` row with NULL `deposit_hold_expires_at` | `.lt('deposit_hold_expires_at', threshold)` compiles to `expires_at < X`; `NULL < X` is NULL, so the row is excluded from the **only** query that would ever refresh, release or alert on it. Sources: pre-`resolveHoldExpiry` legacy rows, manual repair during an incident | NULL-safe filter (`.or('...is.null,...lt.<t>')`) so unknown-expiry rows are treated as **due**; backfill from Stripe in the reconciler's first pass; then add the I2 CHECK | `refresh:54-55`; §3.2 | **designed** |
| **EC-61** | Multicapture partial captures | `capture-deposit-hold:229` always writes `payments.stripe_payment_intent_id = rental.deposit_hold_payment_intent_id`, and `:317-320` keeps the same PI. Two same-day partial captures produce two payments rows with an identical PI, and there is only a plain btree (`20251219083413:6519`). Both webhook lookups use `.single()` (`stripe-webhook-live:1251-1255,1279-1283`), which errors on multiple rows and returns `data:null` — a genuine capture confirmation or cancellation is dropped with no log line saying why | Add `payments.stripe_charge_id` (unique) populated from the capture response — a multicapture PI produces one charge per capture. Change both lookups to `.maybeSingle()` on a charge-id match with an explicit multi-row log. Treat `deposit_hold_links` as the authorization ledger and `payments` as the cash ledger | `capture:229`; `stripe-webhook-live:1250-1284` | **designed** |
| **EC-62** | Renewal rental becomes Active and a staff member **opens its detail page** | A `useEffect` at `rentals/[id]/page.tsx:1195-1201` sets the **source** rental to `Closed` with no release call — orphaned by EC-05. Between renewal activation and that page view, **both** rentals are Active and both chains re-authorize the same customer's card, doubling a rent-scale encumbrance. A page view must not be what closes a money-bearing record | Move the source-rental close into the server-side path that activates the renewal, releasing first. Delete the useEffect. `place-deposit-hold` refuses a second chain while the `renewed_from_rental_id` predecessor is still `held` | `rentals/[id]/page.tsx:1170-1207` | **designed** |
| **EC-63** | Staff mis-click a handover button and use Undo | Undo-`giving` reverts Active→Pending (`use-key-handover.ts:520-528`) with the hold still `held` — the driver (`:52`) stops seeing it and it dies silently while the UI says "Held". Undo-`receiving` only clears `handed_at` (`:505-511`): it does not revert `Closed` and cannot un-release at Stripe, so an accidental click permanently destroys the chain on a car still on the road | Undo-giving: leave the rental Active, or release cleanly first. Undo-receiving: a real inverse — revert to Active, vehicle to Rented, `place-deposit-hold` with `manualOverride`; a failed re-placement is a blocking error, not a silent success. Add a confirmation on "Key Received" stating the hold will be released | `use-key-handover.ts:485-535` | **designed** |
| **EC-64** | Operator swaps the vehicle mid-rental | `swap_rental_vehicle` (via `use-vehicle-swap.ts:135-146`) reassigns `vehicle_id` and touches no deposit column — the file contains zero occurrences of "deposit". For GMT (the only tenant in `PER_VEHICLE_DEPOSIT_TENANT_IDS`) the amount was derived from the **old** vehicle at `place-deposit-hold:120-137`. The swap also changes the daily rate, mileage allowance and excess rate — every input to the estimate | Rebase on swap: recompute from the new vehicle and set `deposit_hold_target_amount` for the next pass. The refresh should recompute from the **current** `vehicle_id` every link rather than a value frozen at placement | `use-vehicle-swap.ts:147`; EC-29 | **designed** |
| **EC-65** | Operator tries to charge while the chain is `refreshing`/`expired`/`failed` | `capture-deposit-hold:45-47` returns a flat "Cannot capture: deposit hold is X". Combined with EC-07, the operator's normal recovery is unavailable exactly when needed, on a rental that has ended. The "Refresh & Charge" route works but only from `expired` (`page.tsx:3536`) and silently re-places at the **stale** frozen amount rather than what is owed | One status-agnostic "Collect what's owed" action: hold live → capture; hold dead → off-session charge on the stored PM for the assessed amount; declined → pay-link. Re-place at the assessed amount, not `deposit_hold_amount`. Render the dialog for `failed`/`refreshing`/`needs_review` with a Verify-first step | `capture:45-47`; `charge-deposit-dialog.tsx`; `rentals/[id]/page.tsx:3491-3559` | **designed** |
| **EC-66** | Operator or renter opens either portal | Operator: `rentals/[id]/page.tsx` renders a badge, an amount, a one-line detail and three conditional buttons — no expiry, no PI, no attempt count, no last error, no extended-auth status, no verified-at. `deposit_hold_expires_at` / `_payment_intent_id` appear in app code only in the dev sandbox route and `tenant-payments-tab.tsx:593`. Renter: `bookings/[id]/page.tsx:475` selects only `deposit_hold_status, deposit_hold_amount`; one row; `AccountStatementDialog.tsx` has no deposit rows at all. So a renter with four pending lines has one portal row and a statement mentioning none of them | Operator hold panel: current PI (Stripe link), amount authorized **from Stripe**, `capture_before` countdown, extended-auth yes/no, attempt N, last error + time, "verified <t> ago"; actions Verify / Refresh / Re-place / Release / Capture. Renter: a "Card authorizations" timeline from `deposit_hold_links`, plus the same entries in the downloadable statement so it matches the bank | portal + booking | **designed** |
| **EC-67** | Renter opens the portal at any point in a refresh window, or after a failure | `PaymentBreakdown.tsx:573-581` branches on held/captured/released/expired and falls through to a **"No Hold"** badge — while `:304` still renders the amount. And `:304` uses `rental.deposit_hold_amount \|\| invoice.securityDeposit`: after a full capture the amount is `0`, which is falsy, so the renter is shown the **full original deposit** paired with a "Charged" badge. The operator page handles exactly this case (`rentals/[id]/page.tsx:3061-3063`); the customer page does not | Render `refreshing`/`processing` as "Held (renewing)", `failed`/`requires_action` as "Action needed" with an update-card CTA, `needs_review` as "Under review". Use `??` not `\|\|`. Derive the captured figure from payments/ledger | `PaymentBreakdown.tsx:304,573-581` | **designed** |
| **EC-68** | Renter asks Trax (the customer AI) about the pending lines — the first place they look, before support and before their issuer | `customer-chat:451-470` builds context exclusively from `payments`; no `deposit_hold_*` field is loaded, yet the system prompt at `:280-320` advertises "Payment history and upcoming payments". gpt-4o-mini, stateless. It will confabulate about money | Add the hold fields and `deposit_hold_links` to `buildContext`, plus prompt rules: an authorization is not a charge; never tell a customer a pending authorization has been charged; if the customer reports more pending holds than our records show, hand off to a human | `customer-chat/index.ts:451-470` | **designed** |
| **EC-69** | Operator captures part of the hold at return on a single-capture account (GMT's path) | `capture-deposit-hold:173-199` creates a **fresh** authorization for the remainder days after the keys came back, with no notification (`capture` has none). The renter's mental model is "the rental is over" — the single most dispute-prone moment in the chain | Settlement email at capture time, before the rollover, itemising the capture and pre-announcing the remainder. Better: make the default at return a **full release plus a separate normal charge**, reserving rollover for an explicitly non-final account | `capture:173-199`; `notify-rental-completed` | **designed** |
| **EC-70** | Every clean return | `release-deposit-hold` has no notification and `notify-rental-completed` never mentions the deposit. Stripe's cancel is instant; the issuer's release is not. The last link is the freshest and slowest to clear, and the renter was told at booking the hold is "released after your rental" | `notify-hold-released` with the cancelled PI id surfaced as a bank cancellation reference (and shown in the portal so support can hand it over without a Stripe login) | `release-deposit-hold`; EC-35 | **designed** |
| **EC-71** | Card expires inside a 60–120 day rental | Neither placement nor refresh inspects `card.exp_month`/`exp_year`. There is also **no** subscriber to any `payment_method.*` event anywhere in the repo (`stripe-connect-webhook` handles exactly `account.updated:90` and `account.application.deauthorized:124`), so Card Account Updater activity is invisible — and CAU is a per-account Dashboard setting that under direct charges lives on GMT's **connected** account, which nothing verifies | Compare PM expiry to `end_date` at placement; block or flag at handover (cheapest possible intervention — the renter is standing there) and remind at 21/7 days. Subscribe `payment_method.automatically_updated` / `.updated` on `stripe-connect-webhook` and mirror the new card onto the rental. **Operator action:** confirm CAU is enabled on `acct_1SrIFEPcUIaEGCY0` and add it to the direct-charge go-live checklist | `place-deposit-hold:181-195`; `stripe-connect-webhook` | **designed** |
| **EC-72** | Issuer converts the renter's card to a different network mid-rental | Stripe's documented rule: a brand change requires a **new cardholder agreement** before further MITs. Every link is an MIT. The decline is indistinguishable from any other and lands as `expired`. It correlates with CAU silently swapping the card behind the same `pm_`, so our record looks healthy right up to the decline | Compare incoming `card.brand` against `deposit_hold_card_brand` on `payment_method.automatically_updated`; on change, invalidate the mandate (`rental_card_mandates.invalidated_reason='card_brand_change'`), set `requires_action`, email the renter to re-confirm **before** the next link. Depends on EC-16 landing, or the renter has no working way to re-confirm | §3.5; EC-71 | **designed** |
| **EC-73** | Renter's stored `stripe_customer_id` is re-minted | Five writers re-mint and overwrite: `update-payment-method:83-108`, `sync-deposit-hold:111-123`, `create-checkout-session:237`, `create-upfront-checkout:115`, `create-installment-checkout:210`, `pay-installment-early:126,376`. `rentals.deposit_hold_stripe_customer_id` still points at the old object → "payment method does not belong to customer" or "No such customer" → terminal `expired`, reason unrecorded | Propagate to every non-terminal rental in the same transaction, at all writers. In refresh, run `validateStripeCustomerId` (`stripe-client.ts:418`) on the stored id and re-resolve from `customers` when null | all six writers; `_shared/deposit-hold-refresh.ts` | **designed** |
| **EC-74** | Renter's card is reported lost/stolen, or removed via Stripe's own Billing Portal | `resource_missing` on the PM should fall back to the customer's current default (which usually exists — the issuer reissued and the renter added it) but instead kills the chain. Nothing in our code detaches PMs (`paymentMethods.detach` grep is empty outside sandbox fixtures), so this always originates outside the platform | `resource_missing` on the PM → retry once with the customer's current default, persisting it. `lost_card`/`stolen_card`/`pickup_card` → `failed` + operator alert + renter email. **No automated remedy secures the vehicle in the interim** — see §8-D7 | `_shared/deposit-hold-refresh.ts` | **needs decision** |
| **EC-75** | Any rental papered as a chain of ≤30-day extensions rather than one agreement | Chaining re-imports every short-rental statute the single-agreement structure avoids (`docs/GMT_AUTH_HOLD_90DAY_PLAN.md:244-247` records CA §1939.01's 30-day scoping) **and** `place-deposit-hold:52-65` blocks the hold on every one of them (EC-27). One unanswered question determines whether the design is both legal and functional | **Confirm from GMT in writing.** See §8-D8 | n/a | **needs decision** |
| **EC-76** | Any GMT rental with `auto_extend_enabled = true` | `place-deposit-hold:48-51` refuses outright and `refresh:143-155` **releases** rather than refreshes, on the rationale "renewal pricing replaces the deposit" — true for a damage buffer, false for an anticipated-charges hold, since auto-extend rentals are precisely the ones that fail to collect rent (`auto-extend-rentals` tracks `auto_extend_failed_attempts` and falls back to pay-links). If most GMT rentals are auto-extend, the design is inert for the tenant it was built for. Also: the release branch evaluates **after** the unconditional cancel at `:117` | Data check first, then a product decision (§8-D6). Whichever way: **never null the PM/customer columns on release** (I6) — they are auto-extend's only card registry — and add an explicit branch for a mid-rental toggle so flipping the flag releases immediately with notification rather than silently at the next link | `place-deposit-hold:48-51`; `refresh:130-155` | **needs decision** |
| **EC-77** | Any damage, once it leaves the hold | There is no delayed-charge workflow at all: `detect-vehicle-damage` returns AI findings and stops, `ledger_entries_category_check` (`20260503090449:31-40`) has no `Damage` value, there is no repair-quote store, no 20-business-day timer, no 90-day window. Meanwhile `charge-deposit-dialog.tsx:273` literally instructs operators to capture the hold for "damage to rear bumper" — the exact thing 5.7.2.4/5.7.2.5/5.8.8.4 forbid and CA §1939.15(a) bars without post-damage consent | Replace the free-text Reason with a required `reason_category` enum (no damage option); server-side keyword tripwire (damage, dent, scratch, bumper, collision, theft, accident) hard-failing the capture with a message routing to a claim; `damage_claims` (§3.6) hung off `rental_damage_reports`, gated so no card charge can precede notification + the waiting period. **Whether GMT will run a claims workflow at all is a business decision** (§8-D3) | `charge-deposit-dialog.tsx:273`; §3.6 | **needs decision** |
| **EC-78** | Any operator told "damage moves to a waiver, sell it as a line item" | The only mechanism is `rental_extras` — operator free-text `name`/`description`, arbitrary `price`, `billing_type ∈ {per_trip, per_day}`. Nothing stops an operator naming it "Insurance" (unlicensed solicitation in most states) while the injected Bonzah addendum in the **same** signed document has them warranting they "do not sell, solicit, negotiate, or advise on the insurance" (`bonzah-addendum.ts` clause 2). No state price cap can be enforced because `tenants` has **no** structured state column (only free-text `address`; `us-states.ts` is used only by the INSHUR badge and Bonzah selector). And there is no recurrence: `Insurance` is written once at rental start from `invoices.insurance_premium` (`20260420120500:66-71`), so a straight 90-day rental gets one premium with no accrual and coverage silently lapses across extensions | Do **not** ship the waiver on `rental_extras`. First-class product + non-tenant-editable disclosure constant modelled on `bonzah-compliance.ts`. Interim guardrail: forbidden-word validator on extras names. Add `tenants.operating_state` and `rentals.jurisdiction_state` (snapshotted from the pickup location — note `pickup_locations` also has only a free-text `address`, so that needs a column too). **Lawyer + Bonzah required** (§8-D9) | §8-D9 | **needs decision** |
| **EC-79** | Any agreement whose signed PDF download fails, or any live-Stripe tenant left in `boldsign_mode='test'` | `boldsign-webhook:158-178` sets `document_status='completed'` and `envelope_completed_at` regardless of whether `downloadAndStore` returned a `docRecordId`; `signed_document_id` simply stays NULL. `rental_agreements` stores no snapshot of the rendered HTML, and `agreement_templates` is mutable — so if the PDF is missing there is nothing to produce, and the wording may since have changed. Test-mode BoldSign documents self-delete after 14 days while the rental runs 90 | Write `completed_pending_download` and retry with backoff + operator alert; daily sweep for `completed AND signed_document_id IS NULL`; snapshot `rental_agreements.rendered_html` + `disclosure_version` at send time; hard-block agreement creation in `boldsign_mode='test'` for tenants whose `stripe_mode='live'` | `boldsign-webhook:158-178` | **designed** |
| **EC-80** | Every fix in this spec | `sandbox-refresh-deposit-holds` is a hand-maintained verbatim fork whose header claims parity, and with **zero tests anywhere** it is the de-facto verification path. It is also structurally incapable of rehearsing any of the above: it hard-requires exactly one rental (`:51-55,95`), `sim-control:158-174` mints the fixture PI on the **platform** test account with no `stripeAccount` and no `payment_method_options`, `sim-shift-manifest.json:29` concedes a time-shift self-reverts so only link 1 is reachable, and `sim-control` Guard 3 (`:102-116`) refuses to run if any tenant is `stripe_mode='live'` — so the live-account feature ineligibility that caused the GMT incident can never be in the harness | Extract `_shared/deposit-hold-refresh.ts` (I10); sandbox becomes a thin wrapper keeping only its three genuine differences. `doSeedHold` calls `place-deposit-hold` rather than hand-rolling a PI. Chain-simulation mode: N links back-to-back with cross-link invariant assertions | §5 step 0; §7 | **designed** |
| **EC-81** | Same-day currency/timezone edge on close | `close-rental-dialog.tsx:80` writes `end_date` using a hardcoded `America/New_York` timezone into a date-only column. Under the rebase `end_date` feeds both the estimate and `deposit_hold_chain_expires_at`, so for a non-Eastern tenant a near-midnight close shifts a day of rent in or out of the amount authorized off-session | Use the tenant timezone. Invisible for GMT-as-Central-≈Eastern; surfaces on the first non-US-East rollout | `close-rental-dialog.tsx:80` | **P3 — designed, deferred** |
| **EC-82** | Rollover after a partial capture | Per the verified Stripe facts neither incremental authorization nor multicapture extends validity. `capture:317-320` correctly leaves `expires_at` alone on multicapture, but `:321-326` **resets** `placed_at`/`expires_at` on rollover — so the same operator action produces two different chain deadlines depending on an account flag the operator cannot see | Always read the rollover PI's real `capture_before`; never infer. Record `deposit_hold_expiry_source` either way | `capture:313-330` | **designed** |
| **EC-83** | Every hold placed via `create-preauth-checkout` | `create-preauth-checkout` sets `capture_method:'manual'` (`:109`) and passes `customer_email` (`:98,160`) — it never sets `customer` and never sets `setup_future_usage` (contrast `create-checkout-session:269`, `create-upfront-checkout:148`, `create-installment-checkout:313`, all of which do). So no Customer and no attached PM is produced, and at handover `place-deposit-hold:155-157` returns "Customer has no saved payment method" — the chain never starts. Even where a Customer exists from another path, there is no stored off-session **mandate**, which is what makes an off-session MIT come back `authentication_required` on link 1 rather than link 12 | Add `setup_future_usage:'off_session'` to `payment_intent_data` and resolve a real Customer. **Verify which booking path GMT's rentals actually use before shipping the chain.** Separately: it also folds the Bonzah premium into the manual-capture PI (`:137-150`) — not a violation today (this is an exact-amount delayed-capture auth, not an estimated one), but it becomes one the moment any waiver premium is priced into the **chained** hold. Add a payload assertion rejecting insurance/waiver components from any deposit-hold amount | `create-preauth-checkout/index.ts` | **designed** |
| **EC-84** | Every `payment_intent.*` and `checkout.session.*` handler | Every downstream lookup keys on `stripe_payment_intent_id` globally with `.single()` and **no `tenant_id` filter** (`stripe-webhook-live:1252,1279,1387`). There is no `stripe_webhook_events` dedupe table in any of the three webhook functions. GMT's direct-charge holds emit connected-account events, and whether the endpoints are subscribed to them is Stripe dashboard config **not determinable from the repo** — it changes whether EC-01 fires 0 or 18 times per rental | Add `tenant_id` to every webhook-driven lookup; use `event.account` to build `stripeOptions` for any callback. Add an `event.id` dedupe table. **Human verification required** (§8-D10) | booking webhooks | **needs decision** |
| **EC-85** | Operator-initiated deduction, in the legacy refund branch | `deduct-from-deposit:192-212` stamps Stripe `reason: "requested_by_customer"` with a hardcoded refund reason string. A bad fact in a dispute file, contradicting the representment story every disclosure fix supports | Removed with EC-42 (delete the function) | `deduct-from-deposit:192-212` | **designed** |
| **EC-86** | Contract wording at every signing | `default-agreement-template.ts:337` tells the renter a single hold is placed and released "after the vehicle is returned **in acceptable condition**", and that it "does not count toward any unpaid balance". Under the rebase all three clauses are false, and the condition clause explicitly ties the authorization to **damage** — which the design deliberately removes. A renter disputing a capture can cite our own contract | Rewrite per §6.2 and version the template; re-issue for in-flight long rentals is a legal call (§8-D11) | `default-agreement-template.ts:336-337` | **needs decision** |

---

# 5. Implementation order

Strict. Violating an arrow makes the chain **less safe than doing nothing**. GMT-only allowlist items are marked 🅖.

### Step 0 — De-fork (prerequisite to everything)
Extract the per-rental refresh body into `supabase/functions/_shared/deposit-hold-refresh.ts` exporting `refreshOneHold(supabase, ctx, rental)`. Both `refresh-deposit-holds` and `sandbox-refresh-deposit-holds` import it (I10). *Reason:* every subsequent fix otherwise lands twice, and the Time Machine silently green-lights code production no longer runs (EC-80).

### GATE 0 — Disarm before amplifying. **Nothing else ships first.**
1. **EC-01** — `payment_intent.canceled` ignores deposit-hold PIs (by `metadata.type` **and** by id-equals-`rentals.deposit_hold_payment_intent_id`) and never cancels a non-`Pending` rental. All three webhook files.
2. **EC-02** — `checkout.session.completed` routes `security_deposit_hold` to `sync-deposit-hold` and breaks.
> *Reason:* EC-03's capture fix, EC-22's reconciler and EC-46's link table **all create more payments rows keyed on hold PIs**. Each is a rental-cancellation weapon until Gate 0 lands (EC-23). Also blocks EC-37's description change, whose eventual `metadata.type` rename would silently un-match the guard.

### GATE 1 — Anchoring. Blocks the UAE migration and every card-update fix.
3. **§3.1 + §3.2 DDL**, then **EC-06/EC-45/EC-53** — write `deposit_hold_connect_account_id`, `_stripe_mode`, `_currency` at placement; read them verbatim on refresh/capture/release (I3).
4. **EC-07 error taxonomy + EC-04(I4)** — `resource_missing` and unclassified errors write `needs_review`, never `released`/`expired`.
5. **EC-04** — flip excludes hold-bearing customers; **EC-54** readiness widened; flip moved server-side; "Flip anyway" deleted; `place-deposit-hold` falls back to `rentals.deposit_hold_stripe_customer_id`.
> *Reason:* **EC-14/EC-15/EC-16 must not ship before this.** Before Gate 1 the card-update fix writes a UAE `pm_` onto a UK chain, and without step 4 that becomes a silent terminal lie (S1/EC-04).

### GATE 2 — State machine. Blocks the frequency increase and any batch change.
6. **EC-09/EC-10/EC-11** — optimistic concurrency on every write; `release-deposit-hold` refuses `refreshing`; `place-deposit-hold` bails on `refreshing`/`capturing`.
7. **EC-18/EC-19** — `deposit_hold_attempt_seq` replaces the enumerated-suffix idempotency scheme everywhere.
8. **EC-08 sweeper + EC-21 unchecked-write fix + EC-60 NULL-safe filter + EC-05 release-request trigger + EC-25 chain bound + EC-24 Pending policy.**
9. **EC-46** `deposit_hold_links` written before every Stripe call (I1).
> *Reason:* **EC-58 (`0 */6 * * *`) must not ship before step 6.** Running the current unguarded code 4× more often quadruples EC-10 and the stranded-`refreshing` rate (S8).

### GATE 3 — Money semantics. Blocks turning the rebase on.
10. **EC-03** — capture settles real charges via an explicit **non-damage allowlist**, never plain FIFO (I8, C5).
11. **EC-38/EC-39/EC-40/EC-41** — partial capture re-enabled and bounded; capture claim + idempotency key; ledger writes atomic and fatal.
12. **EC-42** — delete `deduct-from-deposit`; route excess mileage through capture; `Excess Mileage` added to `cat_order`.
13. **EC-30** amount floor; **EC-12** fallback 7d→4d + `expiry_source`.
14. **EC-29** estimator — **blocked on §8-D2.** Ship the plumbing (`deposit_hold_target_amount`, per-link `estimate_inputs`) with the formula pinned to **unpaid + anticipated rent only** until counsel answers.

### GATE 4 — Disclosure. Must precede the FIRST rebased hold, not follow it.
15. **EC-33** — one shared amount resolver; `disclosed_hold_amount` persisted at render time. `place-deposit-hold` is invoked from `booking-success` **before any agreement exists**, so the checkout copy must carry the notice.
16. **EC-34** — rewrite all four checkout strings.
17. **EC-31/EC-32/EC-86/EC-28** — fix the resolver, add the authorization clause via `injectAgreementClauses` to **all** templates and **all four** engines, add the placeholder stripper.
18. **§3.5** — persist the checkout mandate (`rental_card_mandates`), and **strike "damage" from the three checkout mandate strings** in the same commit.
19. **EC-35** — renter notifications wired.

### GATE 5 — Observability.
20. **EC-56** `cron_runs` + dead-man alert + manifest drift check.
21. **EC-57** invariant cron (three counts must be zero).
22. **EC-22** reconciler — **after Gates 0 and 1** (EC-23, EC-04).
23. **EC-66/EC-67/EC-68** operator panel, renter timeline, Trax context.
24. **EC-51** dispute handlers; **EC-52** offboarding stage; **EC-55** `verify_jwt` + drop `only_rental_id`.

### GATE 6 — Rollout 🅖
25. Enable the rebase for **GMT only**, behind an allowlist mirroring `PER_VEHICLE_DEPOSIT_TENANT_IDS` (`place-deposit-hold:120-122`) — but read from a tenant column, not a hardcoded Set.
26. **EC-58** frequency to `0 */6 * * *`, threshold to 3 days.
27. Damage waiver (EC-78) and delayed-charge workflow (EC-77) — **only after §8-D3 and §8-D9.**

### NEVER until its gate completes
Raise cron frequency (Gate 2) · enable rebasing (Gates 3+4) · start the UAE cutover for a hold-bearing tenant (Gate 1 + §8-D1) · rename `metadata.type` (Gate 0).

---

# 6. Compliance checklist

## 6.1 Per-authorization gate

Every link must satisfy all of these or it must not be sent:

| # | Requirement | Source | Enforced by |
|---|---|---|---|
| 1 | Amount is a genuine estimation of what the cardholder will spend | Visa 5.7.2.4 (ID# 0030936) | `estimate_inputs` persisted per link (EC-29, EC-46) |
| 2 | Amount contains **no** potential damage, theft, **other delayed charges**, insurance premiums or tips | 5.7.2.4; 5.7.2.5; 5.8.8.4 (ID# 0031153) | Payload assertion rejecting waiver/insurance/damage components (EC-83); **scope of "other delayed charges" is §8-D2** |
| 3 | Cardholder notified of the estimated amount **and** that subsequent authorization requests may be submitted | 5.7.2.4 | `disclosed_hold_amount` + `disclosed_hold_source`; checkout copy (EC-34) **and** agreement clause (EC-32) — the checkout is load-bearing because the hold can precede the agreement |
| 4 | An increase above the disclosed figure carries fresh notice before it is requested | 5.7.2.4 | I7 + `deposit_hold_links.disclosure_ref`. **Notice must be concurrent with the higher authorization, not a gate on it** — deferring a link on a 5–7 day window burns half the retry runway (C6) |
| 5 | Unscheduled card-on-file mandate exists and is recorded, naming the triggering events | Visa Stored Credential Framework | `rental_card_mandates` (§3.5), invalidated on card-brand change (EC-72) |
| 6 | Damage recovered only as a delayed charge within 90 days of return, with documentation, a repair quote, the cardholder's right to an alternative estimate, and a 20-business-day wait — or not at all | Table 5-19 (ID# 0007398) | `damage_claims` (§3.6) + the capture tripwire (EC-77) |
| 7 | Transaction description does not name a security deposit | representment hygiene | EC-37 |

**Note on 5.8.8.4:** the Vehicle Rental Merchant Asset Protection Program *explicitly permits* authorizing **more** than the anticipated final amount "to protect them from potential losses associated with extended rental periods". A design that shrinks the hold as rent is paid **discards that safe harbour** in exchange for a 5.7.2.4 claim that is harder to sustain. Do not treat shrinking as a compliance requirement — it is a product choice (V3, §8-D2).

## 6.2 The clause to add

Ship as a **non-tenant-editable code constant** (`AUTH_DISCLOSURE_HTML`), injected by `injectAgreementClauses` under placeholder `card_authorization_disclosure`, gated on `tenants.security_deposit_enabled`, into all templates and all four engines. Model it on `bonzah-addendum.ts` — an operator must not be able to reword a card-network-mandated notice. Update all **three** byte-identical copies (`apps/portal/src/lib/`, `apps/booking/src/lib/`, `supabase/functions/_shared/`) and md5sum them.

```html
<h2>Card Authorization for Anticipated Charges</h2>

<p><strong>What we authorize, and why.</strong> At key handover we place a card
authorization — not a charge — of approximately <strong>{{disclosed_hold_amount}}</strong>
on the payment method shown above. This amount is our good-faith estimate of the
charges you are expected to incur under this Agreement. <strong>It does not include,
and will never be used for, any amount covering potential damage to or theft of the
vehicle, or any insurance premium.</strong> Damage and theft are dealt with
exclusively under the Damage Waiver section and, if that does not apply, by a
separately itemized claim after the vehicle is returned.</p>

<p><strong>Repeat authorizations.</strong> Card authorizations expire on a timetable
set by your card network, not by us — typically well before this rental ends.
<strong>You are notified now that subsequent authorization requests will be submitted
for the life of this rental.</strong> Each time, we release the existing authorization
and request a replacement on the same card without contacting you again. You may
therefore see a new pending item on your account periodically until the vehicle is
returned.</p>

<p><strong>Overlapping pending items.</strong> When we release an authorization your
bank, not us, controls how quickly the funds return to your available balance.
Debit-card releases in particular can take several days or longer. During that period
two pending items may appear for the same rental. Only one is live; the other is a
release your bank has not yet processed. We cannot accelerate it — contact your bank.</p>

<p><strong>If the estimate changes.</strong> If the anticipated charges change
materially — for example because you extend the rental — a later authorization may be
requested for a different amount. We will notify you at the email address on file
before requesting an amount higher than the figure above.</p>

<p><strong>Settlement.</strong> We capture only amounts you actually owe under this
Agreement, itemized on your final invoice. Any authorized amount we do not capture is
released. An authorization is not a payment and does not reduce what you owe.</p>
```

> Deliberately written to the **mechanism**, never to a day count — the granted window varies by network, account eligibility and MCC, and EC-47 shows it can change mid-chain.
> The bracketed list of covered charges is intentionally omitted pending §8-D2. Once counsel answers, insert the cleared list in paragraph 1 and nowhere else.

Checkout copy (EC-34) must carry the same three claims:

- **`create-hold-checkout:102` line item** — name: `Authorization for anticipated rental charges`; description: `Authorization only — not a charge. Covers charges you may owe under the rental. Renewed periodically until the vehicle is returned. Does not cover damage or theft.`
- **`create-checkout-session:172`** — same substance; delete "Released when your rental ends".
- **`booking/checkout/page.tsx:1351` + `BookingCheckoutStep.tsx:2105`** (byte-identical — change both) — `Card authorization`: `We authorize this amount against charges you may owe under the rental. It is renewed periodically during the rental and settled against your final invoice — it is not an extra fee, and it does not cover damage.` Delete "to verify it" and "This is not part of your total."

## 6.3 Where consent is persisted

| Consent | Captured at | Stored |
|---|---|---|
| Card-on-file mandate | booking checkout (`checkout/page.tsx:1079` et al) | `rental_card_mandates` (source `booking_checkout`) — **today nothing is written** |
| Authorization disclosure | agreement signing | `rental_card_mandates` (source `agreement`, `signed_document_id`) + `rentals.disclosed_hold_amount/_at/_version/_source` |
| Amount shown pre-contract | checkout render | `rentals.disclosed_hold_amount`, source `checkout` |
| Per-link notice of increase | `notify-hold-reauthorized` | `deposit_hold_links.disclosure_ref` |
| Rendered agreement text | send time | `rental_agreements.rendered_html` + `disclosure_version` (EC-79) |

Strike `damage` from the three checkout mandate strings when persisting them (§5 step 18): pre-emptively authorizing a card-on-file damage charge is exactly what CA §1939.15(a) voids, and persisting it turns our own copy into the plaintiff's exhibit.

---

# 7. Test plan

There are currently **zero** tests for any deposit code. Portal has `vitest` and 10 test files under `src/__tests__/lib/`, none touching holds.

## 7.1 Unit — `apps/portal/src/__tests__/` and Deno tests for `_shared/`

| Test | Covers |
|---|---|
| `resolveHoldExpiry` returns `capture_before` when present; returns **4 days** (not 7) when absent; sets `expiry_source` correctly | EC-12 |
| `resolve-hold-amount` precedence: override(0) beats per-vehicle beats global; identical output from all four call sites for a GMT per-vehicle rental | EC-33 |
| `estimate-anticipated-charges` excludes prepaid credit (`payments.status='Credit'`); nets scheduled collections inside the window; floors at the network minimum; clamps at the ceiling | EC-29, EC-30, EC-49 |
| Idempotency key derivation is unique per `(rental, attempt_seq, amount)` and never reuses across `captured`/`failed`/`expired`/`released` | EC-18, EC-19 |
| Error classifier maps `insufficient_funds`→transient, `authentication_required`→SCA, `lost_card`→hard, `resource_missing`→ambiguous, 429/5xx→systemic | EC-07 |
| State machine: every illegal transition rejected; every claim write carries its predicate | §2.2, EC-09 |
| `injectAgreementClauses` adds the disclosure to all four templates; no `{{…}}` survives any engine's variable map | EC-31, EC-32 |
| Md5 parity of the three `agreement-injection.ts` copies; diff parity of `_shared/deposit-hold-refresh.ts` consumers | EC-80 |

## 7.2 Stripe test mode — against the shared test Connect account

| Case | Assert |
|---|---|
| Place → refresh → refresh (3 links) | 3 `deposit_hold_links` rows; `expires_at` strictly increasing; connect account, mode and currency identical across links (I3) |
| Kill the process between claim and completion | Row lands in `refreshing`; sweeper resolves it against Stripe within 30 min; no orphan PI (I1) |
| Force the completion DB write to fail | New PI is cancelled; no orphan; status `needs_review` | EC-21 |
| `4000002500003155` (SCA required) off-session | Status `requires_action`, PI persisted, notification sent, **not** `expired`; operator sees "Waiting on customer verification" | EC-17 |
| `4000000000009995` (insufficient funds) | `failed` + `failure_count=1` + `next_retry_at`; retried by the driver; **not** terminal | EC-07 |
| Cancel a hold PI that has a `payments` row | Rental status **unchanged** | EC-01 |
| Complete a `create-hold-checkout` session | No `payments` row, no `payment_status='fulfilled'`, no `apply-payment`; hold synced onto `rentals` | EC-02 |
| Partial capture of $200 from a $1,500 hold, targeting an open `Rental` charge | Rental charge `remaining_amount` drops by 200; **no** `Security Deposit` charge minted; `pnl_entries` written | EC-03, EC-43 |
| Two concurrent captures | Second is rejected by the claim; exactly one Stripe capture | EC-39 |
| Release a hold whose connect account was cleared | `needs_review`, **not** `released` | EC-04, EC-06 |
| Two concurrent `refresh` invocations on one rental | One wins; loser skips (409 treated as "another worker owns this"), no row clobbered, no orphan | EC-09 |
| Reconciler with a Stripe-side `requires_capture` PI absent from `deposit_hold_links` | Orphan detected, adopted or cancelled, operator alerted; **no `payments` row created** | EC-22, EC-23 |

## 7.3 Cron simulator — after the harness fixes (EC-80)

`sim-control` is staging-only (`:59-61`) and Guard 3 (`:102-116`) refuses to run if any tenant is `stripe_mode='live'`, so the live-account ineligibility path is **not testable here** — flag it as a production canary instead.

| Scenario | Assert |
|---|---|
| **Chain simulation**: seed via `place-deposit-hold`, then N re-shift+refresh cycles | Amount rebases as intended; account/mode/currency stable; `expires_at` monotonic; N link rows | EC-47, I3 |
| Multi-rental batch of 60 with `.limit(25)` | Ordered by expiry ascending; run re-invoked until drained; `cron_runs.truncated` accurate | EC-20 |
| Rental flipped to `Closed` mid-batch | Sweeper releases; nothing re-authorizes; final status `released` | EC-05, EC-10 |
| Rental past `end_date + grace` | Chain stops; operator reminder written; no new authorization | EC-25 |
| `security_deposit_enabled` turned off mid-chain | Incumbent released, `reminders` row written, no re-authorization | EC-59 |
| Cron skipped for 2 days | Every hold still alive at the 6-hourly cadence with a 3-day threshold | EC-58 |
| Heartbeat suppressed | Dead-man alert fires within 2× the interval | EC-56 |
| Invariant probe | All three counts are 0 across the whole scenario set | EC-57, I2 |

## 7.4 Production canaries (not simulatable)

- Does GMT's live account return `capture_before` at `apiVersion '2023-10-16'`? (§8-D5)
- Which `DEPOSIT_HOLD_CARD_VARIANTS` rung does GMT actually land on, and is `extended_authorization.status === 'enabled'`? (§8-D5)
- Are the live/test webhook endpoints subscribed to **connected-account** events? (§8-D10)
- Is Card Account Updater enabled on `acct_1SrIFEPcUIaEGCY0`? (EC-71)

---

# 8. Accepted risks and open decisions

## 8.1 Decisions that need a human — blocking

**D1 — GMT cannot migrate to UAE while the chained design is live.**
A Stripe PaymentIntent, Customer and PaymentMethod cannot move between platform accounts. `check-migration-readiness:239-243,338-343` already hard-blocks the own-Stripe flip on live UK holds — but with 60–120 day rentals starting before the last one ends, that gate is essentially **never green**. And it is bypassable: `tenant-payments-tab.tsx:254-258` writes `payment_model` client-side and `:663` renders **"Flip anyway"**. Options: (a) keep the UK platform, its keys and every UK Connect account alive for 120 days past the last UK-anchored rental start; (b) freeze new holds N days before cutover, accepting uncovered rentals in the gap; (c) break chains mid-flight and build a customer-facing on-session re-authorization flow on UAE. **Escalate to the UAE migration owner now, with the 120-day number attached.** The migration is described as in-flight this week.

**D2 — Are fuel, mileage overage and late return allowed in the authorized amount at all?**
The design names four components. Unpaid and anticipated **rent** is unambiguously "what the Cardholder will spend". The other three are arguably *potential delayed charges* — and both 5.7.2.4 and 5.8.8.4 exclude "other delayed charge[s]", not only damage and theft. Building them into a documented estimator would make the violation **provable from our own code**. Two of them are also uncomputable mid-rental: `calculate-excess-mileage:87-97` requires the receiving reading, and neither `Late Return` nor `Fuel` exists in `ledger_entries_category_check` (`20260503090449:31-40`). **Counsel + acquirer, before the estimator is written.** Interim: unpaid + anticipated rent only, and say so in the agreement.

**D3 — Will GMT run a damage-claims workflow?**
Removing damage from the hold removes the only mechanism that exists today. Table 5-19's requirements are 0% implemented. If GMT will not run claims, the honest answer is that damage recovery is limited to the waiver plus the fleet policy — an unpriced insurance decision (who pays sub-deductible claims?), not an engineering gap.

**D4 — Cancel-first or create-first, and does GMT accept debit cards on long rentals?**
Cancel-first (today) gaps coverage between the cancel at `:117` and the create at `:166`, and any failure leaves the renter unsecured. Create-first removes the gap but **deliberately authorizes 2× the estimate**, systematically, 13–18× per rental — which is not "a genuine estimation of what the Cardholder will spend" and needs explicit disclosure. Changing the threshold does not help: the overlap the renter feels is the issuer's reversal lag. On debit, that is spendable cash. Honest options: refuse debit above ~30 days; get GMT approved for **extended authorization** (an IC+ pricing conversation with Stripe — MCC 7512 is a Visa-favoured category, and dropping 13–18 links to 3–4 fixes more of this document than any code change); or fund the support cost.

**D5 — Verify GMT's actual authorization window.** Two unresolved facts the whole timing model rests on: (1) does `capture_before` come back at `apiVersion '2023-10-16'` (`stripe-client.ts:22,313`)? If not, every hold takes the fallback and EC-12 is systematic. (2) Which ladder rung does GMT land on? `stripe-client.ts:170-189` names GMT as ineligible for the **pair**; rung 1 (extended-auth only) may still succeed, and `create-hold-checkout:152-153` says the ordering exists specifically to preserve the 30-day lifetime GMT relies on. "13–18 links" is an assumption, not a measurement.

**D6 — Auto-extend rentals, and the chain grace window.**
`refresh:130-155` releases on `auto_extend_enabled` because "renewal pricing replaces the deposit" — coherent for a damage buffer, inverted under the rebase, since auto-extend rentals are precisely the arrears-bearing ones. Reversing it re-litigates the RevTek/Jeffrey incident. Requires a data check on how many GMT rentals carry the flag. Separately, the grace window on `deposit_hold_chain_expires_at` is a product number nobody has set. **Whichever way D6 goes: never null the PM/customer columns on release (I6).**

**D7 — What happens to a vehicle on the road when the chain dies unrecoverably?**
Hard decline, SCA never completed, closed card. Recall the vehicle? Charge a fee? Accept 60 unsecured days? No policy exists in code, in docs, or anywhere in this review.

**D8 — Is a 90-day GMT rental one agreement or chained ≤30-day extensions?**
If chained: the short-rental statutory scoping inverts (CA §1939.01's 30-day boundary, per `docs/GMT_AUTH_HOLD_90DAY_PLAN.md:244-245`), *and* `place-deposit-hold:52-65` blocks the hold on every one of them. This single unanswered question determines whether the design is legal **and** whether it functions. Nobody has asked GMT.

**D9 — Waiver licensing, price caps, and Bonzah.**
Per-state limited-lines / rental-car-agent licensing, the verbatim disclosure script, the price cap table (NY GBL §396-z, CA Civ. Code §1936, NV, CT), and whether an operator-issued waiver alongside Bonzah's brokered CDW is permitted under their embedded-compliance terms (raise directly via the existing `brandon@bonzah.com` channel). None resolvable from code — and none *applicable* from code either, until `tenants.operating_state` / `rentals.jurisdiction_state` exist and are populated. GMT's state is currently inferred from a marketing script string ("Madison, Tennessee" in `scripts/update-cms-content.js`).

**D10 — Are the booking webhook endpoints subscribed to connected-account events?**
Stripe dashboard configuration, not in the repo. It determines whether EC-01 fires 0 or 18 times per GMT rental. `stripe-client.ts:331-346` confirms own-tenant direct charges do produce connected-account events reaching these endpoints.

**D11 — Re-papering live rentals.** Rentals already signed under the old §9 (`default-agreement-template.ts:337`, "released after the vehicle is returned in acceptable condition") cannot be moved to the rebased hold without a legal call on whether re-issuance is required.

## 8.2 Accepted risks

| Risk | Why accepted |
|---|---|
| Stacked pending authorizations remain visible to renters even after D4 | No technical fix; issuer-controlled. Mitigated by disclosure (§6.2 para 3) and by `deposit_hold_links` giving support a cancellation reference per link |
| Timezone drift on `close-rental-dialog.tsx:80` (`America/New_York` hardcoded) | Invisible for GMT (Central ≈ Eastern); surfaces on the first non-US-East tenant. EC-81, P3 |
| Live-account card-feature ineligibility cannot be rehearsed in staging | `sim-control` Guard 3 (`:102-116`) refuses to run with any live tenant. Covered as a production canary (§7.4) |
| No `stripe_webhook_events` dedupe table in the booking webhooks | Pre-existing; scoped to Gate 5. Stripe's at-least-once delivery can double-process, but every deposit write after Gate 2 is status-predicated and therefore idempotent in practice |
| `PER_VEHICLE_DEPOSIT_TENANT_IDS` remains a code constant until Gate 6 | Moving it to a tenant column is part of EC-33 but is not on any gate's critical path. It is a landmine for the next per-vehicle tenant — flag it in the rollout checklist |
| `payments` and `deposit_hold_links` both describe money for one rental | Deliberate: `deposit_hold_links` is the **authorization** ledger, `payments` the **cash** ledger. Summing `payments` must never multiply the deposit by chain length (EC-61) |
| The `'Security Deposit'` ledger category name survives the rebase | It is a data value with ~20 equality call sites plus an `invoices.security_deposit` column. Renaming it silently breaks refund and settlement logic. Presentation label only |