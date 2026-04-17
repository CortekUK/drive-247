# Auth System — V2 Implementation Plan

> Covers the portal staff auth (tenant admin portal). Customer auth is a separate feature and will be planned separately.

---

## Table of Contents

- [V1 Reference Summary](#v1-reference-summary)
- [V2 Auth Overview](#v2-auth-overview)
- [Package Structure](#package-structure)
- [Database Schema (Drizzle)](#database-schema-drizzle)
- [Backend Implementation](#backend-implementation)
- [Frontend Implementation](#frontend-implementation)
- [API Endpoints](#api-endpoints)
- [File Map](#file-map)
- [Implementation Order](#implementation-order)

---

## V1 Reference Summary

What exists in V1 (source of truth for business logic):

**Auth flow:** Supabase Auth (`signInWithPassword`) → fetch `app_users` record → set Zustand state → route protection in dashboard layout.

**Tables:**
- `app_users` — staff accounts linked to `auth.users` via `auth_user_id`. Fields: email, name, role, tenant_id, is_super_admin, is_primary_super_admin, is_active, must_change_password, avatar_url.
- `manager_permissions` — per-tab access for manager role. Fields: app_user_id, tab_key, access_level (viewer/editor).

**Roles (5):** `head_admin`, `admin`, `manager`, `ops`, `viewer`

**Super admin:** `is_super_admin = true`, `tenant_id = NULL`. Bypasses tenant isolation. Gets treated as `head_admin` in frontend. Primary super admin (`is_primary_super_admin = true`) can manage other super admins.

**Key behaviors:**
- `must_change_password` flag forces password change on first login
- Deactivating a user (`is_active = false`) invalidates all sessions immediately
- Only `head_admin` can create/manage admins and managers
- `admin` can only manage `ops` and `viewer` roles
- Manager permissions are replaced (delete all + insert new) on role change
- Login audit logging (success/failure with details)
- OTP-based password reset (6-digit code, 15min expiry)
- Tenant extracted from subdomain → `x-tenant-slug` header

**V1 admin app:** Super admins only (`is_super_admin = true`). Primary super admin can manage other super admins. Separate Zustand store, same Supabase Auth.

---

## V2 Auth Overview

### What Changes from V1

| Aspect | V1 | V2 |
|--------|----|----|
| Auth provider | Supabase Auth (client SDK) | Custom JWT (NestJS + Passport) |
| Session storage | Supabase localStorage | Access token (memory) + Refresh token (httpOnly cookie) |
| Token refresh | Supabase auto-refresh | Custom `/auth/refresh` endpoint |
| Password hashing | Supabase internal | bcrypt (in NestJS) |
| User creation | Supabase Admin API + edge function | NestJS endpoint |
| Tenant isolation | Supabase RLS | Application-layer filtering (Drizzle queries) |
| Password reset | OTP via edge functions | OTP via NestJS (same flow) |
| Refresh token storage | N/A (Supabase handled) | bcrypt hashed in DB with userAgent, ipAddress, revokedAt |
| Schema location | Supabase migrations (SQL) | `packages/database` (Drizzle + drizzle-zod) |

### What Stays the Same

- Role hierarchy: head_admin > admin > manager > ops > viewer
- Super admin concept (tenant_id = NULL, bypasses tenant scoping)
- Primary super admin (can manage other super admins)
- Manager granular permissions (tab_key + access_level)
- `must_change_password` flag
- `is_active` flag with immediate session invalidation
- Audit logging for auth events
- Tenant extraction from subdomain → header

---

## Package Structure

### Why This Layout

Each package has one job. Database stuff in `database`, validation stuff in `validators`, types in `shared-types`. No mixing.

```
packages/
├── database/                  # Drizzle schema (one file per table) + drizzle-zod schemas
│   ├── src/
│   │   ├── schema/            # Drizzle table definitions (pgTable, pgEnum) — one file per table
│   │   │   ├── enums.ts
│   │   │   ├── tenants.ts
│   │   │   ├── app-users.ts
│   │   │   ├── manager-permissions.ts
│   │   │   ├── refresh-tokens.ts
│   │   │   ├── audit-logs.ts
│   │   │   └── index.ts
│   │   ├── zod/               # drizzle-zod auto-generated Zod schemas — one file per table
│   │   │   ├── app-users.ts
│   │   │   ├── manager-permissions.ts
│   │   │   ├── refresh-tokens.ts
│   │   │   ├── audit-logs.ts
│   │   │   └── index.ts
│   │   └── index.ts           # Barrel export
│   └── package.json           # depends on: drizzle-orm, drizzle-zod, pg, zod
│
├── shared-types/              # TS enums + constants + API request/response types
│   ├── src/
│   │   ├── enums.ts           # UserRole, PermissionAccessLevel, etc.
│   │   ├── constants.ts       # REFRESH_COOKIE, BCRYPT_ROUNDS, ACCESS_TOKEN_EXPIRY_SECS, etc.
│   │   ├── auth.types.ts      # LoginResponse, RefreshResponse, MeResponse, etc.
│   │   ├── users.types.ts     # CreateUserRequest, UpdateUserRequest, UserResponse, etc.
│   │   └── index.ts
│   └── package.json
│
├── validators/                # Manual Zod schemas for frontend form validation
│   ├── src/
│   │   ├── auth.ts            # loginSchema, changePasswordSchema (form/API validation)
│   │   └── index.ts
│   └── package.json           # depends on: zod
│
├── api-client/                # Axios factory + typed API functions
│   ├── src/
│   │   ├── client.ts          # createApiClient() factory with interceptors
│   │   ├── auth.api.ts        # createAuthApi() — login, refresh, logout, me, changePassword
│   │   ├── users.api.ts       # createUsersApi() — list, getById, create, update, updateRole, etc.
│   │   └── index.ts
│   └── package.json           # depends on: axios
│
└── ui/                        # shadcn components via CLI (new-york style)
    ├── src/
    │   ├── components/        # button, input, label, card, badge, separator, table, dialog,
    │   │                      # select, dropdown-menu, avatar, tabs, alert (all via shadcn CLI)
    │   └── lib/utils.ts       # cn() helper
    ├── components.json
    └── package.json
```

### How They Connect

```
packages/database        → Drizzle tables + drizzle-zod schemas (DB shape)
packages/validators      → Manual Zod schemas (API/form validation, business rules)
packages/shared-types    → Enums + TypeScript types (no runtime deps)

apps/backend imports:    database (for queries), validators (for DTO validation), shared-types
frontend apps import:    validators (for form validation), shared-types, database/zod (for types only)
```

### What Goes Where

| Need | Package | Example |
|------|---------|---------|
| Define a DB table | `database/schema` | `appUsers` pgTable (one file per table) |
| Auto-generate Zod from table | `database/zod` | `insertAppUserSchema` via drizzle-zod (one file per table) |
| Define login form validation | `validators` | `loginSchema` (manual, not from DB) |
| Share a role enum | `shared-types` | `UserRole` enum |
| Share a constant | `shared-types/constants` | `BCRYPT_ROUNDS`, `REFRESH_COOKIE` |
| Define API request/response types | `shared-types` | `LoginResponse` in `auth.types.ts` |
| Create user DTO validation | Backend DTOs | Import `insertAppUserSchema.shape.email` from drizzle-zod for single source of truth |
| Create Axios API client | `api-client` | `createApiClient()` factory + `createUsersApi()` |

---

## Database Schema (Drizzle)

> All Drizzle schema definitions live in `packages/database/src/schema/`.
> Backend imports schema for queries. Both apps import drizzle-zod schemas for types.

### File: `packages/database/src/schema/enums.ts`

```typescript
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'head_admin',
  'admin',
  'manager',
  'ops',
  'viewer',
]);

export const permissionAccessLevelEnum = pgEnum('permission_access_level', [
  'viewer',
  'editor',
]);
```

### File: `packages/database/src/schema/tenants.ts`

> Minimal tenant table for auth context. Full tenant schema expands when tenants feature is migrated.

```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  companyName: text('company_name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### Schema Organization: One File Per Table

> **ACRM pattern adopted**: Each table gets its own schema file and its own drizzle-zod file. No combined `users.ts` with 4 tables in it.

```
packages/database/src/schema/
├── enums.ts                  # pgEnum: userRoleEnum, permissionAccessLevelEnum
├── tenants.ts                # tenants table (minimal for auth)
├── app-users.ts              # appUsers table
├── manager-permissions.ts    # managerPermissions table
├── refresh-tokens.ts         # refreshTokens table
├── audit-logs.ts             # auditLogs table
└── index.ts                  # Barrel: export * from each file

packages/database/src/zod/
├── app-users.ts              # insertAppUserSchema, selectAppUserSchema
├── manager-permissions.ts    # insertManagerPermissionSchema, selectManagerPermissionSchema
├── refresh-tokens.ts         # insertRefreshTokenSchema, selectRefreshTokenSchema
├── audit-logs.ts             # insertAuditLogSchema, selectAuditLogSchema
└── index.ts                  # Barrel: export * from each file
```

See source code for the full table definitions — they match what was originally planned in this document. The table shapes and constraints are unchanged.

### Key Schema Decisions

1. **No `auth_user_id`** — V2 has no Supabase Auth. `app_users.id` IS the auth identity. Password stored as `passwordHash` directly.
2. **`refresh_tokens` with `revokedAt`** — instead of deleting tokens on logout/rotation, we set `revokedAt`. Keeps audit trail of all sessions. `userAgent` and `ipAddress` tracked for security visibility.
3. **`refresh_tokens` hashed with bcrypt** — more secure than SHA-256 if DB is compromised. Slower on compare but acceptable for refresh operations.
4. **`email + tenant_id` unique index** — same email can exist in different tenants (multi-tenant staff). Super admins have `tenant_id = NULL` so their email is globally unique.
5. **`auditLogs`** — same concept as V1. Stores auth events (login, logout, password change, user creation, role changes).
6. **Schema in `packages/database`** — shared package so drizzle-zod schemas are available to both backend (queries + DTO base) and frontend (type inference). Backend also has its own `database/` folder for db instance and NestJS module only.

---

## Backend Implementation

### 1. Shared Packages First

#### `packages/shared-types/src/enums.ts`

```typescript
export enum UserRole {
  HEAD_ADMIN = 'head_admin',
  ADMIN = 'admin',
  MANAGER = 'manager',
  OPS = 'ops',
  VIEWER = 'viewer',
}

export enum PermissionAccessLevel {
  VIEWER = 'viewer',
  EDITOR = 'editor',
}
```

#### `packages/validators/src/auth.ts`

> Manual Zod schemas for API/form validation. These are NOT auto-generated from DB — they define the API contract shape which is different from the DB row shape.

```typescript
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['head_admin', 'admin', 'manager', 'ops', 'viewer']),
  password: z.string().min(8),
  permissions: z.array(z.object({
    tabKey: z.string(),
    accessLevel: z.enum(['viewer', 'editor']),
  })).optional(),
});

export const updateRoleSchema = z.object({
  role: z.enum(['head_admin', 'admin', 'manager', 'ops', 'viewer']),
  permissions: z.array(z.object({
    tabKey: z.string(),
    accessLevel: z.enum(['viewer', 'editor']),
  })).optional(),
});
```

### 2. Config

#### `apps/backend/src/config/env.config.ts`

```typescript
import { z } from 'zod';

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BACKEND_PORT: z.coerce.number().default(4000),

  // Database
  DATABASE_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // URLs
  FRONTEND_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
```

### 3. Database Module (Backend-only)

> The backend still has its own `database/` folder — but only for the Drizzle DB instance and NestJS module. Schema definitions live in `packages/database`.

#### `apps/backend/src/database/db.ts`

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@drive247/database';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export type Database = typeof db;
```

#### `apps/backend/src/database/database.module.ts`

```typescript
import { Global, Module } from '@nestjs/common';
import { db } from './db';

export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [{ provide: DATABASE, useValue: db }],
  exports: [DATABASE],
})
export class DatabaseModule {}
```

#### `apps/backend/drizzle.config.ts` (updated)

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/database/migrations',
  schema: '../../packages/database/src/schema/index.ts',  // points to shared package
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### 4. Common (Guards, Decorators, Pipes, Context)

#### `apps/backend/src/common/decorators/public.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

#### `apps/backend/src/common/decorators/roles.decorator.ts`

```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@drive247/shared-types';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

#### `apps/backend/src/common/decorators/current-user.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
  isSuperAdmin: boolean;
  isPrimarySuperAdmin: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;
    return data ? user?.[data] : user;
  },
);
```

#### `apps/backend/src/common/guards/jwt-auth.guard.ts`

```typescript
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

#### `apps/backend/src/common/guards/roles.guard.ts`

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;
    if (!user) return false;

    // Super admins bypass role checks
    if (user.isSuperAdmin) return true;

    return requiredRoles.includes(user.role);
  }
}
```

#### `apps/backend/src/common/guards/tenant.guard.ts`

> **Updated**: Now reads `@RequireTenant()` metadata with configurable source (user/param/query/body). Only activates on routes decorated with `@RequireTenant()`. Multi-source tenant ID resolution. See source code for full implementation (12 unit tests in `tenant.guard.spec.ts`).

#### `apps/backend/src/common/decorators/require-tenant.decorator.ts`

```typescript
// Marks routes as tenant-scoped with configurable source
@RequireTenant()                           // default: resolve from user's tenantId
@RequireTenant({ source: 'param' })        // resolve from :tenantId route param
@RequireTenant({ source: 'query' })        // resolve from ?tenantId= query param
@RequireTenant({ source: 'body' })         // resolve from body.tenantId
```

#### `apps/backend/src/common/context/tenant-context.service.ts`

> **Updated**: Stores full user context — not just tenant info. Has helpers for common access patterns.

```typescript
// Key methods:
tenantContext.setContext({ userId, email, role, tenantId, isSuperAdmin, isPrimarySuperAdmin })
tenantContext.requireTenantId()    // throws ForbiddenException if null
tenantContext.requireUserId()     // throws UnauthorizedException if null
tenantContext.assertCanAccessTenant(targetTenantId)  // super admin bypasses, regular users must match
tenantContext.isSuperAdmin()      // boolean helper
```

#### `apps/backend/src/common/utils/password.util.ts`

```typescript
// Extracted password utilities — no direct bcrypt calls scattered around
import { BCRYPT_ROUNDS } from '@drive247/shared-types';

export async function hashPassword(password: string): Promise<string>;
export async function verifyPassword(password: string, hash: string): Promise<boolean>;
```

#### `apps/backend/src/common/context/tenant-context.module.ts`

```typescript
import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

@Global()
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantContextModule {}
```

#### `apps/backend/src/common/interceptors/tenant.interceptor.ts`

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextService } from '../context/tenant-context.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;

    if (!user) return next.handle();

    const tenantSlug = req.headers?.['x-tenant-slug'] as string | undefined;
    if (!tenantSlug && !user.isSuperAdmin) return next.handle();

    return new Observable((subscriber) => {
      this.tenantContext.run(
        { tenantId: user.tenantId ?? '', tenantSlug: tenantSlug ?? '' },
        () => {
          next.handle().subscribe(subscriber);
        },
      );
    });
  }
}
```

#### `apps/backend/src/common/pipes/zod-validation.pipe.ts`

```typescript
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

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

### 5. Auth Module

> All auth module code is implemented. See source files for latest implementation. Key patterns:

#### `apps/backend/src/modules/auth/strategies/jwt.strategy.ts`

Validates JWT, checks `is_active` in DB (not just token validity), populates `req.user`. See source code.

#### `apps/backend/src/modules/auth/auth.service.ts`

Key implementation details:
- Uses `hashPassword()` / `verifyPassword()` from `common/utils/password.util.ts` (not direct bcrypt calls)
- Uses constants from `@drive247/shared-types` (`BCRYPT_ROUNDS`, `ACCESS_TOKEN_EXPIRY_SECS`, `REFRESH_COOKIE`, etc.)
- JWT refresh tokens: signed with separate `JWT_REFRESH_SECRET`, verified before DB lookup. bcrypt hash stored in DB for revocation
- `setRefreshCookie()` private method: cookie logic extracted to avoid duplication across login/refresh endpoints
- Cookie security: `sameSite: 'strict'` (not `'lax'`), no domain attribute (tenant-isolated cookies)

See source code for full implementation.

#### `apps/backend/src/modules/auth/dto/`

DTOs import drizzle-zod shapes for single source of truth:
```typescript
// login.dto.ts — uses drizzle-zod shape for email validation
import { insertAppUserSchema } from '@drive247/database';

export const loginDto = z.object({
  email: insertAppUserSchema.shape.email,
  password: z.string().min(8),
});

// change-password.dto.ts
export const changePasswordDto = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});
```

#### `apps/backend/src/modules/auth/auth.controller.ts` and `auth.module.ts`

See source code. Pattern matches the original plan with these refinements:
- Uses DTO classes with drizzle-zod shapes
- `setRefreshCookie()` extracted as private method
- `sameSite: 'strict'` on cookies

### 6. Users Module (Admin User Management)

> Fully implemented with full CRUD. See source code.

#### `apps/backend/src/modules/users/users.service.ts`

Handles:
- **List users** — scoped to tenant, includes permissions for managers
- **Get user by ID** — with permissions
- **Create user** — with role + optional manager permissions. Uses `hashPassword()` util
- **Update user profile** — name, email (via `update-user.dto.ts`)
- **Update user role** — with permission replacement for managers (via `update-role.dto.ts`)
- **Deactivate user** — calls `authService.revokeAllSessions()` on deactivate
- **Activate user** — re-enables account
- **Delete user** — hard delete

Authorization rules (same as V1):
- `head_admin` can manage all roles
- `admin` can manage `ops` and `viewer` only
- Cannot change own role
- Cannot deactivate self

#### `apps/backend/src/modules/users/users.controller.ts`

All `:id` route params validated with `ParseUUIDPipe`. Endpoints defined in API Endpoints section below.

#### `apps/backend/src/modules/users/dto/`

```
dto/
├── create-user.dto.ts    # Uses drizzle-zod shapes + .refine() for manager permissions business rule
├── update-user.dto.ts    # Partial update (name, email)
└── update-role.dto.ts    # Role change + optional permissions
```

DTOs import from drizzle-zod for single source of truth:
```typescript
import { insertAppUserSchema } from '@drive247/database';

