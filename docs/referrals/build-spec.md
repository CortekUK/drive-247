# Promo Codes + Operator Referral Programme: Build Spec

| | |
|---|---|
| **Owner** | Haris |
| **Product owner / reviewer** | Ghulam (reviews every PR) |
| **Written** | 2026-09-22, from Ghulam's requirements conversation (repo at `main` `551a970c`) |
| **Status** | Scope agreed. **Nothing is built.** |
| **Read first** | `V2_PLAN.md` (repo root), especially §0, §2, §3, §4, §5, §7, §10 |

> **Note to the AI reading this:** this document is the complete brief. Section 2 is the
> plain-language story; explain it to Haris first. Section 3 lists what Ghulam has
> **decided** (do not re-open these). Section 4 lists what is **recommended but not yet
> confirmed**; ask Ghulam before building those parts. Line numbers were correct on
> 2026-09-22 and may have drifted, so re-check before editing.

---

## Table of contents

1. What we are building (one paragraph)
2. The story, step by step
3. Decisions Ghulam has made (locked)
4. Recommendations that need Ghulam's confirmation
5. Glossary
6. How the current system works (what you are plugging into)
7. Stripe design
8. Data model
9. Backend: edge functions and the referral engine
10. Where a code enters a checkout (all entry points)
11. Screens
12. Business rules and edge cases
13. Code format
14. Build order, with acceptance criteria per phase
15. Test plan
16. V2_PLAN compliance checklist
17. Open questions to ask Ghulam
18. File reference index

---

## 1. What we are building

A **platform promo code system** for Drive247 subscriptions (what Drive247 charges rental
operators). Super admin creates and manages every code from a new **Promo Codes** tab.

There are two kinds of code, one system:

- **Campaign codes.** Drive247's own codes, e.g. `LAUNCH50`, giving a new operator money off
  their subscription.
- **Referral codes.** Every operator automatically gets their own code, e.g. `SUNSET-4821`,
  plus a referral link. When a new operator subscribes with that code, **the new operator
  gets a discount** (e.g. 20% off for 3 months) **and the referring operator moves up a
  tier**. Their own subscription gets a standing discount (e.g. 10% / 20% / 30%) that grows
  with the number of operators they have referred who are still subscribed.

Every operator has a **Referrals** page in their portal sidebar showing their code, link,
current tier and who they referred. There is also a **manual fallback**: if someone was
referred but did not use the code, super admin attaches the referral by hand.

This has nothing to do with renter bookings, Stripe Connect, or the existing renter-side
`promocodes` / `promotions` tables (§6.9).

---

## 2. The story, step by step

The characters are **Kristen**, an existing operator who runs "Sunset Rentals", **Jangram**,
a new operator, and **George**, from Drive247 sales. The names are illustrative.

### 2.1 Main flow: Kristen shares her code or link

1. Kristen logs into her portal and clicks **Referrals** in the sidebar.
2. Her Referrals page shows:
   - her code `SUNSET-4821` and her link `https://drive-247.com/r/SUNSET-4821`, each with a Copy button;
   - her **current tier** (e.g. "Tier 1: 10% off every bill") and how many more subscribed
     referrals she needs for the next tier;
   - what a new operator gets (e.g. "20% off their first 3 months");
   - the list of operators she referred and whether each is still subscribed;
   - how much she has saved so far.
3. She sends the link (or just the code) to Jangram, e.g. on WhatsApp.
4. Jangram opens the link and lands on the Drive247 landing page. The code is remembered,
   and a banner says: *"Sunset Rentals invited you: 20% off your first 3 months."*
5. Jangram picks a plan. Plan cards and checkout show the discounted price (strikethrough on
   the original).
6. At checkout the code is already filled in. He pays and subscribes.
7. Jangram is now in his own portal. His Referrals page (every operator has one) and billing
   page tell him: *"You joined with Sunset Rentals' code: 20% off until 22 Dec 2026 (2 bills left)."*
8. **As soon as Jangram subscribes**, Kristen's count of subscribed referrals goes up by one.
   Her tier is recalculated, and **her next bill** is reduced by her tier discount. Her page
   shows the new tier, and Trax tells her about it by email and in the portal.
9. Jangram automatically gets his own referral code too, and can start referring others.

### 2.2 Sales-call flow: George does it from super admin

Most new operators do not self-serve. They book a strategy call and sales sends them a
payment link (see §6.1–6.2 for numbers). On the call, Jangram says "Kristen told me about you".

- **Option A:** George opens **Super admin → Promo Codes**, finds Sunset Rentals' referral
  code and copies the **referral link**, then sends it to Jangram. From here it is the main
  flow (2.1 step 4 onward).
- **Option B:** George onboards Jangram himself (Sales Onboarding dialog). When the
  **subscription payment link** is created, George picks `SUNSET-4821` in a "Promo /
  referral code" field. The payment page Jangram opens already shows the discount and the
  banner. Rest of the process is the same: when Jangram subscribes, Kristen's count goes up by one.
- **Option C:** George forgot to pick the code. The payment page has a **"Have a promo
  code?"** field and Jangram types it in himself.

If the lead came in through Kristen's link before the strategy call, the code is already on
the lead (contact request). George sees "Came via SUNSET-4821" and the code is pre-selected
on the payment link.

### 2.3 Manual fallback

Jangram subscribed without any code, and later Kristen tells us "Jangram came from me".

1. Super admin opens **Promo Codes → Referrals → Attach referral**.
2. Picks referrer = Sunset Rentals and new operator = Jangram Rentals, and adds a note.
3. Optionally ticks "Also give Jangram the new-operator discount". It then applies from
   Jangram's next bill.
4. Kristen's count goes up by one immediately; her tier and next bill update exactly as in 2.1 step 8.

Super admin can also **void** a referral (wrong attribution, fraud). The referrer's count and
tier then drop, taking effect from their next bill.

### 2.4 Drive247 campaign codes

Super admin creates e.g. `LAUNCH50`: 50% off for 3 months, expires 31 Oct, max 20 uses,
new operators only. A new operator types it at checkout (self-serve or payment link) and
gets the discount. Nobody's tier changes, because a campaign code has no owner.

### 2.5 When a referred operator leaves

If Jangram cancels, he stops counting toward Kristen's tier. Her tier is recalculated and
her discount adjusts from her next bill (see §4 R1). Trax tells her.

---

## 3. Decisions Ghulam has made (locked; do not re-open)

| # | Decision |
|---|---|
| D1 | **Promo codes are the core mechanism.** A referral code is simply a promo code owned by an operator. One promo code system serves both Drive247 campaign codes and operator referral codes. |
| D2 | **Each operator also gets a referral link**, which is a shortcut that carries the code (the link auto-applies it). Both the code and the link are shown on the operator's page and in super admin. |
| D3 | **Super admin has full control** from a **Promo Codes tab**, which lists every promo code and every operator's referral code and link. |
| D4 | **Sales can send an operator's referral link from super admin** (§2.2 Option A). The rest of the process is identical. |
| D5 | **The referrer's discount is tiered**: more referred operators means a bigger discount on their own subscription. |
| D6 | **The tier table is configurable per operator** from super admin. There is a **platform default tier table** (§3.1), and super admin can override the tiers and the discount per tier for any individual operator. |
| D7 | **The new operator's discount is configurable per operator** from super admin (the discount Kristen's code gives), with a platform default. It can be a **percentage or a fixed amount**, for a number of months (default 3). |
| D8 | **The referrer's discount applies as soon as the referred operator subscribes.** It does **not** wait for their first real payment. It takes effect on the referrer's next bill. |
| D9 | **The new operator sees the discount at checkout**, via a banner and the discounted price, and in their portal afterwards, including how long it lasts. |
| D10 | **Code format: `{BRAND}-{DIGITS}`**, i.e. the operator's business name, a hyphen, and a unique short number (§13). |
| D11 | **One code per checkout.** A campaign code and a referral code can never be combined. |
| D12 | **Manual fallback exists**: super admin can attach a referral that did not use a code (§2.3). |
| D13 | **Haris implements. The spec is Ghulam's; Ghulam reviews every PR.** |

### 3.1 Platform defaults (editable in super admin)

**Default referrer tier table.** The count is operators referred who are currently subscribed.

| Tier | Subscribed referrals | Referrer's discount on every bill |
|---|---|---|
| 1 | 1–2 | 10% |
| 2 | 3–4 | 20% |
| 3 | 5 or more | 30% |

Each tier row stores `min_active_referrals`, `discount_type` (`percent` or `fixed`) and
`discount_value`. The highest tier whose minimum is met wins. With 0 subscribed referrals
there is no discount.

**Tiers are levels, NOT cumulative (confirmed by Ghulam, 2026-09-22).** The referrer gets the
discount of the tier they are currently in, never one discount per referral added together.
The discount starts with the **first** subscribed referral. Extra referrals inside the same
tier do not add anything; they only move the referrer closer to the next tier.

| Subscribed referrals | Referrer's discount | Why |
|---|---|---|
| 0 | none | no tier reached |
| 1 | **10%** | Tier 1 starts at the first referral |
| 2 | **10%** (not 20%) | still Tier 1; it does not add up |
| 3 | **20%** | Tier 2 |
| 4 | **20%** | still Tier 2 |
| 5, 6, 7… | **30%** | Tier 3, the top tier |

Implementation rule: `discount = discount_value of the single highest tier where
min_active_referrals <= active_referrals`. **Never sum tier values**, and never add a coupon per
referral. The referrer carries exactly **one** `d247-ref-tier-*` coupon at a time (§7.2).

Because tiers are configurable per operator (D6), super admin can still build a
"one step per referral" ladder when wanted, e.g. rows `1 → 10%`, `2 → 20%`, `3 → 30%`,
`4 → 40%`, `5 → 50%`. It is the same mechanism with more rows, still one discount at a time,
still not summed. The UI should make this clear with a live preview in the tier editor
(e.g. "With 2 subscribed referrals: 10% off every bill").

**Default new-operator (referee) discount:** 20% off for 3 months. It stores
`discount_type` (`percent` / `fixed`), `discount_value`, `duration` (`once` / `repeating` /
`forever`) and `duration_months` (for `repeating`).

