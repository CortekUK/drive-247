# GMT Gate 0 — Integration check & deploy handover

**Date:** 2026-08-09
**Scope:** the deposit-hold expiry fix (GMT, "I cannot refresh the hold") across three workstreams —
B1 webhooks, B2 hold-guard edge functions, B3 portal UI.
**Status:** code complete and verified; **nothing is deployed**. Read §1 first — the change set is
already on `origin/main`, which has a live consequence.

---

## 1. Read this first: the tree is committed AND pushed

`git status` is **clean**. The entire change set was committed *and pushed to `origin/main`* by the
repo owner (`Haseebraza12 <munibhaseeb2@gmail.com>`) at 17:37 and 17:43 today, part-way through the
fix pass. No agent ran `git commit` or `git push`.

| Commit | What it carries |
|---|---|
| `8aa92958` | Bulk of B1 + B2 + B3, the schema doc, the test plan, `config.toml` entry |
| `22ba0b8e` | One-line `??` → `\|\|` fix for `probedPiId` |
| `609f1c4d` | Late B1/B2/B3 fixes **mixed with an unrelated workstream** (`rentals/new/page.tsx`, manual identity verification, +340 lines) |

Combined vs. the last known-good commit `22d5dd54`: **19 files, +4225 / −135**.

**Two consequences you must act on:**

1. **`apps/portal/vercel.json` exists and the portal is a Vercel project on this repo.** Pushing to
   `main` triggers a production portal build. The portal UI — including the new **"Check with Stripe"**
   button — is therefore most likely **already live**, while the edge function it calls
   (`verify-deposit-hold`) is **not deployed**. Every click currently 404s. It degrades safely (see
   §4), but the feature is inert and operators will see an error toast. **This is the reason to
   deploy `verify-deposit-hold` first and soon.**
2. **`609f1c4d` is not cleanly revertable.** It interleaves this work with the identity-verification
   workstream. If you need to back out the hold work, do it file-by-file, not by reverting the commit.

There is **no CI that deploys edge functions** (no `.github/workflows`), so nothing Supabase-side has
shipped. Confirmed.

---

## 2. Verification results

### Tests — clean
```
cd apps/portal && npx vitest run
  Test Files  15 passed | 1 skipped (16)
       Tests  286 passed | 7 todo (293)
```
**Zero failures, new or pre-existing.** The 7 todos are `it.todo(...)` placeholders in
`src/__tests__/components/rental-id-verification-override.test.ts`, which belongs to the concurrent
identity-verification workstream and is deliberately unimplemented. No application code was edited to
make anything pass.

### Typecheck — clean
```
cd apps/portal && npx tsc --noEmit
  .next/dev/types/validator.ts(80,24): error TS1109
  .next/dev/types/validator.ts(85,1):  error TS1128
```
Both are in a **Next-generated file**, both **pre-existing**, exit code 0. **Zero errors in source.**
`npm run build` in `apps/portal` completes successfully — the Vercel deploy will not break.

Deno is not installed on this machine, so `deno check` could not run. As a substitute, all nine
relevant edge functions were parsed with the esbuild TS loader — `verify-deposit-hold`,
`create-hold-checkout`, `place-deposit-hold`, `stripe-webhook-live`, `stripe-webhook-test`,
`stripe-webhook`, `sync-deposit-hold`, `refresh-deposit-holds`, `capture-deposit-hold` — **all parse
clean**. That catches syntax, not types. A `deno check` on a machine that has it is still worth doing
before the LIVE webhook deploy.

### Runtime-reference check (the way a webhook dies in production)
`notifyOperatorsInApp` is *called* in all three webhook handlers but *defined* in none — it is
correctly imported from the pre-existing `_shared/notify-inapp.ts`, and the call sites match its
`NotifyOperatorsInAppParams` interface exactly. `HOLD_SYNC_TIMEOUT_MS`, `HOLD_SYNC_MAX_RETRY_AGE_MS`
and `classifyHoldSyncFailure` are all declared in each file. `platformAccount` is in scope in
`stripe-webhook-live` (:132) and `-test` (:130) and is sent; the legacy `stripe-webhook` has no such
variable and correctly does **not** send it. **No ReferenceError latent in any handler.**

`create-hold-checkout` is the **only** producer of `security_deposit_hold` sessions and writes
`tenant_id` into both session and payment-intent metadata, so the new operator alert's `tenantId`
always resolves. It will not silently no-op.