export const createUserDto = z.object({
  email: insertAppUserSchema.shape.email,
  name: insertAppUserSchema.shape.name,
  role: z.nativeEnum(UserRole),
  password: z.string().min(8),
  permissions: z.array(...).optional(),
}).refine(
  (data) => data.role !== UserRole.MANAGER || (data.permissions && data.permissions.length > 0),
  { message: 'Manager role requires at least one permission' },
);
```

#### `apps/backend/src/modules/users/users.module.ts`

Imports AuthModule for `revokeAllSessions()` on deactivate.

### 7. Wire Up

#### `apps/backend/src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { TenantContextModule } from './common/context/tenant-context.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';

@Module({
  imports: [
    DatabaseModule,
    TenantContextModule,
    AuthModule,
    UsersModule,
  ],
  providers: [
    // Global guards run in this order:
    { provide: APP_GUARD, useClass: JwtAuthGuard },       // 1. Verify JWT (skip if @Public())
    { provide: APP_GUARD, useClass: RolesGuard },          // 2. Check @Roles() metadata
    { provide: APP_GUARD, useClass: TenantGuard },         // 3. Check tenant access
    // Global interceptors:
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor }, // Set tenant context via AsyncLocalStorage
  ],
})
export class AppModule {}
```

#### `apps/backend/src/main.ts`

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

---

## Frontend Implementation

> Basic UI for testing auth flow. Production UI will come later.
> Frontend uses multi-app architecture — see `docs/frontend-architecture.md` for full details.

### Shared API Client (`packages/api-client`)

> The Axios instance, interceptors, and API call functions live in a shared package. Each app imports and configures it with its own auth store.

#### `packages/api-client/src/client.ts`

```typescript
import axios, { AxiosInstance } from 'axios';