---

## 4. Recommendations that need Ghulam's confirmation

Build these as the default behaviour unless Ghulam says otherwise. Each is a small switch
if he changes his mind. They are listed again in §17 as questions.

| # | Recommendation | Why |
|---|---|---|
| R1 | A referral **counts toward the tier only while the referred operator's subscription is live** (`active`, `trialing` or `past_due`). Canceled, unpaid or expired referrals stop counting, and the tier drops from the next bill. | Otherwise operators keep a permanent discount for referrals who have left. It also makes D8 (applying the discount immediately) safe: if Jangram cancels before ever paying, Kristen's tier corrects itself. |
| R2 | Discounts apply to the **base subscription only**, not to metered e-sign usage or other add-on lines (use Stripe coupon `applies_to.products`). | A percentage coupon otherwise also discounts usage charges and the $1 card-verification line (§7.6). |
| R3 | **Sales agents** (`app_users.is_sales_agent`) can view codes, copy links and pick a code on a payment link. **Only super admins** can create or edit campaign codes, tiers and discounts, attach or void referrals, and change programme settings. | Money-affecting actions stay with super admins. |
| R4 | The digit part of the code is **4 digits** by default. The length is a programme setting (3, 4 or 6). Ghulam mentioned all three. | 4 digits = 10,000 codes per brand prefix, short enough to say on a call. |
| R5 | Referral-link visitors **see the pricing plans even though the landing-page pricing switch is OFF in production** (`admin_settings.landing_pricing_enabled = false` today). | Ghulam's story has Jangram picking a plan on the landing page, and today he would see no plans. |
| R6 | Build a small **"Someone joined because of me"** form on the operator's Referrals page. It creates a claim in super admin's queue, which super admin approves via the manual attach. | Makes "they can just tell us" structured. Optional; Phase 4. |
| R7 | Tell the referrer when their tier goes **down** too (Trax, polite, factual). | No surprise when a bill goes up. |
| R8 | Promo codes apply only to **new subscriptions** (self-serve signup and sales payment links). Not to an existing tenant re-subscribing through the portal (`create-subscription-checkout`), and not to the UK→UAE migration checkout. | Keeps scope tight. Super admin already has a one-time discount tool for existing tenants. |

---

## 5. Glossary

| Term | Meaning |
|---|---|
| **Operator / tenant** | A rental company using Drive247. Row in `public.tenants`. |
| **Referrer** | The operator whose referral code was used (Kristen). |
| **Referee / new operator** | The operator who subscribed with the code (Jangram). |
| **Promo code** | A customer-facing code that gives money off a Drive247 subscription. Row in `platform_promo_codes`, mirrored as a Stripe Promotion Code. |
| **Campaign code** | Promo code created by super admin, with no owner, e.g. `LAUNCH50`. |
| **Referral code** | Promo code owned by an operator, auto-generated, e.g. `SUNSET-4821`. |
| **Referral link** | `https://drive-247.com/r/{CODE}`, which auto-applies the code. |
| **Referral** | The link between a referrer and a referee (row in `referrals`). |
| **Active referral** | A referral whose referee currently has a live subscription (R1). |
| **Tier** | The referrer's discount level, chosen by their number of active referrals. Levels, **not cumulative**: 2 referrals in a 10% tier = 10%, not 20% (§3.1). |
| **Tier discount** | A standing (`forever`) Stripe coupon on the referrer's subscription, swapped when the tier changes. |
| **Referee discount** | The coupon behind the referral code, e.g. 20% for 3 months. |
| **Redemption** | A code actually used on a new subscription (row in `promo_code_redemptions`). |

---

## 6. How the current system works (what you are plugging into)

### 6.1 Numbers that shape the design (production, 2026-09-22)

- 38 live platform subscriptions, **all USD, all monthly**, averaging about $207/mo (range $1–$425).
  35 are on the **UAE** Stripe account and 3 on the **UK** account.
- About 15 new operators a month.
- **352 of 384 leads (`contact_requests`) come from the strategy-call form.** Only 3 self-serve
  signups have ever completed. 12 sales payment links (`subscription_links`) have been paid, and
  there were 26 sales onboardings in the last 60 days.
  → **The sales payment-link path matters most.** The code must work there, not only in self-serve.

### 6.2 How operators end up subscribed today: three paths

**A. Self-serve signup** (marketing site `apps/web`, all on the **UAE** account; mode from env
`SIGNUP_STRIPE_MODE`, default live)
- The pricing section on the landing page shows only when `admin_settings.landing_pricing_enabled`
  is true (`apps/web/src/lib/landing-pricing-server.ts`; `(marketing)/page.tsx:26-39`).
  **It is currently OFF in production.**
- Plan cards: `apps/web/src/components/pricing/plan-card.tsx:57-58` → `onboarding.open(plan.id)`
  (`onboarding-provider.tsx:1081`). Plans come from `signup_plans` (global, not per tenant).
- Edge functions, in order:
  1. `signup-begin` (public). Creates the auth user and stamps `app_metadata.d247_signup`
     (`_shared/signup-state.ts:77-121`). Only the service role can write it, so it is tamper-proof.
  2. `signup-payment-intent`. Creates the Stripe Customer and a **Subscription with
     `payment_behavior: "default_incomplete"`** (`:350-370`). No trial and no discounts
     today. The browser confirms the first invoice's PaymentIntent. Note: the response
     `amountCents` is the plan price (`:219,240,413`), and the idempotency key (`:369`)
     does not include a discount.
  3. `signup-resume` and `signup-provision`. Provision **inserts the `tenants` row at `:972-995`**,
     upserts `tenant_subscriptions` (`:1179-1210`), then adds `tenant_id` to the Stripe
     sub/customer metadata (`:1278-1289`).
- **Two redirects drop the query string:** Google OAuth (`?signup=google`,
  `onboarding-provider.tsx:1502`) and the Stripe return (`/?signup=resume`,
  `steps/payment-step.tsx:449`). A code must therefore be saved to localStorage/cookie on
  arrival. Existing localStorage keys: `d247-signup-tenant-draft`, `d247-signup-oauth-pending`
  (`tenant-draft.ts:48-49`).

**B. Sales-led (the main path)**
- A lead comes from the strategy-call form: server action `apps/web/src/actions/strategy-call.ts:20`
  (`submitStrategyCallAction`, calls an RPC at `:71`) → `contact_requests`. Super admin views
  leads at `/admin/contacts`.
- Super admin or a sales agent runs **Sales Onboarding**
  (`apps/admin/components/admin/SalesOnboardingDialog.tsx`) → `create-sales-onboarding`
  (auth: `is_super_admin || is_sales_agent`, `:940`). It inserts the tenant
  (`subscription_account: "uae"`) and a `subscription_plans` row (`trial_days: 0`,
  `billing_model: "trial"`).
- The dialog then calls **`create-subscription-link`** with `kind: 'first'` (`SalesOnboardingDialog.tsx:533-535`)
  → `issueSubscriptionLink` (`_shared/subscription-link.ts:168`). It moves the price onto the
  tenant's account (`ensurePlanPriceOnAccount`, `:91-128`) and **freezes a snapshot** of
  amount, account, mode and price onto the `subscription_links` row (`:343-363`).
  Redemption refuses anything that has drifted from the snapshot (`:286-291`).
- The operator opens `https://drive-247.com/subscribe/{token}` (`apps/web/src/app/subscribe/[token]/page.tsx`,
  calls the `subscription-link` function at `:83`). A POST to **`subscription-link`** creates a
  **Stripe Checkout Session** (`subscription-link/index.ts:429-465`): `mode: "subscription"`,
  metadata incl. `subscription_link_id`, `trial_end` / `trial_period_days` for deferred
  plans, and a **$1 verification line** when the first charge is deferred (`:395-407`).
  There are no `discounts` and no `allow_promotion_codes` today.

**C. Portal re-subscribe.** `create-subscription-checkout` (`:316-369`), for existing tenants.
**Out of scope** (R8).

### 6.3 The subscription webhook and reconciler

- `supabase/functions/subscription-webhook/index.ts` handles checkout, subscription and invoice
  events (switch at `:93-150`). `invoice.paid` → `handleInvoicePaid` (`:1144`) upserts
  `tenant_subscription_invoices` (`:1207-1235`). It has **no event-id idempotency guard**, and
  delivery is at-least-once.
- `reconcile-subscriptions` runs **hourly** (`'17 * * * *'`). It upserts subscription and invoice
  rows directly **without replaying events**.
- **Consequence:** do **not** hang referral logic on the webhook. A dropped event would lose it,
  and V2_PLAN §7 forbids branching existing webhooks. Instead, the new **referral engine**
  (§9.3) reads `tenant_subscriptions`, which both the webhook and the reconciler keep current.

### 6.4 The two Stripe accounts × two modes

- Helper: `supabase/functions/_shared/subscription-stripe.ts`. **Stripe SDK `stripe@14.21.0`,
  API version pinned `2023-10-16`** (`:52, :111`).
  - `getSubscriptionStripeClientForAccount(account, mode)` (`:100-114`): `uk` uses
    `STRIPE_SUBSCRIPTION_{LIVE,TEST}_SECRET_KEY`, `uae` uses `STRIPE_UAE_{LIVE,TEST}_SECRET_KEY`.
  - Mode comes from `tenants.subscription_stripe_mode`, account from `tenants.subscription_account`.
- Coupons, promotion codes, customers and prices exist **per account and per mode**. A code
  must be mirrored to each account/mode it is used on (§8.2).
- **Always act on the account recorded on the tenant's live `tenant_subscriptions` row**
  (`stripe_account`), not the tenant default. These differ for some tenants (9 of 47 have a
  mismatched plan account, per `_shared/subscription-link.ts:296`).
- `northwind` (the v2 canary) is on **UAE, test mode**, so it is ideal for testing.

### 6.5 The existing super-admin discount tool (MUST be updated)

- `supabase/functions/apply-subscription-discount/index.ts` creates a `duration: "once"`
  coupon and attaches it with **`stripe.subscriptions.update(subId, { coupon })`** (`:132`).
  `remove` calls `deleteDiscount` (`:93-100`), and `get` reads the legacy single `sub.discount`
  (`:88-91`).
