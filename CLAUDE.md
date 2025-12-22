# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development (all apps)
npm run dev

# Development (specific app)
npm run dev:booking    # port 8080
npm run dev:portal     # port 3001
npm run dev:admin      # port 3003
npm run dev:web        # port 3002

# Build & Lint
npm run build
npm run lint
```

## Architecture Overview

This is a **Turborepo monorepo** for Drive247, a car rental platform with multi-tenant support.

### Apps

- **booking**: Customer-facing booking interface (Next.js 15)
- **portal**: Multi-tenant admin portal for rental operators (Next.js 16)
- **admin**: Super-admin dashboard (Next.js 15)
- **web**: Marketing/landing page (Next.js 15)
- **client**: Shared client library

### Packages

- **config**: Shared configuration
- **types**: Shared TypeScript types
- **ui**: Shared UI components

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

- Middleware extracts tenant slug from hostname and injects via `x-tenant-slug` header
- `TenantContext` provides client-side tenant state
- Supabase RLS enforces data isolation per tenant

## Key Patterns

### Supabase Client
```typescript
import { supabase } from "@/integrations/supabase/client";
// Types auto-generated in lib/supabase/types.ts
```

### Form Schemas
Zod schemas live in `client-schemas/` directories within each app, organized by feature (customers, rentals, etc.).

### Edge Functions
Supabase Functions in `supabase/functions/` handle webhooks (Stripe, DocuSign, Veriff), notifications, and admin operations.

## Environment Variables

Required variables (see `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` (booking)
- `NEXT_PUBLIC_VERIFF_API_KEY` (booking)
- DocuSign credentials (portal)
- AWS SES credentials for emails