interface ApiClientConfig {
  baseURL: string;
  getAccessToken: () => string | null;
  setAccessToken: (token: string) => void;
  onAuthFailure: () => void;
  getTenantSlug?: () => string | null;
}

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const api = axios.create({
    baseURL: config.baseURL,
    withCredentials: true,
  });

  // Request: attach access token + tenant slug
  api.interceptors.request.use((reqConfig) => {
    const token = config.getAccessToken();
    if (token) {
      reqConfig.headers.Authorization = `Bearer ${token}`;
    }
    const slug = config.getTenantSlug?.();
    if (slug) {
      reqConfig.headers['x-tenant-slug'] = slug;
    }
    return reqConfig;
  });

  // Response: auto-refresh on 401
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const original = error.config;
      if (error.response?.status === 401 && !original._retry) {
        original._retry = true;
        try {
          const { data } = await axios.post(
            `${config.baseURL}/auth/refresh`,
            {},
            { withCredentials: true },
          );
          config.setAccessToken(data.data.accessToken);
          original.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return api(original);
        } catch {
          config.onAuthFailure();
        }
      }
      return Promise.reject(error);
    },
  );

  return api;
}
```

#### `packages/api-client/src/auth.api.ts`

```typescript
import { AxiosInstance } from 'axios';

export function createAuthApi(api: AxiosInstance) {
  return {
    login: (email: string, password: string) =>
      api.post('/auth/login', { email, password }),

    refresh: () =>
      api.post('/auth/refresh'),

    logout: () =>
      api.post('/auth/logout'),

    me: () =>
      api.get('/auth/me'),

    changePassword: (currentPassword: string, newPassword: string) =>
      api.post('/auth/change-password', { currentPassword, newPassword }),
  };
}
```

### Portal App (`apps/portal`)

> Each app creates its own API client instance wired to its own auth store.

#### `apps/frontend/portal/src/lib/api.ts`

```typescript
import { createApiClient, createAuthApi } from '@drive247/api-client';
import { usePortalAuthStore } from '@/stores/portal-auth-store';