- UI: tenant detail page `apps/admin/app/admin/(protected)/rentals/[id]/page.tsx`. It has the
  "Discount next invoice" button (`:2172-2176`), the "−X% next invoice" chip (`:2303-2318`) and
  a modal at `:2933`. It calls the function at `:696` (get), `:742` (apply) and `:761` (remove).
- **Why it must change.** Per Stripe's docs:
  - the deprecated `coupon` param **replaces** the subscription's discounts, so it would wipe
    Kristen's tier discount;
  - once a subscription has **more than one discount** set via the `discounts` array, updating
    it with the deprecated `coupon` param **errors out**.

  → Rework it to use the `discounts` array: append its own once-coupon, remove only its own
  entry, and read and list all discounts. This edits a live v1 function, which V2_PLAN §7 only
  allows as a real bug fix. **Get Ghulam's explicit OK** (§17 Q5). It is a hard prerequisite
  before any tier discount goes live.

### 6.6 Other existing things worth knowing

- **The welcome pack already promises a referral programme**, run by hand today ("tell us who
  they are… normally applied as a credit against your subscription"). Content is in the
  `welcome_pack_*` tables, seeded in `supabase/migrations/20260815150100_seed_welcome_pack_content.sql:970-990`
  and `:1209`, and managed from `/admin/welcome-pack`. **Update that copy** when this ships
  (Phase 5) so it points to the Referrals page.
- The portal first-run wizard asks "How did you hear about Drive247?", with option
  `word_of_mouth` = "Another operator told me" (`apps/portal/src/lib/first-run-questions.ts:133-145`).
  Optional hook: prompt "Who referred you?", which creates a claim (R6).
- `change-subscription-price` swaps the plan item only (`:203-216`), so discounts survive a price change.
- `create-uae-subscription-capture` (UK→UAE migration) creates a **new** subscription on UAE.
  The engine will re-apply the tier discount to the new live subscription automatically.
  A referee's *remaining* months are not carried over; handle this rare case manually (§12).

### 6.7 Portal structure (for the Referrals page)

- v2 gating: `apps/portal/src/lib/v2.ts`. `V2_AREAS` is at `:86-149`, all `[NORTHWIND]`. A tenant
  with `tenants.portal_experience = 'v2'` gets **every** area (`:210`); today that is northwind,
  nasir and squad. Server check: `serverIsV2(area)`; client: `useV2(area)`
  (`lib/v2-context.tsx:82`). Route pattern: `if (!(await serverIsV2('insights'))) notFound();`
  (`app/(dashboard)/insights/page.tsx:57-59`).
- Sidebars:
  - v2 `components/shared/layout/app-sidebar-v2.tsx`. Its fixed rows (Dashboard, Integrations,
    **Billing**, Welcome) are hand-written at `:1514-1605`; Billing is at `:1564-1576`, and the
    `fixedRows` list is at `:780-782`. The fixed rows are **not** manager-filtered.
  - v1 `components/shared/layout/app-sidebar.tsx`. Nav groups are at `:315-404`, and manager
    filtering via `ROUTE_TO_TAB` is at `:412-415`.
- Permissions: `src/lib/permissions.ts`. An unmapped route is **allowed** for managers
  (`hooks/use-manager-permissions.ts:109`). Map `/referrals` to the existing
  `settings.subscription` key in `ROUTE_TO_TAB` (`:145-224`); a new key would need edge-function
  allow-list changes and a backfill.
- Billing today: `app/(dashboard)/subscription/page.tsx` (v1, uses `useV2("chrome")` at `:142`);
  hooks `use-tenant-subscription.ts`, `use-subscription-plans.ts`.
- Reusable copy-to-clipboard UI: `CopyValue` in `app/(dashboard)/integrations/_panels/_kit.tsx:290-312`
  (route-private, so move it to a shared v2 location), and the "Apply link" row in
  `settings/lead-management/page.tsx:166-185`.
- Marketing URL constant: `lib/legal/urls.ts:20-21`,
  `MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL || "https://drive-247.com"`.

### 6.8 Admin app structure

- Pages live in `apps/admin/app/admin/(protected)/`. The sidebar is
  `apps/admin/components/admin/Sidebar.tsx`: **Management** group at `:82-97` (next to "Signup Plans").
- **`apps/admin` is `strict: true` with no `ignoreBuildErrors`, so a type error fails the build.**
- Super-admin check pattern: `verifySuperAdmin` in `apply-subscription-discount/index.ts`
  (reads `app_users.is_super_admin` by `auth_user_id`).

### 6.9 Name collision warning

`public.promocodes` and `public.promotions` already exist. They are **renter-side booking promo codes**
owned by each operator (portal `settings-v2/promo-codes-section-v2.tsx`). **Do not reuse or
extend them.** The new tables are prefixed `platform_` / `referral_`. Everywhere in the UI,
call the new thing "Drive247 promo codes" or "subscription promo codes" to avoid confusion.

---

## 7. Stripe design

### 7.1 Referee discount = Stripe Promotion Code → Coupon

- Each `platform_promo_codes` row (campaign or referral) maps to **one Stripe Coupon + one
  Promotion Code per (account, mode)**, created **lazily** the first time the code is used on
  that account/mode. Copy the lazy pattern from `ensurePlanPriceOnAccount`
  (`_shared/subscription-link.ts:91-128`). Store the ids in `platform_promo_code_stripe` (§8.2).
- Coupon: `percent_off` or `amount_off` + `currency: "usd"`; `duration` = `once` / `repeating`
  (+ `duration_in_months`) / `forever`. Set `applies_to.products` to the platform subscription
  product(s) (R2; verify the product ids per account in spike S4). Set `name` to what the
  operator will see on the invoice, e.g. `"Invited by Sunset Rentals: 20% off"` or `"LAUNCH50: 50% off"`.
- Promotion code: `code` = our code string. **Stripe allows A–Z, a–z, 0–9 and dashes, and codes are
  case-insensitive**, so `SUNSET-4821` is valid. The code string must be unique among
  **active** promotion codes in that account. With the pinned API `2023-10-16`, create with
  `coupon: <id>` (newer API versions use `promotion: { type: "coupon", coupon }`). Set
  `max_redemptions` / `expires_at` from our row. Put metadata on it: `d247_promo_code_id`, `d247_kind`,
  `d247_owner_tenant_id`.
- **Do not use Stripe's `restrictions.first_time_transaction`.** It rejects a customer who
  merely *initiated* a PaymentIntent or trial before, which blocks legitimate retries. Enforce
  "new operators only" ourselves (§12.1).
- **Apply it ourselves, never via Stripe's own promo box.** Do not set `allow_promotion_codes`
  on Checkout. Our own "Have a promo code?" field validates the code with our rules
  (self-referral, eligibility), then we pass `discounts: [{ promotion_code: <id> }]`. This also
  enforces D11 (one code per checkout). Stripe forbids combining `discounts` with
  `allow_promotion_codes` anyway.
- **Coupons and promotion codes are immutable** except `active`, `name` and metadata. So *editing*
  a code's terms means **rotation**: deactivate the old Stripe promotion code, create a new
  coupon + promotion code with the **same code string**, and mark the old DB row `superseded`.
  Operators who already redeemed keep their original terms.

### 7.2 Referrer tier discount = a standing coupon on the referrer's subscription

- One coupon per distinct tier value, per account/mode, with a **deterministic id** so creation
  is idempotent: `d247-ref-tier-pct-10`, `d247-ref-tier-pct-20`, `d247-ref-tier-fixed-2500`
  (fixed amount in cents). `duration: "forever"`, `applies_to` the subscription product (R2), and
  `name` = `"Referral reward: 10% off"`, which shows on the invoice.
- The engine (§9.3) keeps **exactly one** `d247-ref-tier-*` discount on the referrer's live
  subscription, matching their current tier, or none:
  1. Retrieve the subscription with `expand: ["discounts"]`.
  2. Build the new list = all existing discounts **except** any whose coupon id starts with
     `d247-ref-tier-`, plus the desired tier coupon (if any).
  3. If it differs from the current list: `subscriptions.update(subId, { discounts: newList })`
     with Stripe idempotency key `d247-ref-tier-{subId}-{desiredCouponId|none}-{yyyymmddhh}`.
     Existing entries are passed as `{ discount: <di_…> }` so they are kept, not re-redeemed.
- **Never touch other discounts**, i.e. the admin's one-time discount or the referee discount.
- Updating `discounts` creates no proration and no invoice. It applies from the **next invoice
  the subscription creates**. Stripe drafts a renewal invoice about 1 hour before finalizing it,
  so a change made inside that hour lands on the following bill. That is acceptable, and the UI
  wording "from your next bill" stays true.

### 7.3 Stacking order

Kristen can hold her tier coupon + a super-admin one-time coupon + (if she herself was referred)
her referee coupon, all at once. Stripe allows up to 20 and applies them in list order. Keep the
tier coupon **last** so percentages behave predictably. If an operator's discounts would total
100% or more, Stripe simply bills $0. Allow that; credit never becomes cash.

### 7.4 Deferred billing: "3 months" must mean 3 real bills

- Sales payment links for deferred plans start in a **trial** (no charge for ~1 month, with a $1 verification).
- A `repeating` coupon's months count **from when it is first applied**. A 3-month coupon applied
  at signup would therefore burn one month on the free trial month, and Jangram would get only 2
  discounted real bills.
- **Required:** when a checkout has a trial, pass a **deferred variant** of the coupon with
  `duration_in_months = N + ceil(trialDays / 30)`, applied as `discounts: [{ coupon: <variant> }]`.
  Store variants in `platform_promo_code_stripe.variant` (`standard` / `deferred_{k}m`). Record the
  redemption against the same `platform_promo_codes` row either way.
- Self-serve signup has no trial (it charges immediately), so it uses the `standard` promotion code.
- Verify with a Stripe **test clock** (spike S3).

### 7.5 One code per checkout

Enforced in our UI (one field) and in the checkout functions: reject a request carrying more
than one code, or carrying a code when the payment link already has one pre-applied.

### 7.6 The $1 verification line and the metered e-sign line

A percentage coupon without `applies_to` discounts **every** line: the $1 verification (whose
refund is capped at 100 cents in `subscription-webhook` `:664-693`, and would then fail or
misfire) and the metered e-sign usage item. Restrict coupons to the platform subscription
product(s) (R2). Spike S4 confirms the product ids on UAE/UK × live/test and that the $1 line
and the metered line stay undiscounted.

### 7.7 Spikes to run FIRST (Phase 0, UAE **test** mode, Stripe test clocks)

| Spike | Prove |
|---|---|
| S1 | With `stripe@14.21.0` / `2023-10-16`, `subscriptions.update({ discounts: [...] })` stacks a tier coupon + a once coupon, and removing one via the list keeps the other. Also confirm the reworked `apply-subscription-discount` pattern. |
| S2 | `promotion_codes.create({ coupon, code: "SUNSET-4821" })` works on the pinned version. Lookup by `code` is case-insensitive. Rotation (deactivate + recreate same code) works. |
| S3 | Deferred variant: trial + `repeating` N+1 gives exactly N discounted real invoices (test clock). |
| S4 | `applies_to.products` leaves the $1 verification line and the metered e-sign line undiscounted, and the $1 refund still succeeds. |
| S5 | Checkout Session with `discounts: [{ promotion_code }]` + trial + $1 line: the session completes and the webhook stores the subscription normally. |
| S6 | `subscriptions.create` (self-serve, `default_incomplete`) with `discounts`: `latest_invoice.amount_due` is the discounted amount. |

Write the findings into `docs/referrals/spike-results.md` before building Phase 2+.

---

## 8. Data model

All **new tables**, migrations **additive only** (V2_PLAN §4). **No new column on `tenants`**
(anon column-grant trap and "flag #74", V2_PLAN §4). Follow the DB gold standard: UUID PKs, `NOT NULL`
wherever possible, Postgres **enums** for closed sets, `timestamptz`, real FKs, `created_at` /
`updated_at` with the existing `set_updated_at()` trigger. **RLS ON for every new table from day
one.** Table and column names below are the recommended ones; keep them unless there is a reason.

### 8.1 Enums

```sql
CREATE TYPE promo_code_kind      AS ENUM ('campaign', 'referral');
CREATE TYPE promo_discount_type  AS ENUM ('percent', 'fixed');
CREATE TYPE promo_duration       AS ENUM ('once', 'repeating', 'forever');
CREATE TYPE promo_code_status    AS ENUM ('active', 'inactive', 'superseded');
CREATE TYPE referral_source      AS ENUM ('self_serve_checkout', 'payment_link', 'manual');
CREATE TYPE referral_status      AS ENUM ('active', 'void');
CREATE TYPE stripe_platform_acct AS ENUM ('uk', 'uae');       -- reuse if an equivalent exists
CREATE TYPE stripe_mode_t        AS ENUM ('test', 'live');    -- reuse if an equivalent exists
CREATE TYPE referral_claim_status AS ENUM ('pending', 'approved', 'rejected');  -- R6
```

### 8.2 Tables

**`referral_program_settings`**: exactly one row (`id boolean PRIMARY KEY DEFAULT true CHECK (id)`)
- `enabled boolean NOT NULL DEFAULT true`
- `default_referee_discount_type promo_discount_type NOT NULL DEFAULT 'percent'`
- `default_referee_discount_value numeric(10,2) NOT NULL DEFAULT 20`
- `default_referee_duration promo_duration NOT NULL DEFAULT 'repeating'`
- `default_referee_duration_months int DEFAULT 3` (required when `repeating`)
- `code_suffix_length int NOT NULL DEFAULT 4 CHECK (code_suffix_length IN (3,4,6))`
- `link_cookie_days int NOT NULL DEFAULT 90`
- `updated_by uuid REFERENCES app_users(id)`, `updated_at timestamptz NOT NULL DEFAULT now()`

**`referral_tiers`**: platform default rows (`tenant_id IS NULL`) + per-tenant overrides
- `id uuid PK`, `tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE`
- `min_active_referrals int NOT NULL CHECK (min_active_referrals >= 1)`
- `discount_type promo_discount_type NOT NULL`, `discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0)`
- `CHECK (discount_type <> 'percent' OR discount_value <= 100)`
- Unique `(tenant_id, min_active_referrals)` **with NULLS NOT DISTINCT** (Postgres 15+; otherwise two partial unique indexes).
- Rule: if a tenant has **any** rows, only its rows apply; otherwise the default rows apply.
  "Reset to default" = delete the tenant's rows.
- Seed the default rows from §3.1.

**`tenant_referral_settings`**: one row per tenant (created lazily or by backfill)
- `tenant_id uuid PK REFERENCES tenants(id) ON DELETE CASCADE`
- `referrals_enabled boolean NOT NULL DEFAULT true` (super admin can switch an operator off)
- `brand_prefix text NULL` (override of the auto-derived brand, §13)
- `uses_default_referee_discount boolean NOT NULL DEFAULT true`. When true, changing the
  platform default rotates this tenant's code to the new terms.
- `show_name_on_invite boolean NOT NULL DEFAULT true` (banner "Sunset Rentals invited you")
- `updated_by`, `created_at`, `updated_at`

**`platform_promo_codes`**: one row per code *version*
- `id uuid PK`
- `code text NOT NULL CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$')` (stored uppercase)
- `kind promo_code_kind NOT NULL`
- `owner_tenant_id uuid NULL REFERENCES tenants(id)`,
  `CHECK ((kind = 'referral') = (owner_tenant_id IS NOT NULL))`
- `discount_type promo_discount_type NOT NULL`, `discount_value numeric(10,2) NOT NULL`, `currency text NOT NULL DEFAULT 'usd'`
- `duration promo_duration NOT NULL`, `duration_months int NULL`,
  `CHECK ((duration = 'repeating') = (duration_months IS NOT NULL))`
- `max_redemptions int NULL`, `expires_at timestamptz NULL`
- `restrict_signup_plan_keys text[] NULL` (campaign codes only; null = any plan)
- `status promo_code_status NOT NULL DEFAULT 'active'`
- `superseded_by uuid NULL REFERENCES platform_promo_codes(id)`
- `note text NULL`, `created_by uuid NULL REFERENCES app_users(id)`, `created_at`, `updated_at`
- **Unique active code:** `CREATE UNIQUE INDEX ON platform_promo_codes (upper(code)) WHERE status = 'active';`
- **One active referral code per operator:** `CREATE UNIQUE INDEX ON platform_promo_codes (owner_tenant_id) WHERE kind = 'referral' AND status = 'active';`

**`platform_promo_code_stripe`**: the Stripe mirror per account/mode/variant
- `id uuid PK`, `promo_code_id uuid NOT NULL REFERENCES platform_promo_codes(id)`
- `stripe_account stripe_platform_acct NOT NULL`, `stripe_mode stripe_mode_t NOT NULL`
- `variant text NOT NULL DEFAULT 'standard'` (`standard` | `deferred_1m` | …, §7.4)
- `stripe_coupon_id text NOT NULL`, `stripe_promotion_code_id text NULL` (null for deferred variants, which are applied as coupons)
- `created_at`; unique `(promo_code_id, stripe_account, stripe_mode, variant)`

**`promo_code_redemptions`**: every code actually used (campaign and referral)
- `id uuid PK`, `promo_code_id uuid NOT NULL REFERENCES platform_promo_codes(id)`
- `tenant_id uuid NOT NULL REFERENCES tenants(id)` (who redeemed)
- `stripe_subscription_id text NOT NULL`, `stripe_account`, `stripe_mode`
- `discount_snapshot jsonb NOT NULL` (type/value/duration/months as redeemed)
- `discount_ends_at timestamptz NULL` (from Stripe `discount.end`; drives "2 bills left")
- `redeemed_at timestamptz NOT NULL`, `created_at`
- unique `(promo_code_id, tenant_id)`, unique `(stripe_subscription_id, promo_code_id)`

**`referrals`**
- `id uuid PK`
- `referrer_tenant_id uuid NOT NULL REFERENCES tenants(id)`, `referred_tenant_id uuid NOT NULL REFERENCES tenants(id)`,
  `CHECK (referrer_tenant_id <> referred_tenant_id)`
- `referrer_name_snapshot text NOT NULL`, `referred_name_snapshot text NOT NULL`. The portal
  cannot read another tenant's `tenants` row (RLS is on for `tenants`), so names are snapshotted here.
- `promo_code_id uuid NULL REFERENCES platform_promo_codes(id)` (null for a manual attach with no code)
- `redemption_id uuid NULL REFERENCES promo_code_redemptions(id)`
- `source referral_source NOT NULL`
- `status referral_status NOT NULL DEFAULT 'active'`
- `referee_discount_applied boolean NOT NULL DEFAULT false` (false for a manual attach without the option ticked)
- `attributed_at timestamptz NOT NULL DEFAULT now()`
- `created_by uuid NULL REFERENCES app_users(id)`, `note text NULL`
- `voided_at timestamptz NULL`, `voided_by uuid NULL`, `void_reason text NULL`
- `created_at`, `updated_at`
- **One live referral per referred operator:** `CREATE UNIQUE INDEX ON referrals (referred_tenant_id) WHERE status = 'active';`
- "Counts toward tier" is **not stored**. It is computed from the referee's live subscription status (R1).

**`referral_tier_state`**: the engine's view of each referrer (one row per referrer)
- `tenant_id uuid PK REFERENCES tenants(id)`
- `active_referrals int NOT NULL DEFAULT 0`, `total_referrals int NOT NULL DEFAULT 0`
- `current_tier_id uuid NULL REFERENCES referral_tiers(id)`, `current_discount_type`, `current_discount_value`
- `applied_stripe_coupon_id text NULL`, `applied_on_subscription_id text NULL`, `stripe_account`, `stripe_mode`
- `last_evaluated_at timestamptz`, `last_changed_at timestamptz`, `last_error text NULL`

**`referral_savings`**: for "you have saved $X so far"
- `id uuid PK`, `tenant_id uuid NOT NULL REFERENCES tenants(id)`
- `stripe_invoice_id text NOT NULL UNIQUE`, `stripe_account`, `amount_off_cents int NOT NULL`, `invoice_paid_at timestamptz NOT NULL`, `created_at`

**`referral_subscription_scans`**: the engine's "already looked at this subscription" marker
- `stripe_subscription_id text PK`, `tenant_id uuid NOT NULL`, `scanned_at timestamptz NOT NULL`, `found_promo_code_id uuid NULL`

**`referral_events`**: audit trail + notification dedupe
- `id uuid PK`, `tenant_id uuid NULL`, `referral_id uuid NULL`, `event_type text NOT NULL`
  (e.g. `code_created`, `code_rotated`, `redeemed`, `referral_attached`, `referral_voided`,
  `tier_changed`, `notified_referrer`), `payload jsonb NOT NULL DEFAULT '{}'`,
  `actor_app_user_id uuid NULL`, `created_at`
- Do **not** write these into `audit_logs`, which has a trigger that pushes super-admin phone alerts.

**`referral_claims`** (R6, Phase 4)
- `id uuid PK`, `referrer_tenant_id uuid NOT NULL`, `claimed_business_name text NOT NULL`, `claimed_contact text NULL`,
  `note text NULL`, `status referral_claim_status NOT NULL DEFAULT 'pending'`,
  `resolved_referral_id uuid NULL REFERENCES referrals(id)`, `resolved_by uuid NULL`, `resolved_at timestamptz NULL`,
  `created_by uuid NOT NULL REFERENCES app_users(id)`, `created_at`, `updated_at`

**`subscription_links` and `contact_requests`**: two **nullable** columns each (additive, allowed by §4)
- `subscription_links.promo_code_id uuid NULL REFERENCES platform_promo_codes(id)` (the code George pre-applied, part of the frozen snapshot)
- `contact_requests.promo_code text NULL` (code captured from the referral cookie at strategy-call submit)

### 8.3 RLS

- Every new table: `ENABLE ROW LEVEL SECURITY`. **Writes: `service_role` only**; all mutations go through edge functions.
- Tenant-readable (`authenticated`, `USING (<col> = get_user_tenant_id() OR is_super_admin())`):
  - `platform_promo_codes` where `owner_tenant_id = get_user_tenant_id()`
  - `referrals` where `referrer_tenant_id = get_user_tenant_id() OR referred_tenant_id = get_user_tenant_id()`
  - `referral_tier_state`, `referral_savings`, `promo_code_redemptions`, `tenant_referral_settings`, `referral_claims` (own `tenant_id` / `referrer_tenant_id`)
  - `referral_tiers` where `tenant_id = get_user_tenant_id() OR tenant_id IS NULL`
  - `referral_program_settings`: readable by `authenticated` (non-sensitive)
- `anon`: **no access**. Public code lookups go through the `promo-code-lookup` function (§9.1), which returns minimal data.
- `platform_promo_code_stripe`, `referral_subscription_scans`, `referral_events`: super admin + service role only.
- Even with RLS on, **every query still filters by `tenant_id`** (V2_PLAN §5).

### 8.4 Migrations and types

- Add migration files to `supabase/migrations/` (`YYYYMMDDHHMMSS_platform_promo_codes.sql`, …) for the record, and apply them with the Supabase MCP `apply_migration` / Management API.
- **NEVER run `supabase db push`.** Migration history has diverged, and a replay performs destructive drops on live operators' data.
- After the schema changes, regenerate types and copy them to all apps (CLAUDE.md commands), and
  re-run `npm run v1:check` (it will flag `subscription_links` / `contact_requests` as ADDITIVE,
  which is expected).
- Seed: the `referral_program_settings` row + the default `referral_tiers` rows.
- Backfill: a referral code + `tenant_referral_settings` row for every eligible tenant (§12.9), done by the engine's "ensure codes" step (§9.3), not by migration SQL.

---

## 9. Backend: edge functions and the referral engine

All are **new** functions (V2_PLAN §7). Use the standard pattern (`handleCors`, `jsonResponse`,
`errorResponse` from `_shared/cors.ts`) and the Stripe clients from `_shared/subscription-stripe.ts`.
Put shared logic in a **new** helper `_shared/platform-promo.ts`. **Do not edit existing `_shared` helpers.**

### 9.1 `promo-code-lookup`: public (`verify_jwt = false`), rate-limited per IP

- Input `{ code, planKey? }`. Output:
  `{ valid, kind, displayCode, discountText, durationText, referrerName?, reason? }`.
  - `referrerName` is included only for referral codes when `show_name_on_invite`.
  - `reason` ∈ `not_found | expired | maxed_out | inactive | plan_not_eligible | programme_disabled`.
- Never return ids, amounts owed, or anything about the owner beyond the display name.
- Used by: `/r/[code]`, the signup promo field, and the `/subscribe/[token]` promo field.
- Add it to `supabase/config.toml` with `verify_jwt = false`. Rate-limit like `signup-begin` does (via `signup_attempts`-style throttle rows or an equivalent new table).

### 9.2 `admin-promo-codes`: super admin (and sales agent for read + copy), JWT on

Auth: resolve `app_users` by `auth_user_id`; allow `is_super_admin`, and allow `is_sales_agent`
only for read actions + `list_for_payment_link` (R3). Actions:

| Action | Who | Does |
|---|---|---|
| `list` | SA, sales | Codes with filters (kind, status, search), usage counts, owner name, link |
| `create_campaign` | SA | Validate, insert row. Stripe objects are created lazily on first use (or eagerly on UAE live+test) |
| `update_code` | SA | **Rotate** (§7.1). Only `status` changes happen in place |
| `set_status` | SA | Activate/deactivate (+ Stripe promotion code `active`) |
| `get_tenant_referral` | SA, sales | Tenant's code, link, settings, tiers (effective + whether custom), state, referrals |
| `update_tenant_referral` | SA | Brand prefix (regenerates code), referee discount (custom or "use default" → rotate), tiers (replace set / reset to default), enabled, show_name |
| `regenerate_code` | SA | New suffix (old code superseded) |
| `list_referrals` | SA, sales | All referrals with filters |
| `attach_referral` | SA | Manual attach (§2.3): validate (§12), create the referral (`source = 'manual'`); optionally apply the referee discount to the referee's existing subscription; then run the engine for the referrer |
| `void_referral` | SA | Void with reason, then run the engine for the referrer |
| `list_claims` / `resolve_claim` | SA | R6 |
| `get_program_settings` / `update_program_settings` | SA | §8.2. Changing defaults → mark tenants on default for rotation / re-evaluation |
| `leaderboard` | SA, sales | Referrers by active referrals, tier, saved to date |
| `run_engine` | SA | "Sync now" for one tenant or all |

Every mutating action writes a `referral_events` row with the actor.

### 9.3 `referral-engine`: cron every 15 minutes, also callable for one tenant

The **only** thing that changes Stripe discounts on existing subscriptions. It is idempotent: running
it twice in a row must change nothing the second time. Take a Postgres advisory lock at the start
so runs never overlap. Invoke with `{ tenantId }` to process one tenant immediately (called after
checkout success, manual attach and void, and from "Sync now"). The cron call processes everyone.

Steps per run:

1. **Ensure codes.** Every eligible tenant (§12.9) without an active referral code gets one (§13),
   plus a `tenant_referral_settings` row. Also rotate codes flagged by a default-discount change.
2. **Discover redemptions.** For each `tenant_subscriptions` row with status in
   `active | trialing | past_due` whose `stripe_subscription_id` is not in `referral_subscription_scans`:
   - retrieve the Stripe subscription on the row's `stripe_account` + the tenant's
     `subscription_stripe_mode`, with `expand: ["discounts", "discounts.promotion_code"]`
     (the 2023-10-16 shape may also expose the legacy `discount`; read both);
   - map any discount whose promotion code or coupon matches `platform_promo_code_stripe` to our code;
   - if found, insert `promo_code_redemptions` (with `discount_ends_at` = Stripe `discount.end`). If the
     code is a referral code, insert `referrals` (`source` = `payment_link` if the subscription metadata has
     `subscription_link_id`, else `self_serve_checkout`), subject to the eligibility checks (§12.1);
   - always insert the scan marker.

   The checkout functions also write the redemption/referral directly when they know the code (§10).
   Discovery is the safety net that makes a dropped step harmless. The unique indexes make both
   paths safe together.
3. **Recompute tiers.** For every referrer with at least one referral (or an existing state row):
   `active_referrals` = count of `referrals.status = 'active'` whose referee has a
   `tenant_subscriptions` row in `active | trialing | past_due` (R1). The tier is the highest
   applicable tier (tenant rows, else default rows).
4. **Reconcile Stripe.** If the referrer has a live subscription: ensure the tier coupon exists
   on that account/mode (deterministic id, §7.2), then make the subscription's
   `d247-ref-tier-*` discount match (add / swap / remove) using the `discounts` array, preserving
   all other discounts. If there is no live subscription, record the state and skip (nothing to discount).
   Update `referral_tier_state`. On a tier change, write `referral_events` (`tier_changed`) and queue a notification.
5. **Record savings.** For each referrer's `tenant_subscription_invoices` rows with status `paid` not yet in
   `referral_savings`: retrieve the invoice (`expand: ["total_discount_amounts.discount"]`), sum the
   amounts whose coupon id starts with `d247-ref-tier-`, and insert (0 is fine; it prevents re-reading).
6. **Notify** (Trax voice, §11.5). Deduplicate via `referral_events` (`notified_*`).
7. **Test tenants.** Skip `tenant_type = 'test'`, except slugs in an allow-list `['northwind']`
   (**keyed on slug, never id**; V2_PLAN §2).

Schedule it with `pg_cron` + `net.http_post`, like the existing crons (see
`supabase/migrations/20260727160000_schedule_subscription_reconciler.sql`). **Warning:** a known
trap is that staging crons can end up calling production with production credentials. Schedule on
production only; do not copy the cron to a staging project with production secrets in it.

### 9.4 `tenant-referrals`: portal data for the Referrals page, tenant JWT

- Resolve the caller's `app_users` → `tenant_id`. **Super admins have `tenant_id = NULL`**:
  for them, accept `tenantId` from the request body (they can view any tenant). Otherwise ignore any
  body `tenantId`. This null case has broken other functions before.
- Returns: code, link, effective tiers (ladder), current tier and progress to the next, referee
  offer text, stats (total referred, active, current discount, saved to date), the referral list
  (name snapshot, date, active yes/no), and the caller's own "you joined with X's code" discount
  status (from `promo_code_redemptions`).
- Actions: `get`, and `submit_claim` (R6).
- The portal calls this through a hook rather than raw `.from()` in components (V2_PLAN §9).

---

## 10. Where a code enters a checkout (all entry points)

Rule for every path: **with no code, the flow must behave exactly as today.** Per V2_PLAN §7, the
default is new `-v2` functions used **only when a code is present**. The v1 function stays
untouched and keeps serving every checkout without a code. If Ghulam prefers a direct additive
edit for some of these (the `signup-*` functions are recent and self-serve only), he must say so
explicitly (§17 Q6).

### 10.1 Referral link capture (apps/web)

- New route `apps/web/src/app/r/[code]/page.tsx` (server). Normalise the code (uppercase, trim), call
  `promo-code-lookup` server-side, set a first-party cookie `d247_promo` (value = code,
  `Max-Age = link_cookie_days`, `SameSite=Lax`, `Secure`, `Path=/`), then redirect to `/?promo={CODE}#pricing`.
  An invalid code still redirects to `/` with no banner; never show an error page to a prospect.
- New client component mounted in the `(marketing)` layout. It reads `?promo=` and the cookie, stores the
  code in localStorage `d247-promo-code` (it must survive the OAuth and Stripe redirects, §6.2), and
  strips `promo` from the URL with `replaceState`.
- **Last code wins.** A newer valid link replaces an older stored code.
- Landing banner (when a valid code is stored): *"Sunset Rentals invited you: 20% off your first 3 months."*
  (or *"LAUNCH50: 50% off for 3 months"* for a campaign code). Show strikethrough prices on the plan cards.
- **Pricing visibility (R5):** when a valid code is stored, render the pricing section even if
  `landing_pricing_enabled()` is false. Confirm with Ghulam.

### 10.2 Self-serve signup

- The onboarding dialog (`apps/web/src/components/onboarding/…`) shows a **"Have a promo code?"** field,
  pre-filled from storage. It validates via `promo-code-lookup` (with the chosen plan key), shows the
  discounted price and duration on the payment step, and allows exactly one code.
- The code travels to the subscription-creating call:
  - `signup-payment-intent-v2` (copy of `signup-payment-intent` + `promoCode` input):
    - resolve the code; check eligibility (§12.1): not expired or maxed, plan allowed, programme
      enabled, the owner's referrals enabled, not a self-referral by email/domain;
    - ensure the UAE Stripe promotion code for the signup mode;
    - `subscriptions.create({ …, discounts: [{ promotion_code }] })`, plus subscription metadata
      `d247_promo_code_id`, `d247_referrer_tenant_id`;
    - include the code in the idempotency key;
    - return `latest_invoice.amount_due` as the amount to show.
  - Also stamp `promoCode` into the tamper-proof signup metadata blob
    (`app_metadata.d247_signup`, via `writeSignupMeta`) so provisioning and the engine can trust it.
- After `signup-provision` succeeds, the client calls `referral-engine` with the new `tenantId`
  (or `signup-provision` does it, if Ghulam allows an edit). This way the referrer's tier updates
  within seconds, not 15 minutes (D8). If the call fails, the cron catches it.

### 10.3 Sales payment link (George)

- **SalesOnboardingDialog** + wherever super admin issues a payment link (tenant detail
  Subscription card, `send-subscription-link-email`): add an optional **"Promo / referral code"**
  picker (searchable over active codes, via `admin-promo-codes list_for_payment_link`). It is
  pre-selected when the tenant's originating `contact_requests.promo_code` is set.
- `create-subscription-link` path → pass `promoCodeId`. It is stored in `subscription_links.promo_code_id`
  as part of the frozen snapshot. Changing the code means issuing a new link, same as any other
  snapshot change.
- `/subscribe/[token]` page (`apps/web/src/app/subscribe/[token]/page.tsx`):
  - if the link has a code: show the banner and discounted price, with **no** promo field (D11);
  - else: show a **"Have a promo code?"** field (validated via lookup).
- `subscription-link-v2` (used when the link has a code **or** the POST carries one):
  - validate eligibility (§12.1);
  - if the session has a trial → `discounts: [{ coupon: <deferred variant> }]` (§7.4); else
    `discounts: [{ promotion_code }]`;
  - add metadata `d247_promo_code_id` (session + `subscription_data.metadata`);
  - never set `allow_promotion_codes`.
- The `/subscribe/[token]/done` page (or its function call) triggers `referral-engine` for the new tenant.

### 10.4 Strategy-call capture

- `apps/web/src/actions/strategy-call.ts`: the server action reads the `d247_promo` cookie
  **server-side**. After the RPC returns the new `contact_request` id, it writes
  `contact_requests.promo_code` via a new security-definer RPC or a service call. Do not change the RPC's
  signature (V2_PLAN §4: changing a function signature is forbidden). Add a new function.
- `/admin/contacts` shows "Came via SUNSET-4821" on the lead. Sales Onboarding pre-selects it when
  the tenant is created from that lead, where the dialog knows the lead. Otherwise George picks it by hand.

---

## 11. Screens

All portal copy is written **as Trax** (the product's AI): first person, **no emojis**. The portal
follows the design system in `CLAUDE.md` ("Portal Design System": DM Sans, indigo `#6366f1`
accent, flat 1px `#f1f5f9` borders, no shadows, indigo-header tables). Reuse components from the
existing `-v2` directories.

### 11.1 Super admin: Promo Codes tab (`/admin/promo-codes`)

The sidebar item is **"Promo Codes"** in the Management group (`Sidebar.tsx:82-97`), visible to super
admins and sales agents. The page has sub-tabs:

**a) Codes.** A table of every code.
Columns: Code · Type (Campaign / Referral) · Owner (operator name, or "Drive247") · New-operator discount
(e.g. "20% × 3 months") · Uses (e.g. "4 / 20") · Expires · Status · Actions.
Actions per row: **Copy code**, **Copy referral link** (referral codes), Edit, Activate/Deactivate,
View history (superseded versions). Filters: type, status, search (code or operator). Button: **New campaign code**.

**b) New / edit campaign code** (modal)
Fields: code (A–Z, 0–9, dashes; uppercase), discount type (percent / fixed $), value, duration
(first bill only / N months / forever), max uses (optional), expiry (optional), plans allowed
(optional; `signup_plans` keys), internal note. Editing terms shows a notice: "Existing users keep
their current discount; the new terms apply to new sign-ups".

