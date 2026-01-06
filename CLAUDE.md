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
- **Payments**: Stripe
- **Auth**: Supabase Auth with RBAC (head_admin, admin, ops, viewer)

## Multi-Tenancy Pattern

Tenant identification via subdomain: `{tenant}.portal.drive-247.com`

- Middleware (`apps/portal/src/middleware.ts`) extracts tenant slug from hostname and injects via `x-tenant-slug` header
- `TenantContext` (`apps/portal/src/contexts/TenantContext.tsx`) provides client-side tenant state
- Supabase RLS enforces data isolation per tenant
- Dev fallback: On localhost, defaults to `drive-247` tenant

## Key Patterns

### Supabase Client
```typescript
import { supabase } from "@/integrations/supabase/client";
// Types auto-generated in integrations/supabase/types.ts
```

### React Query Hooks
Custom hooks in `apps/portal/src/hooks/` wrap Supabase queries with React Query. Convention:
- Named `use-{entity}.ts` or `use-{entity}-{action}.ts`
- Query keys include `tenant?.id` for proper cache isolation: `["entity-name", tenant?.id, ...params]`
- Most hooks require tenant context via `useTenant()`

### Form Schemas
Zod schemas live in `client-schemas/` directories within each app, organized by feature (customers, rentals, vehicles, etc.).

### Edge Functions
Supabase Functions in `supabase/functions/` handle:
- Webhooks: Stripe, DocuSign, Veriff
- Notifications: AWS SES email, AWS SNS SMS
- Admin operations: user management, data cleanup
- Shared utilities in `supabase/functions/_shared/`

## Environment Variables

Required variables (see `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` (booking)
- `NEXT_PUBLIC_VERIFF_API_KEY` (booking)
- DocuSign credentials (portal)
- AWS SES credentials for emails