const api = createApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL!,
  getAccessToken: () => usePortalAuthStore.getState().accessToken,
  setAccessToken: (token) => usePortalAuthStore.getState().setAccessToken(token),
  onAuthFailure: () => {
    usePortalAuthStore.getState().logout();
    window.location.href = '/login';
  },
  getTenantSlug: () => {
    // From subdomain or env fallback
    if (typeof window !== 'undefined') {
      const parts = window.location.hostname.split('.');
      if (parts.length > 1) return parts[0];
    }
    return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG ?? null;
  },
});

export const authApi = createAuthApi(api);
export default api;
```

#### `apps/frontend/portal/src/stores/portal-auth-store.ts`

```typescript
import { create } from 'zustand';

interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isSuperAdmin: boolean;
  isPrimarySuperAdmin: boolean;
  mustChangePassword: boolean;
  avatarUrl: string | null;
}

interface PortalAuthState {
  accessToken: string | null;
  user: AppUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setAuth: (token: string, user: AppUser) => void;
  setAccessToken: (token: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const usePortalAuthStore = create<PortalAuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (token, user) =>
    set({ accessToken: token, user, isAuthenticated: true, isLoading: false }),

  setAccessToken: (token) =>
    set({ accessToken: token }),

  logout: () =>
    set({ accessToken: null, user: null, isAuthenticated: false, isLoading: false }),

  setLoading: (loading) =>
    set({ isLoading: loading }),
}));
```

### Basic Test Pages (Portal)

#### Login page (`apps/frontend/portal/src/app/(auth)/login/page.tsx`)

Basic shadcn form (from `@drive247/ui`): email + password inputs, login button. On success → store token + user → redirect to dashboard.

#### Dashboard layout (`apps/frontend/portal/src/app/(dashboard)/layout.tsx`)

Auth guard: if not authenticated → redirect to `/login`. Show user info + logout button.

#### Dashboard page (`apps/frontend/portal/src/app/(dashboard)/page.tsx`)

Simple page showing: "Welcome {user.name}" + role + tenant info. Proves auth works end-to-end.

---

## API Endpoints

### Auth Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | Public | Login with email + password |
| `POST` | `/api/auth/refresh` | Public | Refresh access token (uses httpOnly cookie) |
| `POST` | `/api/auth/logout` | Protected | Logout, revoke refresh token |
| `POST` | `/api/auth/change-password` | Protected | Change password |
| `GET` | `/api/auth/me` | Protected | Get current user profile |

### User Management Endpoints

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `GET` | `/api/users` | Protected | head_admin, admin | List tenant users |
| `GET` | `/api/users/:id` | Protected | head_admin, admin | Get user by ID (`:id` validated with ParseUUIDPipe) |
| `POST` | `/api/users` | Protected | head_admin, admin | Create user |
| `PATCH` | `/api/users/:id` | Protected | head_admin, admin | Update user profile (name, email) |
| `PATCH` | `/api/users/:id/role` | Protected | head_admin | Update user role + permissions |
| `PATCH` | `/api/users/:id/deactivate` | Protected | head_admin | Deactivate user (revokes all sessions) |
| `PATCH` | `/api/users/:id/activate` | Protected | head_admin | Activate user |
| `DELETE` | `/api/users/:id` | Protected | head_admin | Delete user |

### Request/Response Examples

**POST /api/auth/login**
```json
// Request
{ "email": "admin@test.com", "password": "password123" }
// Headers: x-tenant-slug: test (or omit for super admin login)

