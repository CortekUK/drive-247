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

# Testing (within app directories)
cd apps/booking && npm run test        # run tests once
cd apps/booking && npm run test:watch  # watch mode
cd apps/portal && npm run test         # portal tests

# Supabase
npx supabase functions serve           # run edge functions locally
npx supabase db push                   # push migrations to remote

# After schema changes, regenerate types and copy to both apps:
npx supabase gen types typescript --project-id hviqoaokxvlancmftwuo > apps/portal/src/integrations/supabase/types.ts
cp apps/portal/src/integrations/supabase/types.ts apps/booking/src/integrations/supabase/types.ts
```

## Architecture Overview

This is a **Turborepo monorepo** for Drive247, a car rental platform with multi-tenant support.

### Apps

- **booking**: Customer-facing booking interface (Next.js 15, React 18)
- **portal**: Multi-tenant admin portal for rental operators (Next.js 16, React 18)
- **admin**: Super-admin dashboard (Next.js 16, React 19)
- **web**: Marketing/landing page (Next.js 16, React 19)

## Tech Stack

- **Framework**: Next.js 15-16, React 18-19, TypeScript
- **Database**: Supabase (PostgreSQL with RLS)
- **State**: Zustand (client state), React Query (server state)
- **Forms**: React Hook Form + Zod validation
- **Styling**: Tailwind CSS + Radix UI components
- **Payments**: Stripe (dual test/live mode per tenant)
- **Auth**: Supabase Auth with RBAC (head_admin, admin, ops, viewer)

## Multi-Tenancy Pattern

Tenant identification differs between apps:
- **Portal**: `{tenant}.portal.drive-247.com` — middleware extracts tenant slug and injects via `x-tenant-slug` header
- **Booking**: `{tenant}.drive-247.com` — subdomain extracted client-side in TenantContext

Both apps use:
- `TenantContext` provides client-side tenant state with real-time updates via Supabase subscriptions
- Supabase RLS enforces data isolation per tenant
- Dev: Set `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` in `.env.local` or access via subdomain (e.g., `test.localhost:3000`)

## Key Patterns

### Supabase Client
```typescript
import { supabase } from "@/integrations/supabase/client";
// Types auto-generated in integrations/supabase/types.ts
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
Zod schemas in `client-schemas/` directories, organized by feature (customers, rentals, vehicles, etc.).

### Edge Functions
Supabase Functions in `supabase/functions/` handle:
- Webhooks: Stripe (`stripe-webhook-test`, `stripe-webhook-live`), DocuSign, Veriff
- Notifications: AWS SES email, AWS SNS SMS
- Admin operations: user management, data cleanup
- Shared utilities in `supabase/functions/_shared/`

Webhooks that accept external calls need `verify_jwt = false` in `supabase/config.toml`.

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

## Environment Variables

Required variables (see `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `STRIPE_TEST_SECRET_KEY`, `STRIPE_LIVE_SECRET_KEY` (edge functions)
- `STRIPE_TEST_PUBLISHABLE_KEY`, `STRIPE_LIVE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_VERIFF_API_KEY` (booking)
- DocuSign credentials (portal)
- AWS SES credentials for emails

## Reserved Subdomains

These subdomains have dedicated Vercel deployments and should not be treated as tenant slugs:
`www`, `admin`, `portal`, `api`, `app`