---

## 3. Contract check: portal ↔ `verify-deposit-hold` — PASSES

The UI reads six fields: `verified`, `liveHold`, `status`, `changed`, `needsReview`, `message`.
The function has **eight exit paths**. Every one emits `verified, liveHold, status, changed,
expiresAt, message`; two also emit `needsReview: true`. **No field the UI reads is ever absent.**

`status` is never `null` — the `reportStatus()` sentinel returns `'none'`. `expiresAt` is returned but
read by neither caller (both rely on React Query invalidation instead); harmless.

The fail-safe direction was checked path by path. `classifyVerify` only returns `resolved` — the sole
outcome that re-enables card authorisation — on `verified === true && liveHold === false && status ∈
{expired, captured, failed}`, and tests `liveHold !== false` so a missing or renamed field reads as
*live*:

| Function path | Reported | UI outcome | Placement |
|---|---|---|---|
| No PI recorded | `status:'none'` | `in_progress` | blocked |
| Stripe context unresolvable | `needsReview:true` | `needs_review` | blocked |
| `resource_missing` | `needsReview:true` | `needs_review` | blocked |
| Live hold (normal, and worker-owned) | `liveHold:true` | `live` | blocked |
| Mid-auth (`requires_action` etc.) | `liveHold:false`, status unchanged | `in_progress` | blocked |
| Lost CAS race | fresh status re-read | follows fresh status | correct |
| `wouldClobber` (`released`) | `status:'released'` | `in_progress` | blocked |
| **Conclusively dead** | `expired`/`captured`/`failed` | **`resolved`** | **unblocked** |

**No fail-open path exists.** The UI is strictly more conservative than the function.

Supporting contract details, all verified:

- **Auth.** `supabase.functions.invoke` forwards the signed-in operator's JWT. The function resolves
  `app_users` by `auth_user_id` (not `id`), rejects `is_active === false`, and 403s unless super-admin
  or same tenant. `app_users` really does have `auth_user_id`, `is_active`, `is_super_admin`,
  `tenant_id`. ✔
- **Errors.** `errorResponse` returns non-2xx JSON `{error}`; `invoke` resolves `{data:null, error}`
  rather than throwing; both callers unwrap via `extractFunctionError(error.context)`. ✔
- **Stripe context.** `verify-deposit-hold` resolves mode/account **identically** to
  `capture-deposit-hold` and `refresh-deposit-holds` (record-anchored on `rentals.platform_account`,
  mode from `tenants.stripe_mode`). `TENANT_STRIPE_COLUMNS` does include `stripe_mode`, so live holds
  are probed with live keys — no silent mode mismatch. ✔
- **Imports.** `getConnectAccountId`, `getStripeClientForRecord`, `TENANT_STRIPE_COLUMNS`,
  `StripeMode` are all real exports of `_shared/stripe-client.ts`. ✔
- **`config.toml`** registers `[functions.verify-deposit-hold] verify_jwt = true`. ✔

---

## 4. Schema check: NO dependency on the unapplied DDL — PASSES

Every one of the 25 new columns and 3 new tables in `docs/GMT_HOLD_SCHEMA.sql`
(`deposit_hold_connect_account_id`, `deposit_hold_status_changed_at`, `deposit_hold_expiry_source`,
`deposit_hold_card_*`, `disclosed_hold_*`, `deposit_hold_links`, `cron_runs`,
`rental_card_mandates`, …) was grepped across every `.ts`/`.tsx` in the repo.

> **Zero references. Nothing in the working tree touches the unapplied schema.**

All 26 `deposit_hold_status` write sites were enumerated. Every literal, and both dynamic writers
(`verify-deposit-hold`'s `PI_STATUS_TO_HOLD_STATUS`, and `deadStatus` from `probeRecordedHold` in
`create-hold-checkout` / `place-deposit-hold`), resolve inside the **current** CHECK constraint:
`processing | held | captured | released | expired | refreshing | failed | NULL`. None of the widened
values (`capturing`, `requires_action`, `needs_review`, `disputed`) is written anywhere — the
`needs_review` hits are the UI's client-side `VerifyOutcome` enum, never persisted.

**Conclusion: `docs/GMT_HOLD_SCHEMA.sql` is NOT a prerequisite for this deploy.** Do not apply it as
part of Gate 0. It belongs to Gate 1.