// Response
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "user": {
      "id": "uuid",
      "email": "admin@test.com",
      "name": "Test Admin",
      "role": "head_admin",
      "isSuperAdmin": false,
      "isPrimarySuperAdmin": false,
      "mustChangePassword": false,
      "avatarUrl": null
    }
  }
}
// + Set-Cookie: refresh_token=<token>; HttpOnly; Path=/api/auth
```

**POST /api/users**
```json
// Request (head_admin creating a manager)
{
  "email": "manager@test.com",
  "name": "New Manager",
  "role": "manager",
  "password": "tempPass123",
  "permissions": [
    { "tabKey": "vehicles", "accessLevel": "editor" },
    { "tabKey": "rentals", "accessLevel": "viewer" }
  ]
}

// Response
{
  "success": true,
  "data": { "id": "uuid", "email": "manager@test.com", "role": "manager" },
  "message": "User created"
}
```

---

## File Map

Complete list of files created/modified for auth feature:

```
packages/database/
  package.json
  src/
    index.ts                              # Barrel: export schema + zod
    schema/
      index.ts                            # Barrel: export all schema files
      enums.ts                            # pgEnum: userRoleEnum, permissionAccessLevelEnum
      tenants.ts                          # tenants table (minimal for auth)
      app-users.ts                        # appUsers table (one file per table)
      manager-permissions.ts              # managerPermissions table
      refresh-tokens.ts                   # refreshTokens table
      audit-logs.ts                       # auditLogs table
    zod/
      index.ts                            # Barrel: export all zod files
      app-users.ts                        # insert/select schemas for app_users
      manager-permissions.ts              # insert/select schemas for manager_permissions
      refresh-tokens.ts                   # insert/select schemas for refresh_tokens
      audit-logs.ts                       # insert/select schemas for audit_logs