**c) Operator referral settings** (drawer, opened from a referral code row or from tenant detail)
- The code, with **Change brand part** and **New number** actions (old code stops working, with a warning).
- The referral link, with Copy (this is where George copies Kristen's link).
- **New-operator discount:** "Use platform default (20% × 3 months)" or custom (type / value / duration).
- **Tier table:** "Use platform default" or custom. An editable list of rows (subscribed referrals ≥ N → discount).
  Show a preview: "With 2 subscribed referrals: 10% off every bill".
- Referrals enabled on/off; show name on invite banner on/off.
- Current state: subscribed referrals, current tier and discount, saved to date, list of referrals.

**d) Referrals.** A table of all referrals.
Columns: Referrer · New operator · Code used · How (Self-serve / Payment link / Manual) · Date ·
New operator status (Subscribed / Canceled) · Counts toward tier (yes/no) · Actions (Void).
Button: **Attach referral** (manual fallback, §2.3). Fields: referrer (operator search), new operator
(operator search), "Also give the new operator their discount" checkbox, note.
Validation errors are shown inline (already referred, self, test tenant…).

**e) Claims** (R6): operator-submitted "someone joined because of me". Approve opens a pre-filled
Attach referral form; Reject asks for a reason.

**f) Leaderboard**: operators by subscribed referrals. Columns: tier, current discount, saved to date.

