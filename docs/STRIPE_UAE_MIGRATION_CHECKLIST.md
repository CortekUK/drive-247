# Stripe Account Migration Checklist

Moving off the ex-partner's **"Cortek US"** account (`acct_1SqMDfB2eFJBbbzi`) → a **new self-owned account**, configured as an identical twin, then migrating tenants one-by-one until the old account is empty and retired.

**Label key (in front of every task):**
- **✅ CLAUDE** — I can do this myself (code / API / MCP)
- **🙋 YOU** — I need you (dashboard / Stripe support / business / keys)
- **⏭️ SKIP** — not needed

---

## ⛳ Phase 0 — Decisions & new account setup
- [x] **🙋 YOU** — ✅ **DECIDED: UAE.** (Consequence: US-based operators can't use Connect on UAE — handled later, separately. Focus now = stand up the identical UAE account, subscriptions first.)
- [x] **🙋 YOU** — ✅ UAE Stripe account created
- [ ] **🙋 YOU** — If UAE: contact Stripe Sales to enable Connect (not self-serve in UAE; request Custom/Express + `destination_charges` + `separate charges & transfers`)
- [ ] **🙋 YOU** — Enable products on new account: Billing, Connect, Customer Portal, Radar, Tax (match the old account)
- [ ] **🙋 YOU** — Generate test + live keys: secret + publishable
- [ ] **🙋 YOU** — Hand keys to Claude OR load directly into Supabase secrets

---

## 📦 Phase 1 — Make the new account a config-identical twin

### 1a. Blueprint export (from old account)
- [x] **✅ CLAUDE** — ✅ DONE → `docs/stripe-uae-blueprint.md` (products, prices, amounts, currencies, trials per tenant; coupons=none; found 2 old accounts)
- [ ] **🙋 YOU** — Review the exported spec; mark which duplicate plan-tier products to drop

### 1b. Recreate via API (on new account)
- [ ] **✅ CLAUDE** — Recreate master product **Drive247 Platform Subscription**
- [ ] **✅ CLAUDE** — Recreate plan tiers (Incubator / Launch / Growth) — clean, no duplicates
- [ ] **✅ CLAUDE** — Recreate setup / onboarding fee products
- [ ] **✅ CLAUDE** — Recreate coupons / promo codes
- [ ] **✅ CLAUDE** — Capture all new `price_…` / `prod_…` IDs → mapping file (old ID → new ID)
- [ ] **⏭️ SKIP** — Credit packs (`Drive247 Credits (N)`) — auto-created per purchase

### 1c. Dashboard config (can't be done by API)
- [ ] **🙋 YOU** — Connect platform profile: business name, brand colour, icon/logo
- [ ] **🙋 YOU** — Customer Portal settings (subscription management options)
- [ ] **🙋 YOU** — Radar rules (copy any custom rules)
- [ ] **🙋 YOU** — Stripe Tax settings (if used)
- [ ] **🙋 YOU** — Statement descriptor

### 1d. Webhooks (register same URLs on new account → new signing secrets)
- [ ] **🙋 YOU** — `stripe-webhook-live`
- [ ] **🙋 YOU** — `stripe-webhook-test`
- [ ] **🙋 YOU** — `stripe-connect-webhook`
- [ ] **🙋 YOU** — `subscription-webhook`
- [ ] **🙋 YOU** — Send all 4 new signing secrets to Claude

---

## 🛠️ Phase 2 — Codebase: dual-account routing
- [ ] **✅ CLAUDE** — Migration: add `tenants.stripe_platform_account` (`'uk'` | `'ae'`, default `'uk'`)
- [ ] **✅ CLAUDE** — Extend `_shared/stripe-client.ts`: `getStripeClient(mode, account)`, `getPublishableKey`, `getWebhookSecret`, `getConnectWebhookSecret`, `getConnectAccountId`, + `getTenantStripeAccount()`
- [ ] **✅ CLAUDE** — Update subscription edge functions to route by tenant's account
- [ ] **✅ CLAUDE** — Webhook fns verify against both signing secrets (one URL serves both accounts)
- [ ] **✅ CLAUDE** — Frontend publishable-key resolution per account
- [ ] **🙋 YOU** — Add UAE-variant secrets to Supabase: `STRIPE_LIVE_SECRET_KEY_AE`, `STRIPE_TEST_SECRET_KEY_AE`, `STRIPE_LIVE_PUBLISHABLE_KEY_AE`, `STRIPE_TEST_PUBLISHABLE_KEY_AE`, `STRIPE_LIVE_WEBHOOK_SECRET_AE`, `STRIPE_TEST_WEBHOOK_SECRET_AE`, `STRIPE_CONNECT_WEBHOOK_SECRET_AE`, `STRIPE_SUBSCRIPTION_SECRET_KEY_AE`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET_AE`, `STRIPE_TEST_CONNECT_ACCOUNT_ID_AE`
- [ ] **✅ CLAUDE** — Deploy edge functions + push to main (Vercel)
- [ ] **✅ CLAUDE** — Smoke-test: one test tenant flagged `'ae'` → checkout + webhook round-trip

---

## 🔁 Phase 3 — Migrate tenants one-by-one (per tenant, later)
For **each** operator, in order:
- [ ] **🙋 YOU** — Subscription card → Stripe self-serve PAN copy (old → new account)
- [ ] **✅ CLAUDE** — Recreate the live subscription via Billing migration toolkit on new account
- [ ] **🙋 YOU** — Connect → operator re-onboards on new account (new KYC/bank — unavoidable). ⚠️ UAE only allows this for UAE-based operators; US operators = separate decision
- [ ] **✅ CLAUDE** — Flip that tenant's `stripe_platform_account` → `'ae'`
- [ ] **✅ CLAUDE** — Verify: booking payment + subscription both work on new account
- [ ] ℹ️ History / balance / payouts stay on old account (always)

**Migration order** (suggested — smallest/lowest-risk first): _____________________

---

## 🏁 Phase 4 — Retire old account
- [ ] **✅ CLAUDE** — Confirm every tenant = `stripe_platform_account = 'ae'`
- [ ] **🙋 YOU** — Confirm no live charges/subscriptions remain on old account
- [ ] **🙋 YOU** — Revoke old account from the integration / disconnect MCP
- [ ] **🙋 YOU** — Remove old `STRIPE_*` (non-`_AE`) secrets from Supabase
- [ ] **✅ CLAUDE** — Drop the `'uk'` branch from routing code (single-account again)

---

## 🚦 Blocked on (right now)
1. **🙋 YOU** — UAE vs UK/US country decision
2. **🙋 YOU** — New account created + API keys

## ▶️ Next action (unblocked, safe)
- **✅ CLAUDE** — Run Phase 1a blueprint export off the old account (read-only) — say "go"
