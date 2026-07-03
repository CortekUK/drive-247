# 🏋️ GYM-RETURN CHECKLIST — Own Stripe + UAE Migration

Everything is **built, integrated, typechecked, deployed (edge fns) and pushed**. What remains is ONLY what needs your hands: Stripe dashboard config + secrets + the test run.

## ✅ What got built while you were out
- **DB (applied in prod):** `tenants.payment_model` (managed/own), `subscription_account` (uk/uae), `own_stripe_(test_)account_id`, `platform_account` on payments/rentals, `stripe_account` on subscription tables
- **Shared clients:** dual-platform key routing (UK legacy + UAE), record-level routing for in-flight money
- **Subscriptions:** UAE capture link (bills exactly when UK period ends — zero double billing), dual-account webhook with race guards
- **Credits:** route by subscription account, UAE customer auto-created
- **Own Stripe:** OAuth start/callback (test+live), ALL ~44 connect functions swept (new charges follow tenant model; captures/refunds/deposits follow the record's original platform, forever)
- **Readiness checker:** blockers = UK deposit holds, uncaptured payments, **active installment plans**, **active auto-extend rentals**; warnings = pending Express balance, scheduled refunds, OAuth missing
- **Admin → tenant → Payments tab:** status, readiness button, UAE card link, OAuth links (test/live), UK-holds table, flip switch (auto-clears platform-scoped customer ids on flip)
- **Portal → Settings → Payments:** "Connect with Stripe" for own-model tenants

---

## 🙋 YOUR STEPS (in order)

### 1 — UAE dashboard: Connect + OAuth (~10 min)
- [ ] UAE Dashboard → **Connect → Get started** → complete platform profile (**Standard accounts**, direct charges)
- [ ] Connect → **Onboarding options → OAuth** → toggle **"OAuth for Standard accounts" ON**
- [ ] Copy **live** client id (`ca_…`); switch dashboard to test mode → copy **test** client id
- [ ] On the SAME OAuth page (both test & live): **add redirect URI**
      `https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/stripe-oauth-callback`

### 2 — UAE dashboard: webhooks (~10 min)
Register these endpoints on the **UAE** account (URLs identical to the old account's):
- [ ] `…/functions/v1/stripe-webhook-live` (live mode) → copy signing secret
- [ ] `…/functions/v1/stripe-webhook-test` (test mode) → copy signing secret
- [ ] `…/functions/v1/subscription-webhook` — **test AND live** — events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` → copy both secrets
- [ ] Connect webhook ("Events on connected accounts": `account.updated`, `account.application.deauthorized`) → `…/functions/v1/stripe-connect-webhook` → copy secret
- [ ] OLD account sanity check: confirm no endpoint still points at legacy `…/functions/v1/stripe-webhook` (the old one without -live/-test; it's dead code now)

### 3 — Supabase edge-function secrets (~5 min)
Dashboard → Project Settings → Edge Functions → add:
```
STRIPE_UAE_TEST_SECRET_KEY=sk_test_…          (UAE)
STRIPE_UAE_LIVE_SECRET_KEY=sk_live_…          (UAE)
STRIPE_UAE_TEST_PUBLISHABLE_KEY=pk_test_…
STRIPE_UAE_LIVE_PUBLISHABLE_KEY=pk_live_…
STRIPE_UAE_TEST_WEBHOOK_SECRET=whsec_…        (booking webhook, test)
STRIPE_UAE_LIVE_WEBHOOK_SECRET=whsec_…        (booking webhook, live)
STRIPE_UAE_SUBSCRIPTION_TEST_WEBHOOK_SECRET=whsec_…
STRIPE_UAE_SUBSCRIPTION_LIVE_WEBHOOK_SECRET=whsec_…
STRIPE_UAE_CONNECT_WEBHOOK_SECRET=whsec_…
STRIPE_UAE_OAUTH_CLIENT_ID_TEST=ca_…
STRIPE_UAE_OAUTH_CLIENT_ID_LIVE=ca_…
```
(Optional, only if e-sign metered billing continues on UAE: `STRIPE_UAE_ESIGN_METERED_PRICE_ID_TEST/LIVE`.)
⚠️ Set UAE secret keys and UAE webhook secrets TOGETHER — a webhook secret without its key makes UAE events fail with retries.

### 4 — Test run on the "test" tenant (~15 min)
- [ ] Admin → Rental Companies → **test** tenant → **Payments tab** (new!)
- [ ] Click **Check Migration Readiness** → expect it to answer with reasons
- [ ] **Generate OAuth link (test)** → open it yourself → connect ANY test Stripe account → should bounce back with "Stripe connected"
- [ ] **Flip to Own Stripe** (test tenant is in test mode → uses the test OAuth account)
- [ ] Booking site (test tenant) → make a test booking with `4242 4242 4242 4242` → confirm the payment lands in the **connected test account** and the rental/payment rows show `platform_account='uae'`
- [ ] Subscription: create a plan for test tenant (admin) → **Generate UAE card link** → pay with test card → check `tenant_subscriptions.stripe_account='uae'` + `tenants.subscription_account='uae'`
- [ ] Credits: buy a small test credit pack → verify charge on UAE

### 5 — If all green: first real client today 🚀
Suggested first: **GoNiko or Jangram** (small, no PAYG/auto-extension long-runners).
Runbook per tenant (all from the Payments tab):
1. **Check Migration Readiness** → fix any red (readiness enforces: no UK holds, no uncaptured payments, no active installment plans, no auto-extend rentals)
2. **Generate UAE card link** → send to operator → they pay → subscription auto-flips to UAE, old UK sub cancels at period end
3. **Generate OAuth link (live)** → send → operator connects their own Stripe
4. **Flip to Own Stripe** → watch first booking/deposit land in their account
5. In-flight UK rentals finish out on the old account automatically

---

## ⚠️ Known corners (handled, but be aware)
- **Saved cards don't cross platforms.** Flip clears `customers.stripe_customer_id` automatically; customers get recreated on UAE at next charge. Readiness blocks flips while installment plans / auto-extend rentals still need UK saved cards.
- **UAE-side pre-auth/extended-auth features:** the new Standard accounts may need the same extended_authorization approval as before — the graceful-downgrade fix from June 25 already covers this (holds fall back to 7-day + refresh cron).
- **Stripe's UAE OAuth gate:** if the UAE dashboard blocks the Connect platform profile or OAuth toggle (needs sales), that's the ONE external dependency — everything else still works (subscriptions + credits don't need Connect at all).
- Booking webhooks are registered on BOTH accounts during migration; verification tries both secrets — expected, not a bug.
