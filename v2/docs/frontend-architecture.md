# Frontend Architecture — Multi-App + Shared Packages

> Decision doc for how V2 frontend is structured. Read this to understand why we have multiple apps and shared packages.

---

## The Problem

V1 has 4 separate Next.js apps (booking, portal, admin, web) with:
- Duplicated shadcn components in each app (40+ components copied 4 times)
- Duplicated API client logic in each app
- Duplicated Supabase client in each app
- No shared UI library — every app has its own `components/ui/`

One single mega-app would avoid duplication but creates its own problems:
- A change in booking rebuilds admin
- Different apps need different middleware, configs, maybe different themes
- Stores, hooks, and lib folders become a mess of mixed concerns
- Single deployment — can't deploy portal without deploying booking

---

## The Decision: Multiple Apps + Shared Packages

```
apps/
  backend/           # NestJS API — port 4000
  frontend/          # All frontend apps
    portal/          # Tenant admin portal (Next.js) — port 3001
    admin/           # Super-admin dashboard (Next.js) — port 3003
    booking/         # Customer-facing booking site (Next.js) — port 3000

packages/
  database/          # Drizzle schema + drizzle-zod
  shared-types/      # TypeScript enums + types
  validators/        # Manual Zod schemas (forms, API validation)
  ui/                # Shared shadcn components + Tailwind config
  api-client/        # Shared Axios instance + interceptors + API functions
```

Backend and frontend are clearly separated. `apps/backend/` is the API. `apps/frontend/` contains all Next.js apps. Each frontend app is independent — its own build, deployment, stores, routes. Shared code lives in packages.

---

## Package Details

### `packages/ui` — Shared Component Library

All shadcn components live here. Every app imports from `@drive247/ui` instead of having its own `components/ui/`.

```
packages/ui/
  package.json
  components.json        # shadcn config: new-york, neutral, lucide
  tailwind.config.ts     # Shared Tailwind preset (colors, fonts, spacing)
  src/
    index.ts             # Barrel export
    lib/
      utils.ts           # cn() helper
    components/
      button.tsx         # shadcn button
      input.tsx          # shadcn input
      card.tsx           # shadcn card
      dialog.tsx         # shadcn dialog
      table.tsx          # shadcn table
      form.tsx           # shadcn form
      ...                # All shadcn primitives
```

**Adding a new component:**
```bash
cd packages/ui
pnpm dlx shadcn@latest add select
```

**Using in an app:**
```typescript
import { Button } from '@drive247/ui';
import { Card, CardHeader, CardContent } from '@drive247/ui';
```

**Dependencies:** radix-ui, class-variance-authority, clsx, tailwind-merge, lucide-react

**Each app** still has its own `components/` folder for app-specific composite components that aren't reusable across apps.

### `packages/api-client` — Shared HTTP Client

One configurable Axios factory. Each app creates its own instance wired to its own auth store.

```
packages/api-client/
  package.json
  src/
    index.ts
    client.ts            # createApiClient(config) — factory function
    auth.api.ts          # createAuthApi(api) — auth endpoints
    users.api.ts         # createUsersApi(api) — user management endpoints
    ...                  # More API modules added per feature
```

**Factory pattern:**
```typescript
// packages/api-client/src/client.ts
export function createApiClient(config: {
  baseURL: string;
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
  onAuthFailure: () => void;
  getTenantSlug?: () => string | null;
}): AxiosInstance
```

**Each app wires it up:**
```typescript
// apps/frontend/portal/src/lib/api.ts
import { createApiClient, createAuthApi } from '@drive247/api-client';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

const api = createApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL!,
  getAccessToken: () => usePortalAuthStore.getState().accessToken,
  setAccessToken: (t) => usePortalAuthStore.getState().setAccessToken(t),
  onAuthFailure: () => {
    usePortalAuthStore.getState().logout();
    window.location.href = '/login';
  },
  getTenantSlug: () => /* extract from subdomain or env */,
});

export const authApi = createAuthApi(api);
export default api;
```

**Why factory, not singleton:** Each app has different auth stores, different failure behavior (portal redirects to `/login`, booking redirects to `/?auth=login`), and potentially different headers.

**Dependencies:** axios

---

## App Details

### `apps/portal` — Tenant Admin Portal

The main app we're building first. Tenant staff manage vehicles, bookings, customers, etc.

