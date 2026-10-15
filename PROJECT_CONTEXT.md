# PROJECT_CONTEXT.md — Drive247 project map for AI agents (and humans)

> **Read order for a fresh agent:** this file → `V2_PLAN.md` (rules, non-negotiable) → `CLAUDE.md`
> (v1 architecture; partly stale — see §12) → `ILLUSTRATION_GUIDE.md` (only for visual assets).
>
> Compiled 2026-10-14 from a full read of the repo at commit `144824e3`. Where this file and the code
> disagree, the code wins — fix this file in the same commit.

---

## 0. The five rules that prevent real damage

1. **`main` deploys to production.** ~57 tenants, ~32 paying. A staging Supabase branch exists
   (`ksmreaadhbirzakkxqrq`, see §9) — use it for local work, but there is no staging *deploy*.
2. **RLS is OFF on the core tables** (`rentals`, `customers`, `payments`, `vehicles`, `invoices`,
   `ledger_entries`, `app_users`). Policies on them exist but are inert. **Every query, update and
   delete must filter `.eq('tenant_id', tenant.id)`.** A missing filter = critical bug. Do **not**
   "fix" this by enabling RLS — it would take v1 down.
3. **Strangler pattern for v2.** Never edit a v1 screen in place. Build `components/<area>-v2/` beside
   it and branch once at the route/layout level via the v2 gate (§5). Gate keyed on **slug**, never id.
4. **Database: additive only.** New tables / nullable columns / non-unique indexes / new functions.
   Never drop, rename, retype, add NOT NULL/UNIQUE, or change a function signature.
   **New column on `tenants` ⇒ `GRANT SELECT (col) ON public.tenants TO anon;`** or every booking
   site loses its branding (anon holds column-level grants; one ungranted column kills the whole row).
   New triggers on existing tables must guard on tenant first and wrap side effects in `EXCEPTION`.
5. **Never change an existing edge function or `_shared/` helper's behaviour** (except a real v1 bug
   fix). Add `<name>-v2` / a new helper instead. Many are called by Stripe/BoldSign/Twilio/pg_cron,
   so "who calls this?" can't be answered by grep.

Guardrail: `SUPABASE_ACCESS_TOKEN=sbp_… npm run v1:check` before and after a change (read-only,
compares prod with `scripts/v1-check/baseline.json`). Only re-snapshot (`npm run v1:snapshot`) for an
agreed change, committed together with it.

---

## 1. What Drive247 is

Multi-tenant SaaS for car-rental operators. Each operator ("tenant", e.g. `northwind`) gets:
- a **customer booking site** — `{slug}.drive-247.com` or a custom domain
- an **operator dashboard ("portal")** — `{slug}.portal.drive-247.com` or a custom portal domain

Drive247 itself runs a **marketing site + self-serve signup** (`drive-247.com`) and a
**super-admin console**. Drive247 bills tenants a subscription (its own Stripe account); tenants
take rental payments from their customers via Stripe Connect or Square.

Canary tenant: **`northwind`** (prod id `6e5c544f-b374-451f-a662-360a634bff15`, different id on
staging — hence slug-keyed gates). Synthetic data only; never copy real customer data into it.

---

## 2. Repo map

```
Drive24/
├── apps/
│   ├── booking/   customer site + customer portal   Next 15.1, React 18   port 3000
│   ├── portal/    operator dashboard                 Next 16,   React 19   port 4002
│   ├── web/       marketing + signup (drive-247.com) Next 16,   React 19   port 4003
│   └── admin/     Drive247 super-admin console       Next 16,   React 19   port 4004
├── shared/trax-support/   React+server module shared by portal & admin (TRAX support inbox)
├── supabase/
│   ├── config.toml        mostly per-function verify_jwt (with reason comments)
│   ├── functions/         374 Deno edge functions + _shared/ + _tests/
│   └── migrations/        467 SQL migrations (+ PENDING_*.sql.txt = not applied)
├── scripts/               ops tooling (db-switch, v1-check, deploy, seed/wipe northwind…)
├── tests/                 root "spine" + integration tests (Vitest, node env)
├── turo-bridge-poc/       Chrome MV3 extension "Drive247 Turo Bridge" + hand-applied SQL
├── ops/                   one-off SQL (restore northwind CMS on prod)
├── V2_PLAN.md  CLAUDE.md  ILLUSTRATION_GUIDE.md  PROJECT_CONTEXT.md (this)
└── turbo.json  vercel.json (booking only)  .mcp.json (Supabase MCP → PROD ref)
```