---

## 5. GMT's issue, traced end to end

**Setup:** 90-day rental. Stripe authorisation lapsed at ~day 7 and Stripe cancelled the PI.
`rentals.deposit_hold_status` still reads `'held'`; `deposit_hold_payment_intent_id` points at the
dead PI.

| Step | Before | After this change set |
|---|---|---|
| Operator opens the rental | Amber **Held** badge. No expiry shown anywhere in the portal. | Amber **Held** badge, **plus** a red *"Authorisation expires <date> · expired N days ago"* line — the first time this has ever been visible. |
| Row actions | Release, Charge. | Release, Charge, **+ "Check with Stripe"** (indigo, gated on `canEdit('rentals')`). |
| Operator clicks Check | *(did not exist)* | `verify-deposit-hold` probes the PI → `canceled` → compare-and-set on **both** status and the probed PI id → writes `'expired'` → toast *"Hold status corrected"*. |
| Row re-renders | — | **Expired** badge; actions become **Refresh & Charge** + **Add Hold**. |
| Operator clicks Add Hold → Place via Stripe | `create-hold-checkout` short-circuits on stale `'held'` → `hold_already_active` → **dead end**. | Status is now `'expired'`, the guard does not fire, Checkout opens. Even if it still read `'held'`, `create-hold-checkout` now runs its own liveness probe and self-heals. |
| Customer completes Checkout | Webhook booked the hold as **captured revenue** and FIFO-allocated it against real rent. | Webhook delegates to `sync-deposit-hold` and `break`s — no `payments` row, no `payment_status` write, no FIFO allocation. Closed-tab orphans are covered too. |

**The dead end is closed.** Remaining gaps in that path:

- **(BLOCKER, ordering)** `verify-deposit-hold` is not deployed. The button is live in the portal and
  404s. It degrades safely — the dialog re-enables placement and offers *"Check again"*; the rental
  page shows a destructive toast — but the fix does nothing until §6 step 1 runs.
- **(GAP)** If `deposit_hold_expires_at` is `NULL`, no expiry line renders at all
  (`describeHoldExpiry` returns null). Legacy rows may have no expiry, so the *early-warning* half of
  the fix is silent for them; the Check button still works.
- **(GAP)** `verify-deposit-hold` can write `deposit_hold_status='held'` while leaving
  `deposit_hold_expires_at` NULL (when Stripe has published no `capture_before`).
  `refresh-deposit-holds` selects with `.lt('deposit_hold_expires_at', …)`, and Postgres `<` excludes
  NULL — such a hold is **invisible to the refresh cron**. Narrow, but it is the same silent-death
  class this work exists to kill.
- **(GAP)** `sync-deposit-hold` returns `{skipped:'hold_already_held'}` without echoing which PI is
  recorded, so the webhook cannot tell "this session's PI is already stored" from "a *different* PI
  now occupies the row" — a live authorisation can still be left unrecorded with no alert.
- **(GAP)** `sync-deposit-hold` still re-derives the platform account from `tenants.payment_model` —
  the exact column the UK→UAE migration flips this week. See §7 item 1.

---

## 6. Deploy plan

**Prerequisites: none.** No schema, no migration. Do **not** apply `docs/GMT_HOLD_SCHEMA.sql` for
this deploy (§4). Project ref is `hviqoaokxvlancmftwuo`.

> **Never use `scripts/deploy-functions.sh` for these.** It passes `--no-verify-jwt`, which would
> deploy `verify-deposit-hold` **publicly callable** and defeat its new tenant-authorisation check.
> Use the commands below verbatim.

### Step 1 — unblock the already-live portal button (do this first)
```bash
npx supabase functions deploy verify-deposit-hold --project-ref hviqoaokxvlancmftwuo
```
New function, isolated, nothing else calls it. `verify_jwt = true` comes from `supabase/config.toml`;
do not override it.

### Step 2 — the write-side self-heal
```bash
npx supabase functions deploy create-hold-checkout  --project-ref hviqoaokxvlancmftwuo
npx supabase functions deploy place-deposit-hold    --project-ref hviqoaokxvlancmftwuo
```
Behaviour change for all 28 tenants: a stale `'held'` now self-heals instead of dead-ending, and
`place-deposit-hold` now **skips** a rental the refresh cron owns (`'refreshing'`) instead of claiming
it. Both are fail-safe directions.