```
apps/frontend/portal/
  package.json
  next.config.ts
  tsconfig.json
  src/
    app/
      layout.tsx                  # Root layout, providers
      globals.css                 # Tailwind imports
      (auth)/
        login/page.tsx            # Staff login
      (dashboard)/
        layout.tsx                # Auth guard, sidebar, header
        page.tsx                  # Dashboard home
        vehicles/page.tsx         # Vehicle management (future)
        bookings/page.tsx         # Booking management (future)
        customers/page.tsx        # Customer management (future)
        settings/page.tsx         # Tenant settings (future)
        ...
    stores/
      portal-auth-store.ts       # Staff auth state (Zustand)
    hooks/
      use-vehicles.ts            # React Query hooks (future)
      ...
    lib/
      api.ts                     # createApiClient wired to portal store
    components/
      sidebar.tsx                # Portal-specific sidebar
      ...                        # Portal-specific composite components
```

**Port:** 3001
**Tenant identification:** Subdomain — `{slug}.portal.localhost:3001`
**Auth:** Staff login via `app_users` table, roles, manager permissions

### `apps/admin` — Super Admin Dashboard

Built later. Super admins manage all tenants, subscriptions, plans.

```
apps/frontend/admin/
  src/
    stores/
      admin-auth-store.ts        # Super admin auth (is_super_admin check)
    lib/
      api.ts                     # createApiClient wired to admin store
```

**Port:** 3003
**Auth:** Super admin only (`is_super_admin = true`), primary super admin for admin management

### `apps/booking` — Customer Booking Site

Built later. Customers browse fleet, book vehicles, manage their portal.

```
apps/frontend/booking/
  src/
    stores/
      customer-auth-store.ts     # Customer auth (separate table: customer_users)
    lib/
      api.ts                     # createApiClient wired to customer store
```

**Port:** 3000
**Tenant identification:** Subdomain — `{slug}.localhost:3000`
**Auth:** Customer login via `customer_users` → `customers` tables (completely separate from staff auth)

---

## What Goes Where

| Thing | Location | Example |
|-------|----------|---------|
| shadcn button, input, dialog | `packages/ui` | `import { Button } from '@drive247/ui'` |
| Axios instance factory | `packages/api-client` | `import { createApiClient } from '@drive247/api-client'` |
| Auth API calls (login, logout) | `packages/api-client` | `import { createAuthApi } from '@drive247/api-client'` |
| Drizzle tables | `packages/database` | `import { appUsers } from '@drive247/database'` |
| UserRole enum | `packages/shared-types` | `import { UserRole } from '@drive247/shared-types'` |
| Login form Zod schema | `packages/validators` | `import { loginSchema } from '@drive247/validators'` |
| Portal auth store | `apps/frontend/portal/stores/` | App-specific, not shared |
| Portal sidebar component | `apps/frontend/portal/components/` | App-specific, not shared |
| Portal login page | `apps/frontend/portal/app/(auth)/` | App-specific, not shared |
| Portal React Query hooks | `apps/frontend/portal/hooks/` | App-specific, not shared |

**Rule of thumb:** If 2+ apps need it → package. If only 1 app needs it → stays in that app.

---

## Tailwind Configuration

Each app imports the shared Tailwind preset from `packages/ui`:

```typescript
// apps/frontend/portal/tailwind.config.ts
import baseConfig from '@drive247/ui/tailwind.config';

export default {
  presets: [baseConfig],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',  // Include shared components
  ],
};
```

This ensures consistent colors, fonts, and spacing across all apps while allowing app-specific overrides if needed.

---

## Dev Server Ports

| App | Port | Command |
|-----|------|---------|
| Backend (NestJS) | 4000 | `pnpm dev:backend` |
| Booking | 3000 | `pnpm dev:booking` |
| Portal | 3001 | `pnpm dev:portal` |
| Admin | 3003 | `pnpm dev:admin` |

Root `package.json` scripts:
```json
{
  "dev:backend": "pnpm --filter backend start:dev",
  "dev:portal": "pnpm --filter @drive247/portal dev",
  "dev:admin": "pnpm --filter @drive247/admin dev",
  "dev:booking": "pnpm --filter @drive247/booking dev"
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/backend"
  - "apps/frontend/*"
  - "packages/*"
```

---

## Build Order (Turborepo)

```
packages/shared-types  ─┐
packages/database      ─┤
packages/validators    ─┼── packages/ui ──┬── apps/portal
packages/api-client   ─┘                  ├── apps/admin
                                           ├── apps/booking
                                           └── apps/backend
```

Each app depends on packages. Turbo handles the build order via `dependsOn: ["^build"]`.

---

## Migration Path

1. **Now (auth feature):** Create `apps/frontend/portal`, `packages/ui`, `packages/api-client`. Delete `apps/web`.
2. **Later (admin feature):** Create `apps/admin`. Same packages, new app with admin-specific store.
3. **Later (booking feature):** Create `apps/booking`. Same packages, customer auth store, booking flow.

Each app is added only when we're ready to build it. No empty scaffolding.