- `apps/bonzah` is mentioned in `V2_PLAN.md` but **does not exist** in this checkout.
- `packages/*` workspace is declared but unused — each app has its own `components/ui` (shadcn copies).
- `docs/`, `v2/`, `scripts/sql.mjs`, `deploy-functions.sh` are referenced by code/docs but **missing**.
- **No CI** (no `.github/`). Type errors don't fail builds in booking/portal/web (`ignoreBuildErrors`).
  Tests are the only safety net.

### Per-app conventions

| | booking | portal | web | admin |
|---|---|---|---|---|
| Source root | `src/` | `src/` | `src/` | app root (`app/`, `components/`, `lib/`, `store/`) |
| `@` alias | `./src` | `./src` | `./src` | `./` |
| TS strict | strictNullChecks only | **loose** (no strictNullChecks) | strict | **strict, build fails on type errors** |
| ignoreBuildErrors | yes | yes | yes | **no** |
| Tests | none | ~300 files, `src/__tests__/` | ~9 | ~30, `__tests__/` |
| Zod | v3 | v3 | v4 | v4 |
| Tailwind | 3 (+ precompiled TW4 CSS for northwind) | 3 | 4 | 3 |

All apps load env from the monorepo root `../../.env` via dotenv in `next.config.*`, plus per-app `.env.local`.

---

## 3. Tenant resolution