**g) Programme settings**: on/off, default new-operator discount, default tier table, code number length
(3/4/6), link cookie days.

**Tenant detail page** (`rentals/[id]/page.tsx`): add a small **Referral** card in the Management tab
(code, link copy, who referred them, subscribed referrals / tier, "Open referral settings"). Also update
the discount chip area (`:2303-2318`) to list **all** discounts on the subscription, labelling the
referral tier one, once `apply-subscription-discount` has been reworked (§6.5).

### 11.2 Super admin: Sales Onboarding and payment links

- `SalesOnboardingDialog`: an optional "Promo / referral code" picker (pre-filled from the lead's
  captured code), passed into the payment link creation.
- Tenant detail → issue/resend payment link: the same picker.
- `/admin/contacts`: show the captured code on each lead.

### 11.3 Marketing site (apps/web)

- `/r/[code]` route + capture component (§10.1).
- Landing banner + strikethrough prices when a code is stored.
- Onboarding dialog: a "Have a promo code?" field, plus the discounted price and duration on the payment step.
- `/subscribe/[token]`: a banner when the link has a code, otherwise a "Have a promo code?" field.
- Copy on these pages is marketing copy (not Trax). Keep it short and factual, no emojis.

### 11.4 Portal: Referrals page (`/referrals`)

