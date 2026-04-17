# Drive 247 V2 — Migration Guide

> Single source of truth for the V2 migration. Read this first if you're a developer or Claude Code working on this project.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Why Migration](#why-migration)
- [Tech Stack](#tech-stack)
- [Monorepo Structure](#monorepo-structure)
- [Local Development Setup](#local-development-setup)
- [Backend Architecture](#backend-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Shared Packages](#shared-packages)
- [Database (Drizzle)](#database-drizzle)
- [API Conventions](#api-conventions)
- [Auth System](#auth-system)
- [Multi-Tenancy](#multi-tenancy)
- [Migration Approach](#migration-approach)
- [Feature Tracker](#feature-tracker)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Rules](#rules)

---

## Project Overview

**Drive 247** is a B2B multi-tenant car rental platform in production. Multiple rental operators (tenants) each get their own branded booking site, admin portal, and customer portal.

| | V1 (current production) | V2 (this migration) |
|---|---|---|
| Frontend | Next.js + Supabase direct calls | Next.js (CSR only, no SSR) |
| Backend | None — 150+ Supabase edge functions | NestJS REST API |
| Database | Supabase (PostgreSQL + RLS) | PostgreSQL + Drizzle ORM |
| Auth | Supabase Auth | Custom JWT (Passport) |
| UI | Mixed, no system | shadcn/ui strictly |
| Jobs | None | BullMQ + Redis |

**Branch:** `drive2.0/migration` — all V2 work here. `main` is untouched.

**V2 code lives in:** `v2/` folder at project root.

**V1 reference:** The existing codebase outside `v2/` — use it for business logic, rules, and flows. The code structure is bad but the functionality is correct.

---

## Why Migration

- No backend server — all logic scattered across 150+ Supabase edge functions
- No API layer — frontend calls DB directly, zero request tracking or logging
- Massive code duplication across 4 separate apps
- No reusable component system, no shadcn, inconsistent UI
- Huge files (1000+ lines), no separation of concerns
- No structure — code was "vibed" without planning
- No observability — no request logs, no error tracking, no audit trail
- Vendor lock-in — deeply coupled to Supabase (auth, realtime, storage, functions)
- Goal: single source of truth, everything structured, no vibing

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Monorepo** | pnpm workspaces + Turborepo | turbo ^2 |
| **Frontend** | Next.js (CSR, no SSR) | 16.1.6 |
| **React** | React | 19.2.3 |
| **UI Components** | shadcn/ui (new-york style) + Radix UI | shadcn ^3.8.5 |
| **Styling** | Tailwind CSS | ^4 |
| **Icons** | Lucide React | ^0.577.0 |
| **Forms** | React Hook Form + Zod | RHF ^7.72.1, Zod ^4 |
| **Client State** | Zustand | ^5.0.12 |
| **Server State** | React Query | ^5.96.2 |
| **HTTP Client** | Axios | ^1.14.0 |
| **Toasts** | Sonner | ^2.0.7 |
| **Theming** | next-themes | ^0.4.6 |
| **Backend** | NestJS (Express) | ^11.1.18 |
| **ORM** | Drizzle ORM + drizzle-kit | ^0.45.2 |
| **Database** | PostgreSQL | 16-alpine (Docker) |
| **Auth** | Passport + JWT (@nestjs/jwt) | passport ^0.7, jwt ^11 |
| **Password** | bcrypt | ^6.0.0 |
| **Background Jobs** | BullMQ + Redis | bullmq ^5, redis 7-alpine |
| **Validation** | Zod (shared frontend + backend) | ^4.3.6 |
| **API Docs** | Scalar | TBD |
| **API Testing** | Postman | Manual |
| **Deployment** | AWS (future) | Local first |

---

## Monorepo Structure

```
v2/
├── apps/
│   ├── backend/                        # NestJS API
│   │   ├── src/
│   │   │   ├── main.ts                        # Bootstrap: dotenv, CORS, prefix, listen
│   │   │   ├── app.module.ts                  # Root module: imports, global guards, interceptors
│   │   │   ├── config/
│   │   │   │   └── env.config.ts              # Zod schema validating all env vars
│   │   │   ├── common/                        # Cross-cutting concerns
│   │   │   │   ├── context/                   # Tenant context (full user context with helpers)
│   │   │   │   ├── decorators/                # @Public(), @CurrentUser(), @Roles(), @RequireTenant()
│   │   │   │   ├── guards/                    # jwt-auth.guard, roles.guard, tenant.guard (+ .spec.ts files)
│   │   │   │   ├── interceptors/              # tenant.interceptor
│   │   │   │   ├── pipes/                     # zod-validation.pipe
│   │   │   │   └── utils/                     # password.util.ts (hashPassword, verifyPassword)
│   │   │   ├── database/
│   │   │   │   ├── db.ts                      # Drizzle instance (imports from @drive247/database)
│   │   │   │   ├── database.module.ts         # NestJS global module
│   │   │   │   ├── migrations/                # Generated SQL migrations
│   │   │   │   └── seeds/
│   │   │   ├── modules/                       # Feature modules
│   │   │   │   ├── auth/                      # login, refresh, logout, change-password, me
│   │   │   │   │   ├── dto/                   # login.dto.ts, change-password.dto.ts
│   │   │   │   │   └── strategies/            # jwt.strategy.ts
│   │   │   │   ├── users/                     # Full CRUD + activate/deactivate
│   │   │   │   │   └── dto/                   # create-user, update-user, update-role DTOs
│   │   │   │   ├── tenants/
│   │   │   │   ├── vehicles/
│   │   │   │   ├── bookings/
│   │   │   │   ├── customers/
│   │   │   │   ├── payments/
│   │   │   │   └── notifications/
│   │   │   ├── integrations/                  # Third-party services
│   │   │   │   ├── stripe/
│   │   │   │   ├── aws/
│   │   │   │   ├── twilio/
│   │   │   │   └── boldsign/
│   │   │   ├── webhooks/                      # Incoming webhooks
│   │   │   └── jobs/                          # BullMQ background jobs
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   │
│   └── frontend/                       # All frontend apps
│       ├── portal/                     # Tenant admin portal (Next.js) — port 3001
│       │   ├── src/
│       │   │   ├── app/
│       │   │   │   ├── layout.tsx
│       │   │   │   ├── globals.css
│       │   │   │   ├── (auth)/login/page.tsx
│       │   │   │   └── (dashboard)/           # Protected routes
│       │   │   ├── stores/                    # portal-auth-store.ts
│       │   │   ├── hooks/                     # React Query hooks
│       │   │   ├── lib/api.ts                 # API client wired to portal store
│       │   │   └── components/                # Portal-specific components
│       │   └── package.json
│       │
│       ├── admin/                      # Super-admin dashboard — port 3003 (future)
│       └── booking/                    # Customer booking site — port 3000 (future)
│
├── packages/
│   ├── database/                       # @drive247/database — Drizzle schema + drizzle-zod
│   │   ├── src/
│   │   │   ├── schema/                        # Drizzle table definitions (one file per table)
│   │   │   └── zod/                           # drizzle-zod generated schemas (one file per table)
│   │   └── package.json
│   │
│   ├── ui/                             # @drive247/ui — Shared shadcn components
│   │   ├── src/components/
│   │   ├── components.json
│   │   └── package.json
│   │
│   ├── api-client/                     # @drive247/api-client — Shared Axios factory
│   │   ├── src/
│   │   │   ├── client.ts                      # createApiClient() factory
│   │   │   ├── auth.api.ts                    # createAuthApi()
│   │   │   └── users.api.ts                   # createUsersApi()
│   │   └── package.json
│   │
│   ├── shared-types/                   # @drive247/shared-types — TS enums + constants + API types
│   │   └── package.json
│   │
│   └── validators/                     # @drive247/validators — Manual Zod schemas
│       └── package.json
│
├── infra/
│   └── local/
│       └── docker-compose.yml      # PostgreSQL 16 (:5434) + Redis 7 (:6379)
│
├── docs/
│   ├── MIGRATION_GUIDE.md          # THIS FILE
│   └── setup.md
│
├── turbo.json                      # Build orchestration
├── pnpm-workspace.yaml             # apps/backend, apps/frontend/*, packages/*
└── package.json                    # Root scripts: dev:portal, dev:backend, build, lint, test
```

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

### Steps

```bash
# 1. Start databases
cd v2/infra/local
docker-compose up -d
# PostgreSQL on localhost:5434, Redis on localhost:6379

# 2. Install dependencies
cd v2
pnpm install

# 3. Environment variables
# Create v2/apps/backend/.env.local (see Environment Variables section below)
# Create .env.local in apps that need it (apps/backend, apps/frontend/portal)

# 4. Run migrations
cd v2/apps/backend
pnpm db:migrate

# 5. Seed database (optional)
pnpm db:seed

# 6. Start dev servers
cd v2
pnpm dev:backend     # NestJS on http://localhost:4000
pnpm dev:portal      # Portal on http://localhost:3001
```

### Docker Compose Details

```yaml
postgres:  localhost:5434 → 5432  (env: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB)
redis:     localhost:6379
```

---

## Backend Architecture

### Request Lifecycle

```
HTTP Request
  → CORS check (main.ts — allows frontend URL + subdomains)
  → Global prefix: /api
  → cookie-parser
  → JwtAuthGuard (global — skipped if @Public())
  → RolesGuard (global — checks @Roles() metadata)
  → TenantGuard (global — checks @RequireTenant() metadata)
  → TenantInterceptor (global — sets AsyncLocalStorage tenant context)
  → Controller → Service → Drizzle → PostgreSQL
  → Response
```

### app.module.ts Pattern

```typescript
@Module({
  imports: [
    DatabaseModule,
    TenantContextModule,
    AuthModule,
    TenantsModule,
    VehiclesModule,
    BookingsModule,
    CustomersModule,
    PaymentsModule,
    NotificationsModule,
  ],
  providers: [
    // Global guards run in this order:
    { provide: APP_GUARD, useClass: JwtAuthGuard },      // 1. Verify JWT (skip if @Public())
    { provide: APP_GUARD, useClass: RolesGuard },         // 2. Check @Roles() metadata
    { provide: APP_GUARD, useClass: TenantGuard },        // 3. Check tenant access
    // Global interceptors:
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor }, // Set tenant context via AsyncLocalStorage
  ],
})
export class AppModule {}
```

### main.ts Pattern

```typescript
import { config } from 'dotenv';
config({ path: '.env.local' });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.config';

async function bootstrap() {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const frontendUrl = new URL(env.FRONTEND_URL);
      const requestUrl = new URL(origin);
      const isExact = origin === env.FRONTEND_URL;
      const isSubdomain =
        requestUrl.port === frontendUrl.port &&
        requestUrl.hostname.endsWith(`.${frontendUrl.hostname}`);
      if (isExact || isSubdomain) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  await app.listen(env.BACKEND_PORT);
}
bootstrap();
```

### Module File Pattern

Every feature module follows this exact structure:

```
modules/{feature}/
├── {feature}.module.ts         # NestJS @Module definition
├── {feature}.controller.ts     # REST endpoints (thin — delegates to service)
├── {feature}.service.ts        # Business logic
├── dto/                        # Zod-validated request shapes (import drizzle-zod shapes for single source of truth)
│   ├── create-{feature}.dto.ts
│   ├── update-{feature}.dto.ts
│   └── ...
└── strategies/                 # (auth module only) Passport strategies
    └── jwt.strategy.ts
```

### Key common/ Files

**guards/jwt-auth.guard.ts** — Extends Passport AuthGuard('jwt'), checks `@Public()` decorator to skip auth:
```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

**pipes/zod-validation.pipe.ts** — Generic Zod validation pipe:
```typescript
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
```

**decorators/require-tenant.decorator.ts** — Marks routes as tenant-scoped with configurable source:
```typescript
@RequireTenant()                           // resolve from user's tenantId (default)
@RequireTenant({ source: 'param' })        // resolve from :tenantId route param
@RequireTenant({ source: 'query' })        // resolve from ?tenantId= query param
@RequireTenant({ source: 'body' })         // resolve from body.tenantId
```

**interceptors/tenant.interceptor.ts** — Wraps every authenticated request in AsyncLocalStorage with tenant context. Public routes (no `req.user`) pass through untouched.

**utils/password.util.ts** — Extracted bcrypt wrappers. Never call bcrypt directly:
```typescript
import { hashPassword, verifyPassword } from '@/common/utils/password.util';
```

**config/env.config.ts** — Zod schema validating all env vars with defaults and human-readable errors:
```typescript
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BACKEND_PORT: z.coerce.number().default(4000),
  FRONTEND_PORT: z.coerce.number().default(8000),
  // Database
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_DB: z.string(),
  DATABASE_URL: z.string().url(),
  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  // URLs
  FRONTEND_URL: z.string().url(),
  // ... integration keys added as features are migrated
});
```

### Backend Conventions

These conventions were established during the auth implementation and ACRM review. Follow them for all future modules.

#### DTOs with drizzle-zod Shapes

Backend DTOs import field shapes from drizzle-zod for single source of truth — don't redefine email validation, string lengths, etc. Add `.refine()` for business rules only.

```typescript
// apps/backend/src/modules/users/dto/create-user.dto.ts
import { insertAppUserSchema } from '@drive247/database';
import { UserRole } from '@drive247/shared-types';

export const createUserDto = z.object({
  email: insertAppUserSchema.shape.email,        // reuse DB field validation
  name: insertAppUserSchema.shape.name,
  role: z.nativeEnum(UserRole),
  password: z.string().min(8),
  permissions: z.array(permissionSchema).optional(),
}).refine(
  (data) => data.role !== UserRole.MANAGER || (data.permissions?.length ?? 0) > 0,
  { message: 'Manager role requires at least one permission' },
);
```

#### ParseUUIDPipe on All :id Params

All UUID route parameters must be validated with `ParseUUIDPipe`:
```typescript
@Get(':id')
getById(@Param('id', ParseUUIDPipe) id: string) { ... }
```

#### Password Utility

Never call bcrypt directly. Use `common/utils/password.util.ts`:
```typescript
import { hashPassword, verifyPassword } from '@/common/utils/password.util';
const hash = await hashPassword(rawPassword);
const isValid = await verifyPassword(rawPassword, hash);
```

#### Constants — No Magic Numbers

All constants live in `@drive247/shared-types/constants`:
```typescript
import { BCRYPT_ROUNDS, REFRESH_COOKIE, ACCESS_TOKEN_EXPIRY_SECS } from '@drive247/shared-types';
```

#### TenantContextService

Stores full user context (not just tenant). Use helpers instead of manual checks:
```typescript
this.tenantContext.requireTenantId();                     // throws ForbiddenException if null
this.tenantContext.requireUserId();                       // throws UnauthorizedException if null
this.tenantContext.assertCanAccessTenant(targetTenantId); // super admin bypasses
this.tenantContext.isSuperAdmin();                        // boolean helper
```

#### Guards

- `JwtAuthGuard` — skips `@Public()` routes. 2 unit tests.
- `RolesGuard` — throws `ForbiddenException` (not just returns false). Super admins bypass. 5 unit tests.
- `TenantGuard` — only activates on `@RequireTenant()` decorated routes. Multi-source resolution. 12 unit tests.

#### @RequireTenant() Decorator

Routes that need tenant scoping must be explicitly decorated:
```typescript
@RequireTenant()                    // resolve tenantId from user context (default)
@RequireTenant({ source: 'param' }) // resolve from :tenantId route param
```

#### Test Files

`.spec.ts` files live alongside the implementation files they test:
```
guards/
├── jwt-auth.guard.ts
├── jwt-auth.guard.spec.ts
├── roles.guard.ts
├── roles.guard.spec.ts
├── tenant.guard.ts
└── tenant.guard.spec.ts
```

#### Cookie Security

- `sameSite: 'strict'` (not `'lax'`)
- No `domain` attribute — naturally tenant-isolated
- `setRefreshCookie()` extracted as private controller method to avoid duplication

#### Schema per Table

One file per table in `packages/database/src/schema/` and `packages/database/src/zod/`. Files named in kebab-case: `app-users.ts`, `manager-permissions.ts`, `refresh-tokens.ts`, `audit-logs.ts`.

#### Env Config

Zod validated with human-readable `.describe()` hints. Seed variables (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, etc.) read from env config — no hardcoded seed data.

---

## Frontend Architecture

> Full details in `docs/frontend-architecture.md`

### Multi-App + Shared Packages

V2 uses **separate Next.js apps** (not one mega-app) with shared packages to avoid duplication:

| App | Purpose | Port | V1 Equivalent |
|-----|---------|------|---------------|
| `apps/portal` | Tenant admin portal | 3001 | `apps/portal` |
| `apps/admin` | Super-admin dashboard | 3003 | `apps/admin` |
| `apps/booking` | Customer booking site | 3000 | `apps/booking` |

| Shared Package | Purpose |
|---------------|---------|
| `packages/ui` | shadcn components — add once, all apps import |
| `packages/api-client` | Axios factory + API functions — configurable per app |

Each app has its own stores, hooks, and routes. Shared UI and API logic live in packages.

### CSR Only

No server-side rendering. All pages are client-rendered.

### shadcn Strictly

- **Every UI component** must use shadcn/ui — buttons, inputs, selects, dialogs, tables, cards, everything
- Components live in `packages/ui` — add via CLI: `cd packages/ui && pnpm dlx shadcn@latest add button`
- Style: **new-york**, base color: **neutral**, icons: **lucide**
- Apps import: `import { Button } from '@drive247/ui'`
- App-specific composite components stay in `apps/{app}/src/components/`

### API Client

```typescript
// packages/api-client — configurable factory
const api = createApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  getAccessToken: () => usePortalAuthStore.getState().accessToken,
  setAccessToken: (t) => usePortalAuthStore.getState().setAccessToken(t),
  onAuthFailure: () => { /* redirect to login */ },
  getTenantSlug: () => { /* extract from subdomain */ },
});
```

### Hook Pattern

```typescript
// apps/portal/src/hooks/use-vehicles.ts
export const useVehicles = () => {
  const tenantSlug = useTenantSlug();
  return useQuery({
    queryKey: ['vehicles', tenantSlug],
    queryFn: () => vehiclesApi.getAll(),
    enabled: !!tenantSlug,
  });
};
```

### File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Component | `kebab-case.tsx` | `booking-card.tsx` |
| Hook | `use-{name}.ts` | `use-vehicles.ts` |
| Store | `{name}-store.ts` | `portal-auth-store.ts` |
| API file | `{resource}.api.ts` | `vehicles.api.ts` |
| Page | `page.tsx` (Next.js convention) | `(dashboard)/vehicles/page.tsx` |

### File Size Rule

Keep files under ~200 lines. If a file grows larger, split it into smaller focused files.

---

## Shared Packages

### `@drive247/database`

Drizzle schema + drizzle-zod generated Zod schemas. Both backend and frontend import from here.

```
packages/database/src/
├── schema/           # Drizzle pgTable definitions
├── zod/              # drizzle-zod auto-generated schemas
└── index.ts
```

Import: `import { appUsers } from '@drive247/database';`

### `@drive247/ui`

Shared shadcn component library. All apps import from here — no duplicated `components/ui/`.

```
packages/ui/src/
├── components/       # shadcn primitives (button, input, card, dialog, table, etc.)
└── lib/utils.ts      # cn() helper
```

Import: `import { Button, Card } from '@drive247/ui';`

### `@drive247/api-client`

Configurable Axios factory + typed API call functions. Each app creates its own instance wired to its own auth store.

```
packages/api-client/src/
├── client.ts         # createApiClient(config) factory
├── auth.api.ts       # createAuthApi(api) — login, refresh, logout, me, changePassword
└── users.api.ts      # createUsersApi(api) — list, getById, create, update, updateRole, etc.
```

Import: `import { createApiClient, createAuthApi, createUsersApi } from '@drive247/api-client';`

### `@drive247/shared-types`

Shared TypeScript enums, constants, and API request/response types.

```
packages/shared-types/src/
├── index.ts
├── enums.ts          # UserRole, PermissionAccessLevel, BookingStatus, etc.
├── constants.ts      # REFRESH_COOKIE, BCRYPT_ROUNDS, ACCESS_TOKEN_EXPIRY_SECS, etc.
├── auth.types.ts     # LoginResponse, RefreshResponse, MeResponse, etc.
└── users.types.ts    # CreateUserRequest, UpdateUserRequest, UserResponse, etc.
```

Import: `import { UserRole, BCRYPT_ROUNDS, LoginResponse } from '@drive247/shared-types';`

### `@drive247/validators`

Manual Zod schemas for API/form validation (NOT auto-generated from DB).

```
packages/validators/src/
├── index.ts
└── auth.ts           # loginSchema, createUserSchema, etc.
```

Import: `import { loginSchema } from '@drive247/validators';`

---

## Database (Drizzle)

### Config

```typescript
// apps/backend/drizzle.config.ts
export default defineConfig({
  out: './src/database/migrations',
  schema: '../../packages/database/src/schema/index.ts',  // shared package
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Schema definitions in `packages/database`, migrations output in `apps/backend`.

### Schema Organization

> **One file per table** — not grouped by domain. Each table gets its own file in kebab-case.

```
packages/database/src/schema/
├── index.ts                   # Barrel: export * from each schema file
├── enums.ts                   # pgEnum definitions
├── tenants.ts                 # tenants (minimal for auth, expands later)
├── app-users.ts               # app_users
├── manager-permissions.ts     # manager_permissions
├── refresh-tokens.ts          # refresh_tokens
├── audit-logs.ts              # audit_logs
├── customers.ts               # customers (future)
├── customer-users.ts          # customer_users (future)
├── vehicles.ts                # vehicles (future)
├── vehicle-categories.ts      # vehicle_categories (future)
├── bookings.ts                # bookings (future)
├── rentals.ts                 # rentals (future)
├── payments.ts                # payments (future)
└── ...                        # one file per table as features are migrated
```

### Commands

```bash
cd v2/apps/backend

pnpm db:generate    # Generate migration from schema changes (drizzle-kit generate)
pnpm db:migrate     # Run pending migrations (drizzle-kit migrate)
pnpm db:seed        # Seed database (tsx src/database/seeds/index.ts)
```

### Local DB Connection

```
Host: localhost
Port: 5434
User: ${POSTGRES_USER}      (from docker-compose env)
Password: ${POSTGRES_PASSWORD}
Database: ${POSTGRES_DB}
URL: postgresql://${USER}:${PASSWORD}@localhost:5434/${DB}
```

---

## API Conventions

### Base

```
http://localhost:4000/api
```

Global prefix `api` is set in `main.ts`.

### Headers

```
Authorization: Bearer <access_token>
x-tenant-slug: <tenant_slug>
Content-Type: application/json
```

### REST Endpoints

```
GET    /api/{resource}           # List (with pagination, filters)
GET    /api/{resource}/:id       # Get one
POST   /api/{resource}           # Create
PATCH  /api/{resource}/:id       # Update
DELETE /api/{resource}/:id       # Delete
```

### Success Response

```json
{
  "success": true,
  "data": { },
  "message": "Optional message",
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "details": [
      { "path": "email", "message": "Invalid email" }
    ]
  }
}
```

### Documentation

API docs via Scalar at `/api/docs` (to be configured).

---

## Auth System

### Two Separate Auth Flows (same as V1)

| Auth | Users | Table | Roles |
|------|-------|-------|-------|
| **Portal staff** | Tenant employees | `app_users` | head_admin, admin, manager, ops, viewer |
| **Customers** | Booking customers | `customer_users` → `customers` | — |

These are completely separate — different tables, different login endpoints, different JWT payloads.

### JWT Strategy

- Access token: short-lived (15m default)
- Refresh token: long-lived (7d default), stored in HTTP-only cookie
- Passport `jwt` strategy validates access token on every request
- `@Public()` decorator skips JWT guard for open routes

### RBAC

- `@Roles('head_admin', 'admin')` decorator on controllers/handlers
- `RolesGuard` reads metadata and checks `req.user.role`
- Manager role has granular per-tab permissions (same concept as V1 `manager_permissions`)

---

## Multi-Tenancy

### How It Works

1. Frontend identifies tenant by subdomain: `{slug}.localhost:8000`
2. Axios interceptor sends `x-tenant-slug` header on every API request
3. Backend middleware resolves slug → tenant record from DB
4. `TenantInterceptor` stores tenant in `AsyncLocalStorage` for the request
5. Services access tenant via `TenantContextService`
6. All DB queries are scoped to `tenant_id` — no Supabase RLS, enforced at application layer

### Dev Mode

Set `NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test` in frontend `.env.local` for local development without subdomains.

---

## Migration Approach

### Order: Backend First

For each feature:
1. **Drizzle schema** — define tables in `src/database/schema/`
2. **Generate & run migration** — `pnpm db:generate && pnpm db:migrate`
3. **Shared types/validators** — add enums to `shared-types`, Zod schemas to `validators`
4. **NestJS module** — controller + service + DTOs
5. **Test with Postman** — verify API works
6. **Frontend** — pages, components (shadcn), hooks (React Query), API calls (Axios)

### Reference V1

The V1 codebase (everything outside `v2/`) is the source of truth for:
- Business rules and logic
- Database relationships and data shapes
- Tenant-specific behaviors
- Integration flows (Stripe, BoldSign, Veriff, etc.)
- Edge function logic → becomes NestJS service methods

V1 code reference locations:
- **Database schema**: `supabase/migrations/` and `docs/DATABASE_SCHEMA.md`
- **Edge functions**: `supabase/functions/`
- **Portal hooks/logic**: `apps/portal/src/hooks/`
- **Booking flow**: `apps/booking/src/`
- **Tenant config**: `apps/booking/src/config/tenant-config.ts`

---

## Feature Tracker

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 0 | Project scaffolding | **Done** | Monorepo, configs, Docker |
| 1 | Core DB schema (auth tables) | **Done** | tenants, app_users, manager_permissions, refresh_tokens, audit_logs (one file per table) |
| 2 | Env config + DB connection | **Done** | env.config.ts, db.ts, database.module, seed script |
| 3 | Auth (portal staff) | **Done** | Login, JWT, refresh, RBAC guards, user CRUD, frontend login/dashboard/users/change-password |
| 4 | Auth (customers) | Not started | Separate login, registration |
| 5 | Tenant management | Not started | CRUD, settings, branding |
| 6 | Vehicle management | Not started | CRUD, availability, pricing, images |
| 7 | Customer management | Not started | CRUD, documents, gig driver |
| 8 | Booking flow | Not started | Search, reserve, checkout |
| 9 | Payments (Stripe) | Not started | Checkout, preauth, Connect, dual-mode |
| 10 | Rentals | Not started | Active, completed, extensions |
| 11 | E-signatures (BoldSign) | Not started | Agreement creation, signing, webhook |
| 12 | Notifications | Not started | Email (SES), SMS (SNS), WhatsApp (Twilio) |
| 13 | Lockbox | Not started | Key handover system |
| 14 | Verification (Veriff) | Not started | Identity verification |
| 15 | Insurance (Bonzah) | Not started | Premium calc, quotes, policies |
| 16 | Realtime chat | Not started | Customer-staff messaging |
| 17 | Rental reviews | Not started | Ratings, AI summaries |
| 18 | Subscriptions | Not started | Platform billing for tenants |
| 19 | Dynamic pricing | Not started | Weekend/holiday surcharges |
| 20 | Policy acceptances | Not started | Staff policy gates |
| 21 | Manager permissions | Not started | Granular tab-level access |
| 22 | Setup hub & go-live | Not started | Onboarding progress tracking |
| 23 | Admin dashboard | Not started | Super-admin panel |
| 24 | Public booking site | Not started | Fleet, about, contact, FAQ |
| 25 | Customer portal | Not started | Bookings, documents, chat |

---

## Environment Variables

### Backend (`apps/backend/.env.local`)

```env
# Server
NODE_ENV=development
BACKEND_PORT=4000
FRONTEND_PORT=8000

# Database
POSTGRES_USER=drive247
POSTGRES_PASSWORD=drive247
POSTGRES_DB=drive247
DATABASE_URL=postgresql://drive247:drive247@localhost:5434/drive247

# JWT
JWT_SECRET=<min-32-char-secret>
JWT_REFRESH_SECRET=<min-32-char-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# URLs
FRONTEND_URL=http://localhost:8000

# (Integration keys added as features are migrated)
# STRIPE_TEST_SECRET_KEY=
# STRIPE_LIVE_SECRET_KEY=
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_WHATSAPP_NUMBER=
# BOLDSIGN_TEST_API_KEY=
# BOLDSIGN_LIVE_API_KEY=
```

### Frontend (`apps/portal/.env.local` — same pattern for admin/booking)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test
```

---

## Deployment

**Current phase: Local development only.**

Future target: **AWS**

| Component | AWS Service |
|-----------|------------|
| Backend API | ECS or EC2 |
| Frontend | Vercel or S3 + CloudFront |
| Database | RDS PostgreSQL |
| Redis | ElastiCache |
| File storage | S3 |
| Email | SES |
| SMS | SNS |

Deployment details will be added when we reach that phase.

---

## Rules

1. **Developer is the boss** — Claude is an assistant. Don't make decisions, suggest and wait for approval.
2. **No vibing** — every piece of code is intentional, structured, reviewed.
3. **shadcn for everything** — no custom styled buttons/inputs/dialogs. Use shadcn CLI to add components.
4. **Single source of truth** — shared types in `shared-types`, shared validators in `validators`, one API.
5. **Backend first** — for each feature: schema → migration → module → API test → frontend.
6. **Reference V1 for logic** — business rules are correct in V1, code structure is not.
7. **Small files** — ~200 lines max per file. Split if larger.
8. **No duplication** — reusable components, shared hooks, centralized API client.
9. **Keep this doc updated** — every decision, feature, and convention gets recorded here.
10. **Local first** — everything runs locally before any cloud deployment.
11. **Feature-complete migrations** — don't half-migrate a feature. Finish schema + API + frontend before moving on.
12. **Test with Postman** — verify every API endpoint before building frontend for it.
13. **No hardcoded values** — every reusable value (magic numbers, strings, regex, arrays) goes in `constants.ts`. If it appears twice, it belongs in constants.
14. **Validation at the boundary** — all input validation in DTOs (with `.refine()` for business rules), not in service methods. Services assume validated input.
15. **DTOs use drizzle-zod shapes** — pull field shapes from `insertSchema.shape.*` instead of redefining `z.string().email()` etc. Single source of truth from DB schema to validation.
16. **Decorators over repeated code** — if a check repeats in every method (e.g. `requireSuperAdmin()`), make it a decorator + guard (`@SuperAdminOnly()`). Controllers should be thin.
17. **Every pattern from auth applies to all features** — `ParseUUIDPipe`, password util, constants, `TenantContextService` helpers, test files, audit logging. No exceptions.