### Step 3 — the webhooks (highest value, highest risk — stage it)
```bash
# 3a. TEST first, then run the §7 smoke tests before touching live.
npx supabase functions deploy stripe-webhook-test --project-ref hviqoaokxvlancmftwuo

# 3b. Only after 3a is confirmed green:
npx supabase functions deploy stripe-webhook-live --project-ref hviqoaokxvlancmftwuo

# 3c. Legacy handler, last:
npx supabase functions deploy stripe-webhook      --project-ref hviqoaokxvlancmftwuo
```
These carry the two ship-blockers (a cancelled hold PI can no longer cancel a rental; a hold checkout
is no longer booked as captured revenue) and a rewritten retry policy on the LIVE endpoint. They touch
money for every tenant. Watch the Stripe endpoint's failure-delivery rate for the first hour after 3b.

### Not deployed by anything above
`sync-deposit-hold` was **not modified** and must not be redeployed as part of this. Its two open
items are in §7.

---

## 7. Manual tests that must pass before this is called done

Run against **staging**. Note the standing project caveat: *staging shares prod's Stripe test account
and its webhooks fire into prod*, so scope card testing carefully.
The fuller matrix is in `docs/GMT_GATE0_TEST_PLAN.md`.

**T1 — the GMT scenario (the whole point).** Rental with `deposit_hold_status='held'` over a
PaymentIntent that is `canceled` at Stripe. Open the rental → red expiry line visible → **Check with
Stripe** → badge flips to **Expired** → **Add Hold** → Checkout opens → complete it → rental returns to
**Held** with a fresh PI and a *future* `deposit_hold_expires_at`.

**T2 — fail-safe on a LIVE hold.** Rental with a genuinely `requires_capture` PI. Check with Stripe
must report *live* and must **not** unblock placement. Confirm no second PaymentIntent is created.

**T3 — mid-authorisation.** PI in `requires_action`. Must report *"still being worked on"* and keep
both placement buttons disabled. This is the fail-open the review caught; it must stay closed.

**T4 — cross-tenant authorisation.** Call `verify-deposit-hold` with tenant A's operator JWT against
tenant B's rental id → **403**. Then repeat as a super-admin → allowed.

**T5 — EC-01, the rental killer.** Release a deposit hold on an **Active** rental and let
`payment_intent.canceled` fire. The rental must stay Active. Repeat for a legacy hold with **no PI
metadata** — the `rentals.deposit_hold_payment_intent_id` fallback must catch it.

**T6 — EC-02, phantom revenue.** Complete an "Add Hold" checkout and confirm afterwards: **no** new
`payments` row, `rentals.payment_status` unchanged, **no** FIFO allocation against rent charges, and
`deposit_hold_status='held'`.

**T7 — closed-tab orphan.** Complete the hold Checkout and close the tab before the redirect. The
webhook alone must record the hold.

**T8 — sync failure alerting.** Force `sync-deposit-hold` to fail (e.g. bad rental id). The webhook
must answer **200**, not retry forever, and a **"Deposit hold not recorded"** notification must land
in the portal bell for that tenant.

**T9 — viewer permissions.** A manager with *viewer* access on the rentals tab must not see **Check
with Stripe**, nor the new **Add Hold** on an expired row.

**T10 — regression for the other 27 tenants.** A rental at `deposit_hold_status='failed'` whose
deposit was later collected manually must still be **releasable** from the Security Deposit row. This
is the action-ladder regression the review caught; it is the single most likely way this change set
breaks someone who is not GMT.

---

## 8. Unfinished, risky, or needs a human decision

Blunt list. Nothing here is cosmetic-only unless it says so.

1. **`sync-deposit-hold` ignores the platform account the webhook now sends.** *(migration-week
   blocker, needs a human)* The webhooks now pass `{platformAccount, connectedAccountId}`, but
   `sync-deposit-hold` destructures only `{sessionId, rentalId}` (:24) and still re-derives the
   account via `getChargePlatformAccount(tenant)` (:63) — the column UK→UAE flips. A tenant flipped
   between checkout creation and webhook delivery makes `sessions.retrieve` 404. Outcome is now an
   operator alert rather than a silent orphan, which is better, but the hold is still unrecorded.
   **Decide before migration week.** The file was outside every workstream's remit.