packages/shared-types/src/
  enums.ts                                # UserRole, PermissionAccessLevel TS enums
  constants.ts                            # REFRESH_COOKIE, BCRYPT_ROUNDS, ACCESS_TOKEN_EXPIRY_SECS, etc.
  auth.types.ts                           # LoginResponse, RefreshResponse, MeResponse, etc.
  users.types.ts                          # CreateUserRequest, UpdateUserRequest, UserResponse, etc.
  index.ts                                # Barrel

packages/validators/src/
  auth.ts                                 # loginSchema, changePasswordSchema (frontend form validation)
  index.ts                                # Barrel

packages/api-client/
  package.json
  src/
    index.ts                              # Barrel export
    client.ts                             # createApiClient() factory (configurable interceptors)
    auth.api.ts                           # createAuthApi() — login, refresh, logout, me, changePassword
    users.api.ts                          # createUsersApi() — list, getById, create, update, updateRole, etc.

packages/ui/
  package.json
  components.json                         # shadcn config (new-york style)
  src/
    index.ts                              # Barrel export
    components/                           # button, input, label, card, badge, separator, table, dialog,
                                          # select, dropdown-menu, avatar, tabs, alert (all via shadcn CLI)
    lib/
      utils.ts                            # cn() helper

apps/backend/
  nest-cli.json                           # NestJS CLI config
  drizzle.config.ts                       # schema path → packages/database
  src/
    config/
      env.config.ts                       # Zod env validation with human-readable errors + hints

    database/
      db.ts                               # Drizzle instance (imports schema from @drive247/database)
      database.module.ts                  # NestJS global module
      seeds/
        index.ts                          # Seed script (reads SEED_* vars from env)

    common/
      decorators/
        public.decorator.ts               # @Public()
        roles.decorator.ts                # @Roles()
        current-user.decorator.ts         # @CurrentUser()
        require-tenant.decorator.ts       # @RequireTenant() with configurable source
      guards/
        jwt-auth.guard.ts                 # JWT guard (skips @Public)
        jwt-auth.guard.spec.ts            # 2 unit tests
        roles.guard.ts                    # Role-based guard (throws ForbiddenException)
        roles.guard.spec.ts               # 5 unit tests
        tenant.guard.ts                   # Tenant context guard (reads @RequireTenant metadata)
        tenant.guard.spec.ts              # 12 unit tests
      interceptors/
        tenant.interceptor.ts             # AsyncLocalStorage tenant context
      context/
        tenant-context.module.ts          # Global module
        tenant-context.service.ts         # Full user context with helpers (requireTenantId, assertCanAccessTenant, etc.)
      pipes/
        zod-validation.pipe.ts            # Zod validation pipe
      utils/
        password.util.ts                  # hashPassword() + verifyPassword() wrappers

    modules/
      auth/
        auth.module.ts
        auth.controller.ts
        auth.service.ts
        dto/
          login.dto.ts                    # Uses drizzle-zod shape for email
          change-password.dto.ts
        strategies/
          jwt.strategy.ts
      users/
        users.module.ts
        users.controller.ts               # All :id params use ParseUUIDPipe
        users.service.ts                  # Full CRUD + activate/deactivate
        dto/
          create-user.dto.ts              # drizzle-zod shapes + .refine() for manager permissions
          update-user.dto.ts              # Partial profile update (name, email)
          update-role.dto.ts              # Role change + optional permissions

    app.module.ts                         # Imports, global guards, interceptor
    main.ts                               # dotenv, CORS, cookie-parser, prefix

