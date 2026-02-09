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

# After schema changes, regenerate types and copy to both apps:
npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
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
- RBAC roles: `head_admin`, `admin`, `ops`, `viewer`
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
- **Webhooks**: Stripe (`stripe-webhook-test`, `stripe-webhook-live`, `stripe-connect-webhook`), DocuSign, Veriff
- **Payments**: `create-checkout-session`, `create-preauth-checkout`, `capture-booking-payment`, `process-refund`, `schedule-refund`, installment handling
- **Stripe Connect**: `create-connected-account`, `get-connect-onboarding-link`, `sync-stripe-account`
- **Notifications**: `aws-ses-email`, `aws-sns-sms`, `send-booking-email`, 15+ `notify-*` functions
- **Verification**: `create-veriff-session`, `create-ai-verification-session`, `ai-document-ocr`, `ai-face-match`
- **Insurance**: `bonzah-calculate-premium`, `bonzah-create-quote`, `bonzah-confirm-payment`, `bonzah-download-pdf`, `bonzah-verify-credentials`, `bonzah-view-policy`
- **Admin**: `admin-create-user`, `admin-update-role`, `admin-deactivate-user`, `emergency-bootstrap`
- **RAG chatbot**: `chat`, `rag-init`, `rag-sync`
- **Shared utilities** in `supabase/functions/_shared/`: `cors.ts`, `stripe-client.ts`, `aws-config.ts`, `email-template-service.ts`, `openai.ts`, `bonzah-client.ts`, `resend-service.ts`, `document-loaders.ts`

5 functions have `verify_jwt = false` in `supabase/config.toml`: `docusign-webhook`, `veriff-webhook`, `customer-chat`, `validate-customer-invite`, `submit-customer-registration`. Stripe webhook functions handle their own signature verification. All other functions require JWT auth by default.

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
- `NEXT_PUBLIC_VERIFF_API_KEY` (booking)
- DocuSign credentials (portal)
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

## Database

Migrations in `supabase/migrations/` (naming: `YYYYMMDDHHMMSS_description.sql`). Full schema reference in `docs/DATABASE_SCHEMA.md` including RLS policies. Stripe Connect details in `docs/STRIPE_CONNECT_PRODUCTION.md` and `docs/STRIPE_CONNECT_TESTING.md`.

Key RLS helper functions: `get_user_tenant_id()`, `is_super_admin()`, `is_primary_super_admin()`. Super admins must have `tenant_id = NULL` in `app_users`.

## Reserved Subdomains

These subdomains have dedicated Vercel deployments and should not be treated as tenant slugs:
`www`, `admin`, `portal`, `api`, `app`