| App | Server | Client |
|---|---|---|
| booking | `src/middleware.ts`: subdomain → slug, else `tenants.custom_booking_domain`; sets `x-tenant-slug`; also routes design (§6) and redirects favicon | `src/contexts/TenantContext.tsx` re-derives from `window.location` (dev fallback `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`); ~135 fields + realtime |
| portal | `src/proxy.ts` (Next 16 rename of middleware — CLAUDE.md is wrong); subdomain or `tenants.custom_portal_domain`; sets `x-tenant-slug` | `src/contexts/TenantContext.tsx` (bare `localhost` → `drive-247` tenant); 3-tier column fallback ladder |
| portal server helpers | `lib/tenant-server.ts` (`tenantSlugFromHeaders`), `lib/portal-tenant.ts` (`cache()`'d anon read with column fallback) | |

Reserved subdomains (not tenants): `www admin portal api app` (+ `bonzah` in booking).
Local dev: `northwind.localhost:3000` (booking), `northwind.portal.localhost:4002` (portal — needed to see v2).

---

## 4. Auth & roles

- **Staff (portal/admin):** Supabase Auth → `app_users` row (`auth_user_id`, `tenant_id`, `role`,
  `is_super_admin`, `is_primary_super_admin`, `is_sales_agent`).
  - Roles: `head_admin`, `admin`, `manager`, `ops`, `viewer`. Login redirect: admins → `/`, ops → `/vehicles`, viewer → `/reports`.
  - Super admins have `tenant_id = NULL` (common null bug in edge functions). Impersonation via
    JWT `user_metadata.impersonated_tenant_id`, read by `get_user_tenant_id()`.
  - Portal store: `src/stores/auth-store.ts` (zustand; `setTimeout(…,0)` in auth listener is a
    deadlock workaround — keep it). Admin store: `admin/store/authStore.ts`.
- **Manager permissions:** `manager_permissions` table (`tab_key` → viewer/editor).
  `portal/src/lib/permissions.ts` (`TAB_KEYS`, `ROUTE_TO_TAB`), `hooks/use-manager-permissions.ts`.
  ⚠️ **Unmapped routes are allowed for managers** — every new route needs a `ROUTE_TO_TAB` entry.
  New tab keys must also be added to hardcoded `ALLOWED_TAB_KEYS` in edge fns
  `update-manager-permissions`, `admin-create-user`, `admin-update-role`.
- **Customers (booking):** completely separate — `auth.users` → `customer_users` → `customers`;
  `useCustomerAuthStore`. Northwind has its own customer-auth store.

---

## 5. v1 vs v2 — how gating actually works today

### Portal (`apps/portal/src/lib/`)
- `v2.ts` — `V2Area` union + `V2_AREAS` map (every area = `['northwind']`):
  `appearance theme dashboard chrome login rentals customers cms vehicles insights availability turo agreements finances`.
  `isV2(area, slug, onV2)` = slug listed **OR** `tenants.portal_experience === 'v2'`.
  Fails closed to v1. Keep the `Record<V2Area, readonly string[]>` annotation (not `as const`/`satisfies`
  — that turns `.includes()` into a silently-ignored type error).
- `v2-server.ts` — `resolvePortalGates()` (per-request `react.cache`, **never module state**),
  `serverIsV2(area)` for v2-only routes (`/finances`, `/insights`, `/integrations`, `/support` → `notFound()`).
- `v2-context.tsx` — `V2Provider`, `useV2(area)`, `usePortalOnV2()`. `chrome` is the most-used flag.
- `lean-areas.ts` / `lean-context.tsx` — "lean" product (northwind or v2): **hides** v1 areas
  (enquiries, leads, automations, quotes, tesla, owners, expenses, accounting, fleet-health, reports,
  reminders, some settings tabs…) at presentation level only. `useIsAreaHidden`. Lean tenants
  always sign BoldSign in **live** mode.
- Mirrors that must stay in sync: `apps/booking/src/lib/lean-tenants.ts`,
  `supabase/functions/_shared/lean-tenants.ts`, and the `integration-billing` gate (portal `lib/integration-billing/gate.ts`,
  booking, edge `integration-billing/gate.ts`). Tests pin some mirrors equal.
- v2 component trees: `components/{ui,dashboard,rentals,customers,vehicles,fleet,settings,cms,agreements,finances,invoices,insurance,billing,credits,availability,notifications,auth,skeleton,timeline,turo-bridge,messages,rewards,blacklist,admin,illustrations}-v2/`.
  Theme: `body.v2-theme` (Manrope, `styles/v2-theme.css`). v1 markup must stay byte-identical
  (`__tests__/components/root-layout-v1-parity.test.tsx`).
- Example branches: `rentals/page.tsx` (`if (v2) return <RentalsListV2/>`),
  `rentals/[id]/page.tsx` (`RentalDetailV2` vs 8k-line v1 detail).
- Self-serve signups (since 2026-09-17) are created with `portal_experience = 'v2'`.

### Booking — three designs
1. **Legacy** — default for everyone (`src/app/(legacy)/`).
2. **Custom booking page (CBP)** — reskin when `tenants.booking_v2_enabled && custom_site_eligible`
   (`src/lib/custom-site-routing.ts`, routes `/custom-booking-page/*`). Preview: `/booking-v2`.
3. **Northwind design** (`src/northwind-site/`, alias `@nw`, routes `src/app/(northwind)/northwind-site/`) —
   middleware **rewrites** slugs in `NEW_DESIGN_TENANTS = ['northwind']` (`src/lib/booking-design.ts`),
   except `ORIGINAL_ONLY_SEGMENTS` (auth, apply, booking-*, checkout, offer, pay, sms-opt-in, verify).
   Uses precompiled Tailwind 4 CSS from `scripts/build-northwind-css.mjs` → `public/nw-assets/`, and
   `-nw` npm aliases (`lucide-react-nw`, `react-day-picker-nw`, …).

### Backend
`-v2` edge functions serve the v2 portal (`agreements-v2`, `subscription-link-v2`,
`signup-payment-intent-v2`, `change-subscription-plan-v2`, `twilio-numbers-v2`, …). v2-only
migrations/crons gate on `portal_experience = 'v2' OR slug = 'northwind'`.

### Web (marketing)
Landing v2 behind `landing_version` RPC (no admin switch yet); preview with `/?landing=v2`.
`components/landing-v2/` is partial (4 sections; pricing/signup/header/footer not wired back yet).

---

## 6. Apps in detail

### 6.1 Portal (`apps/portal`) — operator dashboard
- Root `app/layout.tsx` (server, `force-dynamic`, per-tenant metadata, v2 theme), `app/providers.tsx`
  (QueryClient staleTime 60s / no window-focus refetch → TenantProvider → AuthInitializer →
  RealtimeChatProvider → ThemeProvider).
- `(auth)/` login, reset-password. `(dashboard)/layout.tsx` = auth guard, manager route guard,
  suspended screen, `SubscriptionGateDialog` (exempt: `/subscription`, `/credits`, `/settings*`),
  policy-acceptance gate, first-run wizard, NPS, announcements, force-logout guard, TRAX, v1/v2 chrome.
- ~102 pages. Areas: home `/`; fleet (`vehicles`, `fleet-health`, `plates`, `blocked-dates`,
  `vehicle-owners`, `owner-payouts`, `turo-bridge`); bookings (`rentals`, `rentals/new`,
  `pending-bookings`, `quotes`); customers (`customers`, `blocked-customers`, `enquiries`, `leads`,
  `automations`, `messages`); money (`payments`, `invoices`, `fines`, `credits`, `expenses`,
  `finances`[v2], `subscription`, `referrals`, `rewards`); docs (`agreements`, `documents`,
  `insurance(s)`, `reminders`); analytics (`reports`, `pl-dashboard`, `insights`[v2]); website
  (`cms/*`, `testimonials`, `promotions`); admin (`settings/*` — main page 7.5k lines, `users`,
  `audit-logs`, `integrations`, `support`, `trax`, `welcome`).
- API routes: `app/api/esign/*` (BoldSign, pdf-lib, service role), `trax-messaging`, `trax-support`.
  `playground/*` = fake-data v2 design sandbox (no auth).
- Data: ~250 hooks `src/hooks/use-*.ts`; query key `["entity", tenant?.id, …]`, `enabled: !!tenant`.
  `supabaseUntyped` (=`as any`) used widely; generated `types.ts` is stale.
  Side effects via `supabase.functions.invoke` (~150 distinct functions).
  Realtime: `use-realtime-invalidate.ts` (tenant-filtered), `RealtimeChatContext`.
- Monolith v1 pages: `rentals/[id]` 8.2k lines, `settings` 7.5k, `rentals/new` 6.8k.
- Key libs: `calculate-rental-price.ts`, `calculate-extension-price.ts`, `payment-provider.tsx`
  (use for Stripe/Square labels — never hard-code "Stripe"), `payment-status.ts`, `feature-access.ts`,
  `bonzah*.ts`, `agreement-*.ts`, `fleet-quote.ts` (source of the generated Deno copy).
- Tests: `cd apps/portal && npm test` (Vitest + jsdom; react aliased to root node_modules).

### 6.2 Booking (`apps/booking`) — customer site + customer portal
- Two root layouts: `(legacy)/layout.tsx` and `(northwind)/layout.tsx` (`experimental.globalNotFound`).
  `src/pages/` is only `_app/_document/_error` stubs.
- **Legacy flow** = `src/components/MultiStepBookingWidget.tsx` (6.5k lines, on the home page; CBP reuses it)
  + `src/stores/booking-store.ts` (zustand persist):
  1. trip (locations/delivery tiers, dates vs lead time/min hours) →
  2. vehicle search (`lib/vehicle-availability.ts`, `lib/calculate-rental-price.ts`, `use-dynamic-pricing`) →
  3. insurance (Bonzah purchase or upload own → `scan-insurance-document`; `config/tenant-config.ts` exemptions) →
  4. details + auth (OTP) + gig-driver + ID (QR → `/verify/[token]` → AI verification) →
  5. checkout `src/components/BookingCheckoutStep.tsx`: create customer + Pending rental + extras +
     invoice + Bonzah quote → e-sign `/api/esign` → payment (`create-checkout-session` | `create-preauth-checkout` | `create-installment-checkout`) →
     `/booking-success` (sync/apply payment, activate installments, confirm Bonzah, confirmation email).
  `/booking*` multi-page routes are dead (middleware redirects home).
- **Northwind flow:** fleet → `/booking/[vehicleId]`; pure quote `northwind-site/lib/quote/compute-quote.ts`
  ("the money contract"); `lib/booking/create-booking.ts` writes customer → rental → extras → invoice → ledger;
  embedded Stripe Elements via `create-booking-payment-intent`; documents/ID after payment via
  `/booking/documents/[token]`. No e-sign, no Bonzah selling.
- Customer portal: legacy `(legacy)/(customer-portal)/portal/*` (bookings, payments, verification,
  agreements, messages, extend/auto-extend, PAYG…); northwind `(portal)/portal/*`.
- CMS: `cms_pages`/`cms_page_sections` + faqs/testimonials/promotions/blog; northwind CMS edit overlay
  (`?cms-edit=1`, writes happen in portal).
- Gotchas: Kedic tenant hard-coded by id in `config/tenant-config.ts`; legacy TZ hard-coded
  `America/Los_Angeles`; northwind `lib/domain` duplicates `src/lib` pricing — change both.

### 6.3 Web (`apps/web`) — drive-247.com
- `(marketing)/page.tsx`: v1 sections or `LandingV2`; pricing shown if `landing_pricing_enabled` RPC
  or a valid `?ref=` promo. Plans from `signup_plans` (fallback constants), testimonials from `operator_testimonials`.
- Self-serve signup: `components/onboarding/*` (account → OTP → slug/setup → Stripe payment → provisioning)
  calling `signup-*` edge functions; `signup-provision` creates the tenant (v2).
- `/r/[code]` referral cookie, `/subscribe/[token]` sales payment links, `/strategy-call` (GHL embed,
  server action `src/actions/strategy-call.ts`), legal pages from `platform_legal_documents`,
  `/signup-preview` (dev-only mock journey).

### 6.4 Admin (`apps/admin`) — super-admin console
- Login requires `is_super_admin | is_primary_super_admin | is_sales_agent`; sales agents confined to
  `/admin/sales`, `/admin/promo-codes`. All data access client-side Supabase.
- ⚠️ Naming: **`/admin/rentals` = the Rental Companies (tenants) list**, `rentals/[id]` = tenant detail
  (3.1k lines: subscriptions, plans, payment links, discounts, credits, integrations, consent, timeline,
  suspend/delete/force-logout). `platform-rentals` = renter bookings across tenants.
- Other pages: customer-health, requests (go-live), sales onboarding, promo-codes/referrals,
  signup-plans (+ landing pricing switch), customer-management (automations, cancellations, retention
  offers, lifecycle/webinar/newsletter/milestone/abandoned-recovery runners, NPS, advisory board,
  pausing accounts, testimonials, creator rewards), announcements, feedbacks, audit-logs, blacklist,
  contacts, welcome-pack, openai-usage, integrations pricing, notifications v2, legal, onboarding
  questions, setup-checklist, bonzah-onboarding, admins, developer, settings, support.
- `dashboard` page is intentionally blank (being rebuilt).

### 6.5 TRAX
TRAX = v2 in-portal AI assistant (OpenAI, read-only policy-gated tools) + human support tickets.
Edge fns `trax-*`; shared UI in `shared/trax-support/` (used by portal `components/support/*` and
admin). Product voice guidance: plain, calm, first person, no emojis.

---

## 7. Backend (Supabase)

### 7.1 Edge functions (374) by domain
| Domain | Examples |
|---|---|
| Signup / onboarding | `signup-begin`, `signup-verify-otp`, `signup-slug-check`, `signup-payment-intent(-v2)`, `signup-provision`, `create-sales-onboarding` |
| Platform billing (Drive247 → tenants) | `subscription-webhook`, `create-subscription-checkout`, `subscription-link(-v2)`, `manage-subscription-plans`, `reconcile-subscriptions`, `subscription-pause(-run)`, `integration-billing`, `manage-credit-wallet` |
| Promos / referrals / rewards | `promo-code-lookup`, `admin-promo-codes`, `referral-engine`, `tenure-rewards-run`, `creator-reward-review` |
| Stripe Connect | `create-connected-account`, `stripe-oauth-*`, `sync-connect-status`, `stripe-webhook-live/test`, `stripe-connect-webhook` |
| Square | `square-oauth-*`, `square-webhook`, `create-square-card-payment`, `recover-pending-square-payments` |
| Checkout / payments / refunds | `create-checkout-session`, `create-preauth-checkout`, `create-installment-checkout`, `capture-booking-payment`, `apply-payment`, `process-refund`, `schedule-refund`, `charge-saved-card` |
| Deposit holds | `place-/capture-/release-/verify-/sync-/refresh-deposit-hold(s)` |
| Installments / PAYG / extensions | `activate-installment-plan`, `process-installment-payment`, `accrue-payg-charges`, `finalize-payg-rental`, `auto-extend-rentals` |
| E-sign (BoldSign) | `create-boldsign-document`, `boldsign-webhook`, `send-signing-email`, `agreements-v2` |
| Insurance | `bonzah-*`, `inshur-*`, `scan-insurance-document` |
| Identity / KYC | `cmd-*` (Modives), `create-ai-verification-session`, `ai-face-match`, `ai-document-ocr`, blacklist |
| Notifications | `notify-*` (~22), `send-*-email`, `send-push`, `aws-ses-email`, `aws-sns-sms` |
| Reminders | `reminders-generate`, `daily-reminders`, `send-return-reminders`, `send-lockbox-scheduled` |
| Twilio (BYO account) | `twilio-*`, `send-sms-message`, `manage-twilio-*` |
| Leads / CRM / automations | `submit-application`, `create-offer-link`, `accept-offer`, `convert-lead-to-rental`, `automation-*`, `ai-*` |
| Lifecycle / marketing | `customer-management-run`, `lifecycle-checkins-run`, `abandoned-recovery-run`, `sunday-newsletter-run`, `webinar-register` |
| AI / RAG / TRAX | `chat`, `customer-chat`, `rag-init`, `rag-sync`, `trax-*`, `generate-review-summary` |
| Accounting | `xero-*`, `zoho-*`, `process-accounting-sync`, `refresh-accounting-tokens` |
| Fleet / external | `tesla-*`, `turo-bridge-*`, `fleet-quote-api`, `dashboard-kpis`, `generate-export` |
| Auth / admin | `admin-create-user`, `admin-update-role`, `admin-force-logout`, `master-password-login`, `emergency-bootstrap` |
| Sandbox / test | `sandbox-*` cron copies, `sim-control`, `cleanup-test-data` |

Pattern: `Deno.serve` + `handleCors`/`jsonResponse`/`errorResponse` from `_shared/cors.ts`.
Service-role functions **must resolve and filter tenant_id themselves** (`_shared/resolve-tenant.ts`,
`_shared/tenant-auth.ts`). `verify_jwt=false` functions (webhooks, crons, public endpoints) verify
signatures / `X-Cron-Secret` / `x-platform-secret` in code.

### 7.2 `_shared/` highlights
- `stripe-client.ts` — per-tenant `stripe_mode` test/live; two platform accounts: **`uk`** (legacy,
  Express/managed) and **`uae`** (own Standard accounts via OAuth), chosen by `tenants.payment_model`.
  Existing records must stay on the account they were created under (`payments.platform_account`).
- `payments/` — provider seam Stripe vs Square (`resolve.ts`, adapters, refund math, tests).
- `boldsign-client.ts`, `bonzah-client.ts`, `inshur-client.ts`, `modives-client.ts`, `openai.ts`
  (logs `openai_usage_logs`), `resend-service.ts` (main email path), `aws-config.ts` (legacy SES/SNS),
  `twilio-*`, `web-push.ts`, `accounting/`, `signup-*`, `platform-promo*.ts`, `lean-tenants.ts`.
- **Generated, do not edit:** `_shared/calculate-rental-price.ts`, `_shared/fleet-quote.ts`
  (regenerate from portal with `node scripts/sync-fleet-quote.mjs`; `--check` to verify).

### 7.3 Integrations
Stripe (+Connect), Square, BoldSign, Bonzah, INSHUR, Modives CheckMyDriver, Resend (primary email),
AWS SES/SNS/Rekognition, Twilio, OpenAI (+OpenRouter fallback), Xero, Zoho Books, Tesla Fleet API,
Turo (via extension), GoHighLevel (strategy calls), Web Push (VAPID), Google Maps/Places.

### 7.4 Data model (core)
- `tenants` (~269 columns, 73 booleans — **don't add flags here**) · `app_users` · `manager_permissions`
- `customers` · `customer_users` · `identity_verifications` · `blocked_identities` · `global_blacklist`
- `vehicles` (+ photos, files, events, expenses, service_records, plates, owners, daily prices, pricing overrides; `available_daily/weekly/monthly`)
- `rentals` (status is capitalised free text; overlap constraint) + extensions, agreements, additional drivers, key handovers, damage reports, reviews, vehicle swaps
- Money: `ledger_entries` (Charge/Payment/Refund) ← `payment_applications` → `payments`
  (FIFO via `payment_apply_fifo(_v2)`), `invoices`, `pnl_entries`, `installment_plans`/`scheduled_installments`,
  `payg_accruals`, `financial_events` (→ accounting sync), `fines` (trigger creates ledger charge)
- Platform SaaS: `subscription_plans`, `tenant_subscriptions`, `tenant_subscription_invoices`,
  `tenant_subscription_pauses`, `tenant_credit_wallets`, `platform_promo_codes`, `referrals*`, `signup_plans`
- CMS: `cms_pages`, `cms_page_sections`, `cms_page_versions`, blog/faqs/testimonials/promotions
- Misc: reminders, notifications, email_templates/logs, chat_channels, call_logs, `rag_documents` (pgvector), `trax_support_*`
- RLS helpers (used by the ~146 tables that *do* have RLS): `get_user_tenant_id()`, `is_super_admin()`,
  `is_primary_super_admin()`, `is_global_master_admin()`, `is_sales_agent()` …
- **Schema drift:** many tables/RPCs used in code were created out-of-band and have no migration
  (e.g. `square_connections`, `conversations`, `subscription_links`, `signup_plans`, `automations`,
  `exec_sql`, `platform_verify_secret`). Migrations do **not** fully reproduce prod — verify against the
  DB (Supabase MCP / `v1:check`), not just the migration files.
- Regenerate types after schema change:
  `npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts`
  then copy to booking and admin. (Note: root `npx supabase` resolves to an unrelated 0.5.0 package —
  use a real Supabase CLI.)

### 7.5 Crons (pg_cron)
Every-minute: `send-lockbox-scheduled`, `cmd-poll-pending`, `process-backfill-jobs`,
`dispatch-strategy-call-emails`, `recover-pending-square-payments`. Frequent: `send-return-reminders`,
`accrue-payg-charges`, `auto-extend-rentals`, `referral-engine` (15 min), `process-accounting-sync` (2 min),
`subscription-pause-run` (5 min), token refreshes (10 min). Hourly/daily: `send-payg-reminders`,
`reconcile-subscriptions`, `sync-tesla-charges`, `send-auto-extension-reminders` (14:00), health scores.
Some runners (`lifecycle-checkins-run`, `marketing-emails-run`, `milestones-run`,
`abandoned-recovery-run`, `sunday-newsletter-run`) were scheduled outside migrations.
Two migrations hard-code the **prod** URL in `pg_net` triggers. Deleting function source does not
unschedule a cron or undeploy a function — check `cron.job` and the deployed list.

---

## 8. Feature quick-reference (where to look)

| Feature | Portal | Booking | Backend |
|---|---|---|---|
| Rental pricing | `lib/calculate-rental-price.ts` | `lib/calculate-rental-price.ts`, nw `lib/quote/compute-quote.ts` | `_shared/calculate-rental-price.ts` (generated) |
| Dynamic pricing (weekend/holiday) | `tenant_holidays`, `vehicle_pricing_overrides` | `hooks/use-dynamic-pricing.ts` | migration `20260218120000` |
| Auto-extend | `components/rentals/auto-extension-section.tsx`, v2 `rentals-v2/rental-detail/rail-extensions.tsx` | customer portal extend | `auto-extend-rentals`, `send-auto-extension-reminder` |
| Payments / refunds | `payments/*`, `shared/dialogs/*`, `lib/payment-provider.tsx` | `BookingCheckoutStep.tsx` | `apply-payment`, `process-refund`, `_shared/payments/` |
| Deposit holds | take/charge-deposit dialogs | `/booking-success` | `*-deposit-hold` |
| Installments / PAYG | `components/installments`, `payg-section` | `InstallmentSelector.tsx`, `/pay/[token]` | `*-installment-*`, `*-payg-*` |
| E-sign | `app/api/esign/*`, `components/agreements(-v2)`, `settings/esign-settings.tsx` | `app/api/esign/*` | `create-boldsign-document`, `boldsign-webhook`, `agreements-v2` |
| Insurance | `lib/bonzah*.ts`, `integrations/_panels/bonzah*`, INSHUR settings | `BonzahInsuranceSelector`, insurance upload | `bonzah-*`, `inshur-*` |
| Lockbox | `rentals/lockbox-*`, `settings/lockbox-templates-section.tsx` | — | `notify-lockbox-code`, `send-lockbox-scheduled` |
| Subscription gating | `hooks/use-tenant-subscription.ts`, `components/subscription/*`, sidebar chip | — | `subscription-webhook` (source of truth) |
| Manager permissions | `lib/permissions.ts`, `hooks/use-manager-permissions.ts` | — | `update-manager-permissions` |
| Realtime chat | `RealtimeChatContext` | `CustomerRealtimeChatContext` | `customer-chat`; channel `tenant_${tenantId}_customer_${customerId}` |
| CMS | `cms/*`, `components/cms-v2` | `hooks/usePageContent.ts`, nw `lib/cms/*` | `seed_cms_pages_for_tenant` |

---

## 9. Environments, commands & scripts

**Supabase projects:** prod `hviqoaokxvlancmftwuo` · staging branch `ksmreaadhbirzakkxqrq`.
`.mcp.json` points the Supabase MCP at **prod**.

```bash
npm run dev:booking | dev:portal | dev:web | dev:admin   # always use root scripts (guard + port-kill + turbo)
npm run db:switch staging|prod|status                     # rewrites apps/*/.env.local Supabase vars (backs up prod)
npm run v1:check / v1:snapshot                            # guardrail (needs SUPABASE_ACCESS_TOKEN)
npm run test:spine                                        # root tests, safe offline
npm run test:spine:live                                   # needs tests/.env.local (D247_LIVE_*); refuses prod ref
cd apps/portal && npm test                                # portal unit tests
```

Ports: booking 3000, portal 4002, web 4003, admin 4004 (CLAUDE.md's 3001–3003 is stale;
`.env.example` still points marketing URL at 3002).

Scripts (danger level):
- **Prod by default — high:** `deploy-edge-function.py` (`SB_PAT=… python3 scripts/deploy-edge-function.py <fn>`;
  set `SUPABASE_PROJECT_ID=ksmreaadhbirzakkxqrq` for staging; preserves deployed `verify_jwt`),
  `trax-deploy.mjs`, `seed-northwind.mjs` / `wipe-northwind.mjs` (manifest-scoped; never `--force-sweep`),
  `bulk-update-branding.js`, `update-cms-content.js`.
- **Read-only:** `v1-check/*`, `check-edge-deploys.mjs` (deployed bundle markers), `check-edge-function-scopes.mjs`,
  `square-credential-health.mjs`, `sync-fleet-quote.mjs --check`.
- **Local:** `kill-dev-ports.mjs` (kill -9 on dev ports), `guard-db-env.mjs`, `build-northwind-css.mjs`,
  `gen-test-docs.mjs` (→ `tests/TEST-CATALOGUE.md`).

Root tests (`tests/`): layers L1 contract (parsed from source) / L2 live HTTP / L3 real code;
`spine/onboarding/01–05`, `spine/rental/01–09` (incl. tenant isolation), `integrations/*` (stripe,
boldsign, square, bonzah, accounting, signup…). Chain state shared — first failing step skips the rest.
Edge-function Deno tests: `supabase/functions/_tests/` (referrals run on PGlite + emulators) and
`_shared/payments/__tests__/`.

Env: copy `.env.example` → `.env` (root) and per-app `.env.local`. Groups: Supabase, Stripe (booking,
subscription, UAE signup), BoldSign, AWS, Resend, OpenAI/OpenRouter, Twilio, Xero/Zoho, VAPID, GHL,
Modives, signup flags. Note `.gitignore` lists `.env.example` even though it's committed.

---

## 10. Design system

- **Portal v1:** flat (no shadows, 1px `#f1f5f9` borders), indigo `#6366f1` accent, DM Sans (Inter for
  buttons/badges), stat cards → title → filter bar → indigo-header table; two-column settings.
- **Portal v2:** `.v2-theme`, Manrope, accent var `--pv-accent` (`#5b5bd6`).
- **Motion (all apps, all tenants):** 200ms, ease-out in / ease-in out, opacity + 12px `translate-y`,
  transform/opacity only, `motion-reduce:transition-none` always; applied at primitive level
  (dialog, sheet, popover, dropdown, select, tooltip, toast). Reference: `components/trax/trax-panel.tsx`.
- **Illustrations:** "Quiet Confidence" — see `ILLUSTRATION_GUIDE.md` (approved SVG car/people code,
  light+dark versions, no emojis, no chips, empty-state funnel layout).

---

## 11. Known hazards & tech debt (don't be surprised)

- Hard-coded secrets/fallbacks in committed code: staging anon + **service-role** keys in
  `scripts/db-switch.mjs`; fallback Supabase URL/anon key in admin `lib/supabase.ts`, portal & booking
  Supabase clients, booking middleware; test Stripe PK fallback in booking `config/stripe.ts`.
- Generated Supabase `types.ts` is stale → `supabaseUntyped` everywhere; builds ignore type errors.
- Duplicated logic that must change together: tenant slug parsing (proxy/middleware vs TenantContext),
  lean/integration-billing gates (portal/booking/edge), pricing (portal ↔ edge generated ↔ booking ↔ northwind `lib/domain`),
  plan catalogue (`_shared/signup-plans.ts` ↔ `apps/web/src/lib/plans.ts`).
- `notFound()` under portal `(dashboard)` returns HTTP **200** — verify gates on rendered content,
  testing three cases: northwind / real non-canary tenant / nonexistent slug.
- `private.snapshot_rental_health()` BEFORE INSERT trigger on `rentals` has no exception handler;
  `queue_for_rag()` AFTER trigger assumes `NEW.tenant_id`.
- Removing a feature: prove completeness with an independent grep
  (`git ls-tree -r --name-only HEAD | grep -icE '<name>'` must be 0), and separately unschedule crons /
  undeploy functions.
- Hide, don't delete v1 areas — past deletions (Fleet Quotes, Tesla) broke live tenants.
- `trax-schema-snapshot.mjs` is broken (missing `scripts/sql.mjs`).

---

## 12. Where CLAUDE.md is stale

- Portal tenant hook is `src/proxy.ts`, not `middleware.ts`.
- Dev ports are 3000 / 4002 / 4003 / 4004, not 3000–3003.
- Edge function count is 374 (not "100+"), with far more `verify_jwt = false` than 10.
- `scripts/deploy-functions.sh`, `seed-vehicles.*`, `wipe-all-data.mjs`, `docs/DATABASE_SCHEMA.md` are not in the repo.
- Booking has two root layouts and three designs (legacy / CBP / northwind).
- Admin tenant detail is `app/admin/(protected)/rentals/[id]` (the "rentals" route means tenants).
- Email goes mainly through Resend (`_shared/resend-service.ts`), not SES.