apps/frontend/portal/
  package.json
  next.config.ts
  tsconfig.json
  src/
    lib/
      api.ts                              # createApiClient() wired to portal auth store
    stores/
      portal-auth-store.ts               # Zustand: accessToken, user, isAuthenticated
    app/
      layout.tsx                          # Root layout
      globals.css                         # Tailwind
      (auth)/
        login/
          page.tsx                        # Login form (shadcn from @drive247/ui)
      (dashboard)/
        layout.tsx                        # Auth guard + basic shell
        page.tsx                          # Dashboard placeholder
        users/
          page.tsx                        # User management page
        change-password/
          page.tsx                        # Change password page
```

---

## Implementation Order

Step-by-step sequence. Each step depends on the previous.

### Step 1: Create `packages/database` --- DONE
- [x] Create `package.json` with drizzle-orm, drizzle-zod, pg, zod
- [x] Define schema: `enums.ts`, `tenants.ts`, `app-users.ts`, `manager-permissions.ts`, `refresh-tokens.ts`, `audit-logs.ts` (one file per table)
- [x] Create barrel exports: `schema/index.ts`, `src/index.ts`
- [x] Create drizzle-zod schemas: `zod/app-users.ts`, `zod/manager-permissions.ts`, `zod/refresh-tokens.ts`, `zod/audit-logs.ts`, `zod/index.ts`
- [x] Run `pnpm install` to link workspace package

### Step 2: Create `packages/api-client` + `packages/ui` --- DONE
- [x] Create `packages/api-client/package.json` with axios
- [x] Implement `client.ts` (createApiClient factory)
- [x] Implement `auth.api.ts` (createAuthApi)
- [x] Implement `users.api.ts` (createUsersApi)
- [x] Create `packages/ui` with shadcn monorepo setup (new-york style)
- [x] Add shadcn components: button, input, label, card, badge, separator, table, dialog, select, dropdown-menu, avatar, tabs, alert

### Step 3: Update `packages/shared-types` + `packages/validators` --- DONE
- [x] Add TS enums to `shared-types/src/enums.ts`
- [x] Add constants to `shared-types/src/constants.ts` (REFRESH_COOKIE, BCRYPT_ROUNDS, ACCESS_TOKEN_EXPIRY_SECS, etc.)
- [x] Add API types: `shared-types/src/auth.types.ts`, `shared-types/src/users.types.ts`
- [x] Add auth validators to `validators/src/auth.ts`
- [x] Update barrel exports

### Step 4: Backend Config & Database Connection --- DONE
- [x] Implement `env.config.ts` with Zod validation (human-readable errors + hints, seed vars from env)
- [x] Implement `db.ts` (imports schema from `@drive247/database`)
- [x] Implement `database.module.ts` (NestJS global module)
- [x] Update `drizzle.config.ts` to point schema at `packages/database`
- [x] Generate migration: `pnpm db:generate`
- [x] Run migration: `pnpm db:migrate`

### Step 5: Backend Common --- DONE
- [x] `public.decorator.ts`
- [x] `roles.decorator.ts`
- [x] `current-user.decorator.ts`
- [x] `require-tenant.decorator.ts` (configurable source: user/param/query/body)
- [x] `jwt-auth.guard.ts` + `jwt-auth.guard.spec.ts` (2 tests)
- [x] `roles.guard.ts` + `roles.guard.spec.ts` (5 tests) — throws ForbiddenException
- [x] `tenant.guard.ts` + `tenant.guard.spec.ts` (12 tests) — reads @RequireTenant metadata
- [x] `tenant-context.service.ts` (full user context with helpers)
- [x] `tenant-context.module.ts`
- [x] `tenant.interceptor.ts`
- [x] `zod-validation.pipe.ts`
- [x] `password.util.ts` (hashPassword + verifyPassword wrappers)

### Step 6: Auth Module --- DONE
- [x] `jwt.strategy.ts`
- [x] `auth.service.ts` (login, refresh, logout, revokeAllSessions, change-password, get-profile)
- [x] `auth.controller.ts` (endpoints + cookie handling + setRefreshCookie private method)
- [x] `auth.module.ts`
- [x] `dto/login.dto.ts` (uses drizzle-zod shape)
- [x] `dto/change-password.dto.ts`

### Step 7: Users Module --- DONE
- [x] `users.service.ts` (full CRUD: list, getById, create, update, updateRole, deactivate, activate, delete)
- [x] `users.controller.ts` (all :id params use ParseUUIDPipe)
- [x] `users.module.ts`
- [x] `dto/create-user.dto.ts` (drizzle-zod shapes + .refine() for manager permissions)
- [x] `dto/update-user.dto.ts` (partial profile update)
- [x] `dto/update-role.dto.ts`

### Step 8: Wire Up app.module.ts + main.ts --- DONE
- [x] Update `app.module.ts`: imports, global guards, interceptor
- [x] Update `main.ts`: dotenv, CORS, cookie-parser, global prefix

### Step 9: Seed Data --- DONE
- [x] Create seed script: reads SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, etc. from env
- [x] Run seed: `pnpm db:seed`

### Step 10: Test with Postman --- DONE
- [x] Login → get access token
- [x] Use access token on protected endpoints
- [x] Test refresh flow (check revokedAt gets set on old token)
- [x] Test role-based access
- [x] Test user creation + manager permissions
- [x] Test deactivation (verify all sessions revoked)
- [x] Test change password

### Step 11: Create `apps/frontend/portal` + Frontend Test UI --- DONE
- [x] Scaffold `apps/frontend/portal` (Next.js, import @drive247/ui, @drive247/api-client)
- [x] Wire API client to portal auth store
- [x] Portal auth store (Zustand)
- [x] Login page (shadcn form from @drive247/ui)
- [x] Dashboard layout (auth guard)
- [x] Dashboard page (show user info)
- [x] Users management page
- [x] Change password page
- [x] Remove `apps/web` (replaced by `apps/frontend/portal` + future `apps/frontend/admin`, `apps/frontend/booking`)

---

## Notes

- **OTP password reset** is deferred — will be added when the notifications module (email sending) is migrated. For now, change-password (with current password) is sufficient.
- **Audit log details** field stores JSON as text. Could be changed to JSONB column later if we need to query it.
- **Tenant resolution** from slug → ID is a temporary helper in auth controller. Will move to tenants module when that feature is migrated.
- **Manager permission tab keys** will be defined as constants in `shared-types` when portal UI is built. For now the schema accepts any string.
- **bcrypt for refresh tokens** means refresh/logout need to iterate tokens for comparison. Acceptable for now — a user won't have more than a few active sessions. If it becomes a bottleneck, we can add a token fingerprint column for fast lookup + bcrypt verify.
- **Migrations still live in backend** (`apps/backend/src/database/migrations/`) — only schema definitions moved to `packages/database`. `drizzle.config.ts` in backend points to the shared schema but outputs migrations locally.

---

## Patterns Adopted from ACRM Review

During implementation, we compared against the ACRM reference codebase and adopted the following patterns:

### 1. Schema per Table
One Drizzle schema file per table (not one combined file with multiple tables). Same for drizzle-zod files. Files named in kebab-case matching the table: `app-users.ts`, `manager-permissions.ts`, `refresh-tokens.ts`, `audit-logs.ts`.

### 2. DTOs with drizzle-zod Shapes
Backend DTOs import individual field shapes from drizzle-zod for single source of truth, rather than defining validation from scratch. Example: `insertAppUserSchema.shape.email`. Business rules added via `.refine()` (e.g., manager role requires at least one permission).

### 3. ParseUUIDPipe on All :id Params
All UUID route parameters validated with NestJS built-in `ParseUUIDPipe` — no manual UUID validation in services.

### 4. Password Utility Wrapper
`common/utils/password.util.ts` exports `hashPassword()` and `verifyPassword()` instead of calling bcrypt directly throughout the codebase. Uses `BCRYPT_ROUNDS` constant from shared-types.

### 5. Constants in shared-types
No magic numbers or strings. All auth-related constants (`REFRESH_COOKIE`, `BCRYPT_ROUNDS`, `ACCESS_TOKEN_EXPIRY_SECS`, `REFRESH_TOKEN_EXPIRY_DAYS`, etc.) exported from `@drive247/shared-types/constants`.

### 6. TenantContextService with Full User Context
Not just tenantId/tenantSlug — stores the complete authenticated user context (userId, email, role, tenantId, isSuperAdmin, isPrimarySuperAdmin). Provides helpers: `requireTenantId()`, `requireUserId()`, `assertCanAccessTenant()`, `isSuperAdmin()`.

### 7. @RequireTenant() Decorator
Routes explicitly marked as tenant-scoped with configurable source resolution. TenantGuard only activates when this metadata is present, with multi-source resolution (user context, route param, query param, body).

### 8. Guards Throw Specific Exceptions
`RolesGuard` throws `ForbiddenException` (not just returns false). `TenantGuard` throws `ForbiddenException` with descriptive messages. Makes debugging easier.

### 9. JWT Refresh Token Security
Refresh tokens signed with separate `JWT_REFRESH_SECRET` and verified (JWT signature check) before DB lookup. bcrypt hash stored in DB for revocation check. Prevents forged tokens from hitting the database.

### 10. Cookie Security
`sameSite: 'strict'` (not `'lax'`). No `domain` attribute set — cookies are naturally scoped to the exact origin, making them tenant-isolated across subdomains.

### 11. Test Files Alongside Implementation
`.spec.ts` files live next to the implementation files they test (not in a separate `__tests__/` directory). 19 guard tests total: jwt-auth (2), roles (5), tenant (12).

### 12. setRefreshCookie() Private Method
Cookie-setting logic extracted into a private method on the controller to avoid duplication between login and refresh endpoints.

### 13. Env Config with Human-Readable Errors
Zod validation includes `.describe()` hints on each field. Seed variables (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, etc.) read from env config.

### 14. Full CRUD on Users
Not just create/list — complete user lifecycle: list, getById, create, update (profile), updateRole, deactivate, activate, delete. Each with proper authorization checks.

### 15. API Request/Response Types in shared-types
`auth.types.ts` and `users.types.ts` define typed request/response interfaces shared between api-client and backend. Keeps frontend and backend contracts in sync.