2. **The ledger is still wrong for every pre-fix "Add Hold" checkout.** *(money-facing, open)*
   Historical `payments` rows carry `Completed`/captured status for money that was only *authorised*,
   are FIFO-allocated against real rent, and set `payment_status='fulfilled'`. EC-02 stops new damage;
   nothing unwinds the old. Identify by `stripe_checkout_session_id` on a `security_deposit_hold`
   session. **This needs a designed reconciliation — do not hand-edit payment/installment rows**
   (standing project rule). GMT's and other tenants' books currently show fabricated income.

3. **`hold_already_held` cannot distinguish "same PI" from "different PI".** *(minor, open)* Needs
   `sync-deposit-hold` to return `{skipped:'hold_already_held', paymentIntentId}` so the webhook can
   compare against `session.payment_intent`. Until then a retryable-failure-then-replacement sequence
   can strand a live authorisation with no alert.

4. **`place-deposit-hold` idempotency dead-end.** *(minor, open)* On the "Stripe created the PI but
   the DB write failed" path (:510-537) the dead `deposit_hold_payment_intent_id` survives, so the
   retry recomputes the identical key `deposit-hold-<rentalId>-recollect-<PI_A>`, Stripe replays the
   cached response and returns the now-cancelled PI → permanent 400 for the full 24h window.
   One-line fix: also null `deposit_hold_payment_intent_id` on that failure path.

5. **A stranded `'refreshing'` row is now un-placeable *and* un-healable.** *(minor, open)*
   `refresh-deposit-holds` writes `'refreshing'` before the Stripe call; an isolate killed on the
   wall-clock limit leaves it there forever, and its own driver query (`.eq(status,'held')`) never
   picks it up again. The new guard is the fail-safe direction and `release-deposit-hold` still
   accepts `'refreshing'` as an escape, but this needs either an operator note or a staleness escape
   hatch once `deposit_hold_status_changed_at` (Gate 1) lands.

6. **`verify` can resurrect a `'held'` with NULL expiry, invisible to the refresh cron.** *(minor,
   open)* See §5. Suggested: when Stripe publishes no deadline *and* the stored expiry is NULL, flag
   `needsReview` rather than writing `'held'`.

7. **`add-hold-dialog` can contradict itself.** *(minor, open)* `handleVerify` only ever *clears*
   `holdConflict`. After the catch path clears it, a later successful check reporting `live` leaves the
   buttons enabled under a banner saying the authorisation is live. Not a money bug —
   `create-hold-checkout` re-probes and refuses — but it invites a click it will reject.
   Fix: `setHoldConflict(outcome !== 'resolved' && outcome !== 'needs_review')`.

8. **Default-deny retry policy on `sync-deposit-hold` 5xx.** *(deliberate trade, monitor)* An
   unrecognised transient error gets exactly one attempt. Chosen because a disabled LIVE webhook
   endpoint is an outage for all 28 tenants, while an orphaned hold is recoverable via the new button.
   The `syncResponse.statusText` fallback is load-bearing — gateway 5xx carry no `error` key and match
   `"internal server error"` / `"service unavailable"` only through it. Do not "simplify" that line.

9. **`classifyVerify` is duplicated** in `add-hold-dialog.tsx` (:68) and `rentals/[id]/page.tsx`
   (:132). Only the dialog's copy is executed by tests; the page's is covered by a string match that
   would still pass if it were edited to fail open. **Hoist into `src/lib/` and point both tests at
   it.** Cheap, and it protects the blocker fix.

10. **Notification type `deposit_hold_sync_failed` is unknown to the portal bell's icon map.**
    *(cosmetic)* `notifications.type` has no CHECK constraint, so the insert cannot fail; it renders
    with a default icon.

11. **`609f1c4d` mixes workstreams** (§1). Any rollback must be file-scoped.

12. **`deno check` never ran** (Deno not installed here). esbuild parse is a syntax check, not a type
    check. Worth one run before step 3b.

---

## 9. Confirmation of constraints

- **No deploys.** No `supabase functions deploy`, no `db push`, nothing touched a live environment.
- **No commits or pushes by me.** The three commits and both pushes are the repo owner's, timestamped
  17:37/17:43 today (§1).
- **No migrations.** `supabase/migrations/` has **zero** changed files and **zero** untracked files
  since `22d5dd54`. Newest file there remains `20260807120000_cascade_vehicle_delete_blockers.sql`.
- **No schema dependency.** Verified exhaustively in §4.