- **Gating:** a new v2 area `referrals` in `apps/portal/src/lib/v2.ts` (add it to the area union and to
  `V2_AREAS` as `[NORTHWIND]`; annotate as `readonly string[]`, **never `as const`**). The route is
  `app/(dashboard)/referrals/page.tsx`, with the server gate `if (!(await serverIsV2('referrals'))) notFound();`
  and components in `components/referrals-v2/`.
- **Sidebar:** a v2 fixed row **"Referrals"** right under **Billing** in `app-sidebar-v2.tsx`. The
  v1 sidebar entry is added **only when widening** (one line, Phase 5, Ghulam's decision). Map
  `/referrals` → `settings.subscription` in `ROUTE_TO_TAB`, and hide the v2 fixed row for managers
  lacking that tab. The fixed rows are not auto-filtered, so do it explicitly.
- **Content** (each block written as Trax):
  1. **Your code and link:** the code, the link, Copy buttons, share via WhatsApp (`https://wa.me/?text=…`) and
     email (`mailto:`). A QR code is optional.
     *"Share this with any operator. When they subscribe with it, I'll take 20% off their first 3 months, and I'll move you up a tier."*
  2. **Your tier:** the current tier and discount, and the ladder from the tenant's effective tiers with the current rung highlighted.
     Progress: *"You have 2 operators subscribed through you. One more and I'll move you to Tier 2: 20% off every bill."*
     With 0: *"Refer your first operator and I'll take 10% off every bill."*
  3. **Stats tiles:** Referred · Subscribed now · Your discount · Saved so far.
  4. **Your referrals table:** Operator (name snapshot) · Joined (date) · Status (Subscribed / No longer subscribed) · Counts toward your tier.
     Never show the other operator's plan, price or billing details.
  5. **If the operator joined with a code themselves:** *"You joined with Sunset Rentals' code. I'm taking 20% off your bill until 22 Dec 2026, which is 2 more bills."*
  6. **(R6) "Referred someone who didn't use your code?"** Business name, contact, note → `submit_claim`.
     *"Tell me who it was and I'll get it credited to you once we've checked."*
- Hook: `src/hooks/use-referral-overview.ts`, query key `["referral-overview", tenant?.id]`, calling the
  `tenant-referrals` function, `enabled: !!tenant`.
- **Billing page note (optional):** a small one-line mount of a new `<ReferralDiscountNotice />` on
  `/subscription` would show "Referral discount: 20% until 22 Dec". That is a v1 file edit, so ask Ghulam first.

### 11.5 Notifications (Trax voice, no emojis)

Send an email (existing email infrastructure) and a portal notification (check `docs/notifications-v2/build-spec.md`
for the current notification system), deduplicated via `referral_events`.

| Trigger | To | Example copy |
|---|---|---|
| A referee subscribes with your code (or a manual attach) | Referrer | "Jangram Rentals just subscribed with your code. That puts you on Tier 1, so I'm taking 10% off your next bill." |
| Your tier goes up | Referrer | "You now have 3 operators subscribed through you. From your next bill I'm taking 20% off." |
| Your tier goes down (R7) | Referrer | "Jangram Rentals is no longer subscribed, so from your next bill your referral discount is 10%." |
| You joined with a code | Referee | "You joined with Sunset Rentals' code. I'm taking 20% off your first 3 bills." |
| A claim is approved or rejected | Referrer | "I've checked, and Jangram Rentals now counts as your referral." / a polite rejection |

Client-facing tone rule: never say "bug", "fixed" or "it was broken". Say what is now available.

---

## 12. Business rules and edge cases

### 12.1 Eligibility checks when a code is redeemed or attached

- The code is active, not expired, not over `max_redemptions`, and the plan is allowed (campaign codes).
- The programme is enabled; for referral codes, the owner's `referrals_enabled` is true.
- **New operators only:** the redeeming tenant has never had a paid platform subscription invoice
  (check `tenant_subscription_invoices`), and has no existing active referral.
- **No self-referral:**
  - the referee is not the owner tenant;
  - the signup email is not an `app_users` email of the owner tenant, nor the owner's `tenants.contact_email`;
  - hard-block an exact email match;
  - a same **company** email domain (ignore public domains: gmail, outlook, yahoo, icloud, hotmail…)
    is **flagged** on the referral for super-admin review, not blocked.
- One code per checkout (D11).
- `tenant_type = 'test'` tenants can neither earn nor redeem, except the slug allow-list (`northwind`).

### 12.2 Lifecycle rules

- A tenant can be referred **once**. The first attribution wins; super admin can void it and re-attach a different referrer.
- A referral counts toward the tier only while the referee's subscription is live (R1). Canceled
  → drops out; a re-subscription later → counts again (same referral row).
- The referrer's tier discount needs the referrer to have a live subscription. If they have none, the
  count still accrues, and the discount applies once they subscribe.
- `past_due` referrer: keep the tier coupon (it reduces what they owe).
- The referrer's tier applies from the next bill after the change (§7.2 timing note).
- A voided referral stops counting immediately (engine run on void). A discount already given on
  past invoices is never clawed back.
- A referee who **refunds or disputes** their first payment: no automatic action beyond R1 (a
  canceled subscription stops counting). Super admin can void.

### 12.3 Code changes

- Changing a tenant's new-operator discount or a campaign's terms → **rotate** (§7.1). Same code
  string; old redemptions keep their terms.
- Changing the brand part or regenerating the number → the old code is superseded and **stops working**.
  Old links using it land without a banner. Warn in the UI.
- Changing a tier table → the engine re-evaluates; the effect lands on the next bill.
- Changing platform defaults → affects tenants on default only (tiers: `referral_tiers` fallback;
  new-operator discount: `uses_default_referee_discount` → rotation).

### 12.4 Money rules

- A discount never becomes cash or a refund. It can reduce a bill to $0, never below.
- Discounts apply to the base subscription only (R2).
- A super admin's one-time discount stacks with the tier discount; neither removes the other (§6.5, §7.3).

### 12.5 Accounts and migration

- Always operate on the live subscription row's account (§6.4).
- UK→UAE flip: the engine re-applies the tier discount on the new UAE subscription automatically.
  A referee's remaining repeating discount is **not** carried over: super admin re-applies it
  manually (rare; only 3 UK subscriptions remain). Add a note to the migration cockpit.

### 12.6 Concurrency and idempotency

- Unique indexes (`referrals` one active per referee; `promo_code_redemptions` unique pairs;
  `referral_savings.stripe_invoice_id`) are the source of truth against double-processing.
- Stripe writes use idempotency keys (§7.2).
- The engine uses an advisory lock; checkout functions and the engine may both try to record the same
  redemption, and `ON CONFLICT DO NOTHING` handles it.

### 12.7 Privacy

The referrer sees only the referee's business name, join date and subscribed yes/no. The referee sees
only the referrer's business name. No amounts, plans or contact details cross between tenants.

### 12.8 Reserved and invalid codes

- Brand parts must not collide with reserved words: `WWW`, `ADMIN`, `PORTAL`, `API`, `APP`, `TEST`, `DRIVE247`.
- Campaign codes must not look like a referral code of an existing brand (reject `BRAND-digits`
  patterns for campaign codes).

### 12.9 Which tenants get a referral code

`tenant_type = 'production'` (plus the slug allow-list) and not deleted/disabled. Backfill all existing
ones in Phase 1; new tenants get one on the engine's next run (or on first visit to the page).

---

## 13. Code format

`{BRAND}-{DIGITS}`, e.g. `SUNSET-4821`, `JANGRAM-0937`, `REVTEK-5512`.

**Brand part** (auto-derived; super admin can override it via `tenant_referral_settings.brand_prefix`):
1. Take `tenants.company_name`, **trim** it (real data has trailing spaces, e.g. `"RevTek rentals "`), and uppercase it.
2. Split into words; strip every character that is not A–Z or 0–9 from each word.
3. Drop generic trailing words when there is more than one word: `RENTALS`, `RENTAL`, `CAR`, `CARS`, `LLC`,
   `INC`, `LTD`, `CO`, `COMPANY`, `AUTO`, `THE` (e.g. "Jangram Rentals" → `JANGRAM`).
4. Use the first remaining word; if it has fewer than 4 characters, append the next word ("1st Choice" → `1STCHOICE`).
5. Cap at 12 characters. If empty, fall back to the tenant slug (alphanumerics, cap 12).
6. Reject reserved words (§12.8).

**Digits part:** random digits of length `code_suffix_length` (default 4, R4), leading zeros allowed.
Avoid obvious sequences (`0000`, `1234`) as a nicety.

**Uniqueness:** check `upper(code)` against active DB codes and retry with new digits (max 20 tries);
the unique index is the final guard. Stripe uniqueness is per account among active codes, so a
DB-unique active code is Stripe-safe.

**Input normalisation** everywhere a user types a code: trim, uppercase, and turn spaces and
underscores into `-`. Accept it with or without the dash (`SUNSET4821` → match `SUNSET-4821`) by also
comparing with dashes removed.

---

## 14. Build order, with acceptance criteria per phase

Run `npm run v1:check` before starting and after every phase (V2_PLAN §8). Each phase is its own PR, reviewed by Ghulam.

| Phase | Build | Done when |
|---|---|---|
| **0. Spikes** | S1–S6 (§7.7) in UAE **test** mode with test clocks; write `docs/referrals/spike-results.md` | Every spike is answered with evidence; any surprise is raised with Ghulam before Phase 2 |
| **1. Data + super admin codes** | Migrations (§8), seeds, RLS; `_shared/platform-promo.ts`; `promo-code-lookup`; `admin-promo-codes` (codes, campaign CRUD, tenant referral settings, programme settings); admin `/admin/promo-codes` tabs a, b, c, g; code backfill | Super admin can create a campaign code, see every operator's referral code + link, and edit tiers/discounts per operator; the lookup returns correct display text; `apps/admin` builds with strict TS |
| **1b. Prerequisite fix** (needs Ghulam's OK, §17 Q5) | Rework `apply-subscription-discount` + its admin UI to use the `discounts` array | A one-time discount can be added and removed on a subscription that also carries another discount, without touching it |
| **2. Referral engine + manual fallback** | `referral-engine` (cron + per-tenant), tier reconciliation, savings, events; admin tabs d (Referrals + Attach/Void) and f (Leaderboard); tenant detail Referral card | In test mode: attaching Jangram → Kristen's subscription gets the 10% tier coupon; voiding removes it; a second engine run changes nothing. **The manual fallback now works for everyone.** |
| **3. Checkout entry points** | `/r/[code]` + capture + banner + pricing visibility (R5); promo field + `signup-payment-intent-v2`; payment-link picker, `subscription_links.promo_code_id`, `/subscribe/[token]` field + `subscription-link-v2` (deferred variant); strategy-call capture + `/admin/contacts` display; engine trigger after success | All three stories (§2.1, §2.2 A/B/C) work end-to-end in test mode; with no code, both checkouts behave exactly as before (compare the Stripe session/subscription payloads) |
| **4. Portal page + notifications** | `referrals` v2 area, `/referrals` page, v2 sidebar row, permissions mapping, `tenant-referrals` fn + hook; referee discount notice; Trax notifications; claims (R6) + admin tab e | Gate verified on rendered content for northwind (present), a real v1 tenant (absent) and a non-existent slug (absent), per V2_PLAN §10 |
| **5. Widen** (Ghulam decides) | 1–2 friendly operators → everyone; v1 sidebar entry (one line); welcome pack article + FAQ updated to point to the Referrals page; turn on for live mode | Ghulam signs off each step |

---

## 15. Test plan

Test in **Stripe test mode on the UAE account** using `northwind` (UAE, test mode) and the `test`
tenant, with **Stripe test clocks** to move time. Never create live charges while testing. Self-serve
signup mode comes from `SIGNUP_STRIPE_MODE` (default live), so run self-serve tests only against a
test-mode deployment of the function.

| # | Scenario | Expected |
|---|---|---|
| 1 | Kristen's link → self-serve plan → pay | Checkout shows 20% for 3 months; the referral is created; Kristen's live subscription carries `d247-ref-tier-pct-10`; her next invoice (advance the clock) is 10% off; her page shows Tier 1 and 1 subscribed |
| 2 | George pre-applies Kristen's code on a payment link (deferred plan) | The subscribe page shows the banner and the discounted price; exactly 3 **real** invoices are discounted; the $1 verification is charged in full and refunded |
| 3 | Payment link without a code; Jangram types it | Same as #2 |
| 4 | Manual attach, with and without "give the new operator the discount" | The tier updates; the referee discount lands on the referee's next invoice only when ticked |
| 5a | Kristen gets her 2nd subscribed referral (default ladder) | Discount stays **10%** (not 20%); only one tier coupon on her subscription; her page says one more referral reaches 20% |
| 5 | Kristen reaches 3 subscribed referrals | Tier 2 from the next bill; notification sent once |
| 6 | One referee cancels | The count drops; the tier drops from the next bill; the "tier down" notification (R7) |
| 7 | Kristen also has a super-admin one-time 15% discount | Both apply on the next invoice; removing the one-time discount keeps the tier coupon, and vice versa |
| 8 | Per-tenant tier override (e.g. 1+ = 25%) | Applies to Kristen only; the default is unchanged for others |
| 9 | Change Kristen's new-operator discount | Code rotated with the same string; old redemptions unchanged; new sign-ups get the new terms |
| 10 | Kristen uses her own code / her own email | Blocked; a same company domain is flagged, not blocked |
| 11 | Expired / maxed / inactive campaign code | Lookup explains why; checkout refuses |
| 12 | Two codes | UI allows only one; the API rejects two |
| 13 | Engine run twice; webhook dropped (skip `referral-engine` trigger) | No duplicates; the cron still discovers the redemption within 15 minutes |
| 14 | Super admin (tenant_id NULL) opens a tenant's Referrals view | Works via the body `tenantId`; a normal tenant cannot read another tenant's data by passing `tenantId` |
| 15 | No-code checkout (self-serve and payment link) | Byte-for-byte the same Stripe parameters as before this project |
| 16 | Gate | northwind sees `/referrals`; a real v1 tenant and a non-existent slug do not (assert on rendered content, not status codes) |
| 17 | Test tenant (non-allow-listed) tries to earn or redeem | Ignored |

---

## 16. V2_PLAN compliance checklist

- [ ] `npm run v1:check` passes before and after (findings = only the intended ADDITIVE changes, committed with a fresh baseline and a reason).
- [ ] Migrations are additive only. No drops, renames, type changes or NOT NULL on existing columns. **No new column on `tenants`.** The only existing-table changes are the two nullable columns in §8.2.
- [ ] **No new trigger on any existing table.**
- [ ] No existing edge function changed, except `apply-subscription-discount` with Ghulam's explicit OK. Code-carrying checkouts use `-v2` functions unless Ghulam approves otherwise.
- [ ] No existing `_shared/*` helper edited; new logic lives in `_shared/platform-promo.ts`.
- [ ] Every query filters by `tenant_id`. The service-role functions resolve the tenant themselves.
- [ ] RLS on for all new tables; writes only via service role.
- [ ] Portal: the new route and components live in new files; the only v1-file edits are the one-line sidebar entry (Phase 5) and, if approved, the billing-page notice mount.
- [ ] Gate keyed on **slug**, `readonly string[]`, never `as const`, resolved server-side, fails to v1.
- [ ] `apps/admin` builds (strict TS).
- [ ] Types regenerated and copied to portal, booking and admin.
- [ ] **Never `supabase db push`.**
- [ ] Cron scheduled on production only (not via a staging copy carrying production credentials).

---

## 17. Open questions to ask Ghulam

Ask these before the phase noted. Each has a default (§4) to build if he agrees.

| # | Question | Default | Needed by |
|---|---|---|---|
| Q1 | Does a referral stop counting toward the tier when the referred operator cancels? | Yes (R1) | Phase 2 |
| Q2 | Code number length: 3, 4 or 6 digits? | 4 (R4) | Phase 1 |
| Q3 | Show pricing to referral-link visitors even though the landing pricing switch is OFF? | Yes (R5) | Phase 3 |
| Q4 | Discount only the base subscription, not e-sign usage or add-ons? | Yes (R2) | Phase 0/1 |
| Q5 | OK to rework the live `apply-subscription-discount` function to use the `discounts` array? It is required before tier discounts go live. | Required | Phase 1b |
| Q6 | For code-carrying checkouts: new `-v2` functions (default), or a direct additive edit to `signup-payment-intent` / `subscription-link`? | `-v2` | Phase 3 |
| Q7 | Sales agents: view/copy/pick codes only; super admins do everything else? | Yes (R3) | Phase 1 |
| Q8 | Build the operator "someone joined because of me" claim form? | Yes, Phase 4 (R6) | Phase 4 |
| Q9 | Promo codes on existing tenants re-subscribing via the portal, or on the UK→UAE migration checkout? | No (R8) | — |
| Q10 | Tell referrers when their tier goes down? | Yes (R7) | Phase 4 |
| Q11 | Show the referral discount line on the v1 billing page (a one-line mount)? | Ask | Phase 4 |

---

## 18. File reference index

| Area | Path |
|---|---|
| Rebuild rules | `V2_PLAN.md` |
| Stripe clients (uk/uae × test/live) | `supabase/functions/_shared/subscription-stripe.ts` |
| Existing one-time discount (to rework) | `supabase/functions/apply-subscription-discount/index.ts` |
| Price change | `supabase/functions/change-subscription-price/index.ts` |
| Subscription webhook | `supabase/functions/subscription-webhook/index.ts` |
| Hourly reconciler | `supabase/functions/reconcile-subscriptions/index.ts`, `supabase/migrations/20260727160000_schedule_subscription_reconciler.sql` |
| Payment links | `supabase/functions/create-subscription-link/`, `subscription-link/`, `_shared/subscription-link.ts`, `send-subscription-link-email/`, `revoke-subscription-link/`, `sweep-subscription-links/` |
| Sales onboarding | `supabase/functions/create-sales-onboarding/index.ts`, `apps/admin/components/admin/SalesOnboardingDialog.tsx` |
| Self-serve signup | `supabase/functions/signup-begin/`, `signup-begin-oauth/`, `signup-payment-intent/`, `signup-resume/`, `signup-provision/`, `_shared/signup-state.ts`, `_shared/signup-stripe.ts`, `_shared/signup-plans.ts` |
| Marketing site | `apps/web/src/app/(marketing)/page.tsx`, `apps/web/src/lib/landing-pricing-server.ts`, `apps/web/src/components/onboarding/` (`onboarding-provider.tsx`, `onboarding-api.ts`, `tenant-draft.ts`, `steps/payment-step.tsx`), `apps/web/src/components/pricing/plan-card.tsx` |
| Payment link page | `apps/web/src/app/subscribe/[token]/page.tsx`, `.../done/page.tsx` |
| Strategy call | `apps/web/src/actions/strategy-call.ts`, `apps/web/src/app/strategy-call/page.tsx` |
| Admin sidebar / tenant detail | `apps/admin/components/admin/Sidebar.tsx`, `apps/admin/app/admin/(protected)/rentals/[id]/page.tsx` |
| Admin signup plans (pattern for a settings page) | `apps/admin/app/admin/(protected)/signup-plans/page.tsx`, `supabase/functions/manage-signup-plans/` |
| Admin leads | `apps/admin/app/admin/(protected)/contacts/` |
| Portal gates | `apps/portal/src/lib/v2.ts`, `lib/v2-server.ts`, `lib/v2-context.tsx` |
| Portal sidebars | `apps/portal/src/components/shared/layout/app-sidebar-v2.tsx`, `app-sidebar.tsx` |
| Portal permissions | `apps/portal/src/lib/permissions.ts`, `src/hooks/use-manager-permissions.ts` |
| Portal billing | `apps/portal/src/app/(dashboard)/subscription/page.tsx`, `src/hooks/use-tenant-subscription.ts` |
| Copy UI to reuse | `apps/portal/src/app/(dashboard)/integrations/_panels/_kit.tsx` (`CopyValue`) |
| Marketing URL | `apps/portal/src/lib/legal/urls.ts` |
| First-run question | `apps/portal/src/lib/first-run-questions.ts` |
| Welcome pack referral copy | `supabase/migrations/20260815150100_seed_welcome_pack_content.sql` (managed at `/admin/welcome-pack`) |
| Renter promo codes (do NOT reuse) | tables `promocodes`, `promotions`; `apps/portal/src/components/settings-v2/promo-codes-section-v2.tsx` |
| Notifications system | `docs/notifications-v2/build-spec.md` |
