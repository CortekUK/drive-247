# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development (all apps)
npm run dev

# Development (specific app)
npm run dev:booking    # port 3000
npm run dev:portal     # port 3001
npm run dev:web        # port 3002
npm run dev:admin      # port 3003

# Build & Lint
npm run build
npm run lint

# Testing (Vitest + jsdom — portal has tests, booking has config but no tests yet)
cd apps/portal && npm run test         # run tests once
cd apps/portal && npm run test:watch   # watch mode

# Run a single test file
cd apps/portal && npx vitest run src/__tests__/hooks/use-pickup-locations.test.ts
# Tests live in src/__tests__/**/*.test.{ts,tsx}, setup in src/__tests__/setup.ts

# Supabase
npx supabase functions serve           # run edge functions locally
npx supabase db push                   # push migrations to remote

# After schema changes, regenerate types and copy to all apps:
npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/admin/src/integrations/supabase/types.ts
```

## Architecture Overview

This is a **Turborepo monorepo** for Drive247, a car rental platform with multi-tenant support. The `packages/*` workspace is declared but unused — each app has its own dependencies and UI components.

### Apps

- **booking** (`apps/booking`): Customer-facing booking & customer portal (Next.js 15, React 18)
- **portal** (`apps/portal`): Multi-tenant admin portal for rental operators (Next.js 16, React 18)
- **admin** (`apps/admin`): Super-admin dashboard (Next.js 16, React 19)
- **web** (`apps/web`): Marketing/landing page (Next.js 16, React 19)

All apps use Next.js **App Router**. The `@` path alias maps to `./src` in booking/portal, and to `./` (project root) in admin/web.

### Tech Stack

- **Framework**: Next.js 15-16, React 18-19, TypeScript
- **Database**: Supabase (PostgreSQL with RLS)
- **State**: Zustand (client state), React Query (server state)
- **Forms**: React Hook Form + Zod validation (v3 in booking/portal, v4 in admin/web)
- **Styling**: Tailwind CSS 3 + Radix UI primitives + `class-variance-authority`
- **Payments**: Stripe (dual test/live mode per tenant, Connect)
- **Auth**: Supabase Auth with RBAC (head_admin, admin, ops, viewer)
- **Testing**: Vitest + jsdom + Testing Library (booking, portal only)
- **Rich text**: Tiptap (portal), React Quill (legacy)

## Multi-Tenancy Pattern

Tenant identification differs between apps:
- **Portal**: `{tenant}.portal.drive-247.com` — middleware extracts slug, injects `x-tenant-slug` header
- **Booking**: `{tenant}.drive-247.com` — middleware extracts slug, injects `x-tenant-slug` header
- **Dev**: Set `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` in `.env.local` or access via subdomain (e.g., `test.localhost:3000`, `test.portal.localhost:3001`)

Both apps use:
- `TenantContext` (`src/contexts/TenantContext.tsx`) provides client-side tenant state
- Middleware (`src/middleware.ts`) extracts tenant slug from subdomain and sets `x-tenant-slug` header
- Supabase RLS enforces data isolation per tenant (via `get_user_tenant_id()` SQL function)
- Super admins (`is_super_admin = true` in `app_users`) bypass tenant RLS and can access all tenant data

Key difference: Booking's TenantContext (~470 lines) has extensive branding/operational config with real-time Supabase subscriptions for live updates. Portal's (~170 lines) is simpler with a `refetchTenant()` method but no real-time subscription.

## App Routing & Auth

### Portal (`apps/portal`)
- Source in `src/app/`, root layout is `"use client"`
- `(auth)/` route group — login page, unauthenticated
- `(dashboard)/` route group — protected admin pages, requires `useAuth()` from `stores/auth-store.ts`
- Auth check in `(dashboard)/layout.tsx` redirects to `/login` if no user/appUser
- RBAC roles: `head_admin`, `admin`, `manager`, `ops`, `viewer`
- Stores: `auth-store.ts` (Zustand with `initialize()` method), `settings-store.ts`
- Contexts: `TenantContext`, `RealtimeChatContext`
- Provider chain: `QueryClientProvider → TenantProvider → RealtimeChatProvider → AuthInitializer → ThemeProvider`
- React Query default: `staleTime: 60s`, `refetchOnWindowFocus: false`

### Booking (`apps/booking`)
- Source in `src/app/`, root layout uses `export const dynamic = 'force-dynamic'` (avoids SSR issues with Supabase)
- Public routes: `/booking`, `/fleet`, `/about`, `/contact`, `/faq`, etc.
- `(customer-portal)/portal/` route group — protected customer area
- Auth check in `(customer-portal)/layout.tsx` redirects to `/?auth=login` if not authenticated
- **Dual auth systems**: `useCustomerAuthStore()` for customers (links `auth.users` → `customer_users` → `customers`), separate from portal's `useAuth()` which uses `app_users`
- Stores: `booking-store.ts` (booking flow state), `customer-auth-store.ts`
- Contexts: `TenantContext` (with realtime subscriptions), `CustomerRealtimeChatContext`
- Provider chain: `QueryClientProvider → TenantProvider → CustomerAuthProvider → ThemeProvider`
- Server-side metadata generation fetches tenant SEO config via `x-tenant-slug` header

### Admin & Web
- Source in `app/` directly (no `src/` directory), `@` alias maps to project root
- `admin/(protected)/` route group for authenticated admin pages
- Simpler apps with their own `store/authStore.ts` (singular `store/`)

## Key Patterns

### Supabase Client
```typescript
import { supabase } from "@/integrations/supabase/client";
// Types auto-generated in integrations/supabase/types.ts

// For queries causing TypeScript depth issues, use untyped client:
import { supabaseUntyped } from "@/integrations/supabase/client";
```

### React Query Hooks
Custom hooks in `apps/{app}/src/hooks/` wrap Supabase queries with React Query:
- Named `use-{entity}.ts` or `use-{entity}-{action}.ts`
- Query keys include `tenant?.id` for cache isolation: `["entity-name", tenant?.id, ...params]`
- Most hooks require `useTenant()` and use `enabled: !!tenant` to prevent queries without tenant context

Example pattern:
```typescript
export const useActiveRentals = () => {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["active-rentals", tenant?.id],
    queryFn: async () => { /* ... */ },
    enabled: !!tenant,
  });
};
```

### Form Schemas
Zod schemas in `client-schemas/` directories within each app, organized by feature (customers, rentals, vehicles, etc.).

### Realtime Chat
Uses Supabase Realtime channels (replaced Socket.io):
- **portal**: `RealtimeChatContext` — manages per-customer channels, presence tracking, typing indicators, bulk messaging
- **booking**: `CustomerRealtimeChatContext` — customer-side, single auto-created channel
- Channel naming: `tenant_${tenantId}_customer_${customerId}`
- Edge function `customer-chat` handles server-side operations (`verify_jwt = false`)

### Edge Functions
100+ Supabase Edge Functions in `supabase/functions/`. Major categories:
- **Webhooks**: Stripe (`stripe-webhook-test`, `stripe-webhook-live`, `stripe-connect-webhook`), BoldSign (`boldsign-webhook`), Veriff
- **Payments**: `create-checkout-session`, `create-preauth-checkout`, `capture-booking-payment`, `process-refund`, `schedule-refund`, installment handling
- **Stripe Connect**: `create-connected-account`, `get-connect-onboarding-link`, `sync-stripe-account`
- **Notifications**: `aws-ses-email`, `aws-sns-sms`, `send-booking-email`, 15+ `notify-*` functions
- **Verification**: `create-veriff-session`, `create-ai-verification-session`, `ai-document-ocr`, `ai-face-match`
- **Insurance**: `bonzah-calculate-premium`, `bonzah-create-quote`, `bonzah-confirm-payment`, `bonzah-download-pdf`, `bonzah-verify-credentials`, `bonzah-view-policy`, `bonzah-get-balance`, `bonzah-probe-pdf`
- **Lockbox**: `notify-lockbox-code` — sends lockbox code to customers via email/SMS using per-tenant templates from `lockbox_templates` table
- **Admin**: `admin-create-user`, `admin-update-role`, `admin-deactivate-user`, `emergency-bootstrap`
- **RAG chatbot**: `chat`, `rag-init`, `rag-sync`
- **Subscriptions**: `create-subscription-checkout`, `create-subscription-portal-session`, `get-subscription-details`, `subscription-webhook`
- **Shared utilities** in `supabase/functions/_shared/`: `cors.ts`, `stripe-client.ts`, `aws-config.ts`, `email-template-service.ts`, `openai.ts`, `bonzah-client.ts`, `resend-service.ts`, `document-loaders.ts`

10 functions have `verify_jwt = false` in `supabase/config.toml`: `boldsign-webhook`, `veriff-webhook`, `customer-chat`, `validate-customer-invite`, `submit-customer-registration`, `custom-auth-email`, `subscription-webhook`, `check-policy-acceptance`, `stripe-webhook-test`, `stripe-webhook-live`. Stripe webhook functions handle their own signature verification. All other functions require JWT auth by default.

Edge function pattern:
```typescript
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // ... function logic
  return jsonResponse({ success: true });
});
```

### Stripe Dual-Mode
Tenants can operate in `test` or `live` mode. Use helpers from `_shared/stripe-client.ts`:
- `getStripeClient(mode)` - Get Stripe client for test or live mode
- `getTenantStripeMode(supabase, tenantId)` - Fetch tenant's configured mode
- `getConnectAccountId(tenant)` - Get Connect account ID (shared test account vs tenant's own)
- `getPublishableKey(mode)` - Get publishable key for client-side
- `getStripeOptions(connectAccountId)` - Create request options for Connect API calls

In test mode, all tenants share a single Connect account (`STRIPE_TEST_CONNECT_ACCOUNT_ID`). In live mode, each tenant uses their own Connect account after completing onboarding.

### Manager Permissions
The `manager` role has granular per-tab access control, unlike other roles which get fixed access levels. Each manager gets a set of `manager_permissions` rows (in the `manager_permissions` table) mapping `tab_key` → `access_level` (`viewer` or `editor`). Settings has nested sub-tabs (e.g., `settings.general`, `settings.branding`).

- **Permission constants**: `src/lib/permissions.ts` — single source of truth for tab keys, groups, route mappings, and dashboard widget requirements
- **Hook**: `src/hooks/use-manager-permissions.ts` — fetches and caches the logged-in manager's permissions
- **UI**: `src/components/users/manager-permissions-selector.tsx` — grouped checkbox UI for assigning permissions when creating/editing a manager user
- Sidebar items and dashboard widgets are filtered based on granted tabs. Read-only mode is enforced on pages when `access_level === 'viewer'`.

### Tenant-Specific Business Logic
`apps/booking/src/config/tenant-config.ts` contains per-tenant overrides (e.g., insurance exemptions, enquiry-based booking). Check this file when adding tenant-conditional behavior.

### UI Components
Each app has its own `components/ui/` directory with Radix UI primitives (40+ components). These are **not shared** between apps — they're duplicated per app using the same shadcn/ui patterns (Tailwind + `class-variance-authority` + `tailwind-merge`).

## Testing

Tests use Vitest + jsdom + Testing Library. Only portal currently has test files; booking has vitest config but no tests yet.

- **Config**: `vitest.config.ts` in each app — jsdom environment, `globals: true`, `@` alias mapped to `./src`
- **Test location**: `src/__tests__/**/*.test.{ts,tsx}`
- **Setup file**: `src/__tests__/setup.ts` — imports `@testing-library/jest-dom` and mocks `matchMedia`, `ResizeObserver`, `IntersectionObserver`
- **Pattern**: Tests mock `supabase` and `useTenant()`, then render hooks/components via `renderHook` from Testing Library

## Utility Scripts

`scripts/` contains operational utilities:
- `deploy-functions.sh` — deploy edge functions
- `seed-vehicles.mjs` / `seed-vehicles.ts` — seed vehicle data
- `seed-bonzah-demo.mjs` — seed demo data for Bonzah tenant (branding, customers, vehicles, plans)
- `add-vehicle-photos.mjs` / `update-vehicle-images.mjs` — vehicle image management
- `wipe-all-data.mjs` — wipe tenant data (destructive)
- `bulk-update-branding.js` / `update-cms-content.js` — bulk content updates
- `deploy-stripe-connect.sh` / `setup-stripe-secrets.sh` / `test-stripe-mode.sh` — Stripe setup helpers
- `cleanup-temp-customers.sql` — database cleanup

## Environment Variables

Required variables (see `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `STRIPE_TEST_SECRET_KEY`, `STRIPE_LIVE_SECRET_KEY` (edge functions)
- `STRIPE_TEST_PUBLISHABLE_KEY`, `STRIPE_LIVE_PUBLISHABLE_KEY`
- `STRIPE_SUBSCRIPTION_SECRET_KEY`, `STRIPE_SUBSCRIPTION_PRICE_ID`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` (platform subscription billing)
- `NEXT_PUBLIC_VERIFF_API_KEY` (booking)
- BoldSign API key (`BOLDSIGN_API_KEY`, `BOLDSIGN_BASE_URL`)
- AWS SES/SNS credentials for emails and SMS

## Build Notes

- Booking and portal have `ignoreBuildErrors: true` for TypeScript; admin and web do not
- Booking uses `output: 'standalone'` for Vercel deployment with `outputFileTracingRoot` set to monorepo root
- Booking loads env from monorepo root via `dotenv({ path: '../../.env' })` in `next.config.ts`
- Portal transpiles TipTap and recharts packages (`transpilePackages` in `next.config.js`)
- Booking has webpack alias for Supabase ESM module compatibility (`extensionAlias`)

## Gotchas & Non-Obvious Details

- **Auth store deadlock workaround**: Both auth stores use `setTimeout(..., 0)` in Supabase auth state change listeners to avoid a Supabase client deadlock. Do not remove this.
- **TypeScript strictness varies**: Admin has `strict: true`; booking has `strictNullChecks: true` only; portal has `strictNullChecks: false`. Be aware when moving code between apps.
- **Portal branding anti-flash**: Portal's root layout injects an inline `<script>` that reads cached branding CSS from `localStorage` before React hydration to prevent theme flash.
- **Admin/Web have no `src/` directory** (except `src/integrations/` for Supabase client/types): Code lives at project root (`app/`, `components/`, `lib/`, `store/`). The `@` alias maps to `./` not `./src`.
- **Booking TenantContext is the source of truth** for all tenant settings (135+ fields, real-time subscriptions). Portal's TenantContext only loads ~7 fields for admin purposes.
- **Customer auth vs portal auth are completely separate**: Customers use `customer_users` → `customers` tables. Portal staff use `app_users` table. Different stores, different auth flows.
- **Vehicle availability toggles**: `available_daily`, `available_weekly`, `available_monthly` (boolean, default true) on `vehicles` table control which booking durations each vehicle supports.

## Database

Migrations in `supabase/migrations/` (naming: `YYYYMMDDHHMMSS_description.sql`). Full schema reference in `docs/DATABASE_SCHEMA.md` including RLS policies. Stripe Connect details in `docs/STRIPE_CONNECT_PRODUCTION.md` and `docs/STRIPE_CONNECT_TESTING.md`.

Key RLS helper functions: `get_user_tenant_id()`, `is_super_admin()`, `is_primary_super_admin()`, `is_global_master_admin()`. Super admins must have `tenant_id = NULL` in `app_users`.

Notable tables: `manager_permissions` stores per-tab access for manager-role users (`app_user_id`, `tab_key`, `access_level`). RLS allows users to read their own; head admins read their tenant's; service_role manages mutations.

## Tenant Subscription System

Platform-level billing where Drive247 charges tenants (rental operators) a monthly fee. This is **separate** from the existing Stripe Connect/dual-mode system used for booking payments — subscriptions use their own Stripe account with dedicated env vars (`STRIPE_SUBSCRIPTION_SECRET_KEY`, `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`).

### Database Schema

**`subscription_plans`** — per-tenant plans managed by super admin
- Links to `tenants` via `tenant_id`; stores `stripe_price_id` and `stripe_product_id`
- Fields: `name`, `description`, `features` (JSONB array), `amount` (cents), `currency`, `interval` (month/year), `is_active`, `sort_order`, `trial_days` (int, default 0)
- RLS: tenants can SELECT their own plans (+ super admins); only `service_role` can manage
- Migration: `supabase/migrations/20260211063727_add_subscription_plans.sql`

**`tenant_subscriptions`** — one active subscription per tenant (enforced by unique index on `tenant_id` where status in `active`, `trialing`, `past_due`)
- Links to `tenants` via `tenant_id`, stores `stripe_subscription_id` and `stripe_customer_id`
- `plan_id` (UUID FK) links to the `subscription_plans` row the tenant subscribed to
- Status enum: `incomplete`, `active`, `past_due`, `canceled`, `unpaid`, `trialing`, `paused`
- Stores payment method details: `card_brand`, `card_last4`, `card_exp_month`, `card_exp_year`
- Billing cycle tracked via `current_period_start/end`, cancellation via `cancel_at/canceled_at/ended_at`, trial via `trial_end` (timestamptz)
- RLS: tenants can SELECT their own; only `service_role` (edge functions) can INSERT/UPDATE/DELETE

**`tenant_subscription_invoices`** — historical invoices per tenant
- References `tenant_subscriptions` (nullable FK, set NULL on delete)
- Stores `stripe_invoice_pdf`, `stripe_hosted_invoice_url`, amounts in cents
- Status enum: `draft`, `open`, `paid`, `void`, `uncollectible`
- Same RLS pattern as subscriptions

**`tenants` table additions:**
- `stripe_subscription_customer_id` (TEXT) — Stripe Customer ID for platform billing
- `subscription_plan` (TEXT, default `"basic"`) — current plan name, set dynamically based on active subscription

Migrations: `supabase/migrations/20260212100000_add_tenant_subscriptions.sql`, `supabase/migrations/20260211063727_add_subscription_plans.sql`, `supabase/migrations/20260211072016_add_trial_support.sql`

### Edge Functions

| Function | JWT | Purpose |
|----------|-----|---------|
| `manage-subscription-plans` | Yes | CRUD for per-tenant plans (super admin only). Actions: `create`, `update`, `deactivate`, `activate`, `delete`, `list`. Creates Stripe Price objects automatically. |
| `create-subscription-checkout` | Yes | Accepts `planId`, looks up `stripe_price_id` from DB; creates Stripe Checkout session with plan metadata. Passes `trial_period_days` to Stripe when plan has trial. |
| `create-subscription-portal-session` | Yes | Creates Stripe Billing Portal session for managing payment methods |
| `get-subscription-details` | Yes | Fetches DB subscription + live Stripe data (expanded payment method & latest invoice) |
| `subscription-webhook` | **No** | Handles Stripe webhook events; reads plan info from metadata instead of hardcoding. Stores `trial_end` from Stripe subscription. |

**Webhook events handled** (`subscription-webhook`):
- `checkout.session.completed` → reads `plan_id`/`plan_name` from metadata, upserts subscription with actual plan, stores card details
- `customer.subscription.updated` → resolves plan name from metadata or DB fallback, syncs status/period/card changes
- `customer.subscription.deleted` → marks canceled, reverts to `"basic"`
- `invoice.paid` / `invoice.payment_failed` → upserts invoice records

All webhook handlers use `service_role` Supabase client to bypass RLS. Tenant is identified via `metadata.tenant_id` on Stripe objects.

### Stripe Architecture

One shared Stripe Product ("Drive247 Platform Subscription") with separate Stripe Price objects per plan. When admin creates/updates a plan, a Stripe Price is created (Prices are immutable — changing amount creates a new Price and deactivates the old one). At checkout, the specific plan's `stripe_price_id` is used.

### Admin UI (apps/admin)

**Tenant detail page** (`app/admin/(protected)/rentals/[id]/page.tsx`) — Subscription tab includes:
- **Subscription Plans card**: table of plans for this tenant (name, amount, interval, features count, status, actions)
- **Add/Edit Plan modal**: form with name, description, amount (dollars), currency, interval, dynamic features list
- **Actions**: Edit, Activate/Deactivate toggle, Delete (blocked if subscriptions exist)
- All actions call `manage-subscription-plans` edge function

### Portal UI (apps/portal)

**Hooks**:
- `src/hooks/use-tenant-subscription.ts` — queries, mutations (`createCheckoutSession` accepts `planId`), computed: `isSubscribed`, `hasExpiredSubscription`, `isTrialing`, `trialDaysRemaining`
- `src/hooks/use-subscription-plans.ts` — fetches active plans for tenant: `["subscription-plans", tenant?.id]`

**Pages/Components**:
- `src/app/(dashboard)/subscription/page.tsx` — shows grid of dynamic `PricingCard` components when unsubscribed; "Contact us" if no plans configured
- `src/components/settings/subscription-settings.tsx` — same dynamic plan rendering embedded in Settings page (includes `LocalInvoiceView` dialog)
- `src/components/subscription/pricing-card.tsx` — accepts `plan` prop (name, amount, currency, interval, features, trial_days from DB), `onSubscribe(planId)`. Shows "Start X-Day Free Trial" button when plan has trial.
- `src/components/subscription/subscription-gate-dialog.tsx` — soft-gate modal for never-subscribed tenants, dismissible
- `src/components/subscription/subscription-block-screen.tsx` — hard-block full-screen overlay for expired/canceled subscriptions, non-dismissible

**Sidebar** (`app-sidebar.tsx`): Shows "Trial Active" with Timer icon when trialing (plus days-remaining countdown), "Subscription" with Crown icon if subscribed, "Upgrade" with Sparkles icon if not.

**Dashboard layout** (`(dashboard)/layout.tsx`): Two-tier gating — `SubscriptionBlockScreen` (hard) for `hasExpiredSubscription`, `SubscriptionGateDialog` (soft) for never-subscribed. `/subscription` and `/settings` routes bypass the hard block.

### Data Flow

1. Super admin creates plan(s) for tenant in admin UI → `manage-subscription-plans` creates Stripe Price + DB row
2. Tenant sees their plan(s) in portal → clicks "Subscribe Now" on a plan → `createCheckoutSession({ planId })` → redirected to Stripe Checkout
3. Payment completes → Stripe sends `checkout.session.completed` webhook → DB updated with plan info from metadata
4. Portal detects `?status=success` query param → polls `refetch()` every 2s for 15s waiting for webhook to land
5. Ongoing changes (renewals, cancellations, payment failures) arrive via webhook events → DB stays in sync
6. `isSubscribed` drives all UI gating: sidebar labels, gate dialog, settings display

### Key Design Decisions

- **Dynamic per-tenant pricing** — super admin configures different plans/prices for each tenant via admin UI
- **Two-tier gating** — soft gate (dismissible dialog) for tenants who never subscribed; hard block (full-screen, non-dismissible) for tenants whose trial/subscription expired or was canceled. `/subscription` and `/settings` routes bypass the hard block so tenants can resubscribe
- **Configurable trial periods** — `trial_days` per plan (0 = no trial). Stripe handles trial logic via `trial_period_days`. Sidebar shows trial countdown when `status === "trialing"`
- **Separate Stripe account** — subscription billing is NOT on Stripe Connect; uses platform's own Stripe keys
- **Webhook as source of truth** — frontend never writes subscription state directly; all mutations come through Stripe webhooks
- **Plan info in Stripe metadata** — `plan_id` and `plan_name` are stored in checkout session and subscription metadata for webhook resolution

## Lockbox Feature

Self-service key handover system where customers retrieve keys from a lockbox instead of in-person.

- **Tenant settings**: `lockbox_enabled`, `lockbox_code_length`, `lockbox_notification_methods` (jsonb array of `["email", "sms"]`) on `tenants` table
- **Vehicle fields**: `lockbox_code` (text), `lockbox_instructions` (text, e.g., "rear left wheel arch") on `vehicles` table
- **Rental tracking**: `delivery_method` (enum: `lockbox`, `in_person`, NULL) on `rentals` table
- **Templates**: `lockbox_templates` table stores per-tenant customizable email/SMS templates with `{{variable}}` placeholders (`{{customer_name}}`, `{{vehicle_reg}}`, `{{lockbox_code}}`, `{{booking_ref}}`, `{{delivery_address}}`, `{{lockbox_instructions}}`)
- **Notification**: `notify-lockbox-code` edge function sends via Resend (email) and AWS SNS (SMS), falls back to default templates if no custom template exists
- **WhatsApp**: `send-collection-whatsapp` edge function sends collection/lockbox details via WhatsApp using per-tenant templates with `{{variable}}` placeholders
- **Portal UI**: Key handover section on rental detail page supports lockbox delivery; lockbox template editor in settings (only visible when `lockbox_enabled = true`)

## Setup Hub & Go-Live System

Tenant onboarding progress tracking during trial period:

- **`setup_completed_at`** (timestamptz on `tenants`) — set when all setup items are complete
- **Setup items tracked**: Stripe Connect account active + Bonzah Insurance configured
- **Portal hook**: `use-setup-status.ts` — computes `progressPercent`, `allComplete`, `isTrialing`, `justWentLive` (completed within 24 hours)
- **Dashboard components**: `setup-hub.tsx` (countdown timer + progress bar during trial), `go-live-banner.tsx` (dismissible "You're Live!" banner after completion)
- **Bonzah balance monitoring**: `use-bonzah-balance.ts` polls `bonzah-get-balance` every 60s; `use-bonzah-alert-config.ts` manages low-balance thresholds via `reminder_config` table; creates reminders with warning/critical severity levels

## Dynamic Pricing

Weekend and holiday surcharge system for daily-tier bookings (<7 days):

- **Tenant settings**: `weekend_surcharge_percent` (numeric, 0 = disabled), `weekend_days` (JSONB array of JS day numbers, default `[6, 0]` for Sat/Sun) on `tenants` table
- **`tenant_holidays`** table: per-tenant holiday periods with `name`, `start_date`/`end_date`, `surcharge_percent`, `excluded_vehicle_ids` (UUID array), `recurs_annually`. RLS via `get_user_tenant_id()` / `is_super_admin()`
- **`vehicle_pricing_overrides`** table: per-vehicle overrides for weekend/holiday rules. `rule_type` (`weekend`/`holiday`), `override_type` (`fixed_price`/`custom_percent`/`excluded`). Unique on `(vehicle_id, rule_type, holiday_id)`
- Migration: `supabase/migrations/20260218120000_add_dynamic_pricing.sql`

## Policy Acceptances

Portal staff must accept tenant privacy policy and terms before accessing the dashboard:

- **`policy_acceptances`** table: tracks which `app_user_id` accepted which `policy_type` (`privacy_policy`/`terms_and_conditions`) at which `version`. Unique on `(app_user_id, policy_type, version)`
- **Tenant versioning**: `privacy_policy_version` and `terms_version` columns on `tenants`, plus `policies_accepted_at` on `tenants`
- **Gate component**: `src/components/policy/policy-acceptance-gate.tsx` — blocking dialog in portal dashboard layout
- **Edge function**: `check-policy-acceptance` (`verify_jwt = false`) — checks if user has accepted current versions
- Migration: `supabase/migrations/20260218100000_add_policy_acceptances.sql`

## Reserved Subdomains

These subdomains have dedicated Vercel deployments and should not be treated as tenant slugs:
`www`, `admin`, `portal`, `api`, `app`
