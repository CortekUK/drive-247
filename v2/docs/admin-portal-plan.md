# Admin Portal — Tenant CRUD + Dashboard Plan

> Super admin (owner) portal for managing tenants. Phase 1 only — tenant CRUD and basic dashboard to test all operations.

---

## What We're Building

A new frontend app (`apps/frontend/admin`) + backend modules for:
1. **Tenant CRUD** — create, list, view, edit, delete rental companies
2. **Basic Dashboard** — KPI cards (total tenants, users, active/inactive counts)
3. **Tenant Detail** — view tenant info, staff users, basic stats

---

## V1 Reference

In V1, tenant creation collects:
- `company_name`, `admin_name`, `slug`, `contact_email`, `tenant_type` (production/test)
- Auto-generates admin password, creates admin user via edge function
- Generates portal + booking URLs from slug

Tenant edit allows: `company_name`, `admin_name`, `slug`, `contact_email`

---

## Database Changes

### Expand `tenants` table

Current table (from auth feature) only has: `id`, `slug`, `company_name`, `status`, `created_at`, `updated_at`

Need to add columns to match V1:

```
packages/database/src/schema/tenants.ts — add columns:

  contactEmail       TEXT          nullable
  contactPhone       TEXT          nullable
  adminName          TEXT          nullable
  tenantType         ENUM          'production' | 'test' (default 'production')
  trialEndsAt        TIMESTAMPTZ   nullable
```

### New enum

```
packages/database/src/schema/enums.ts — add:

  tenantTypeEnum = pgEnum('tenant_type', ['production', 'test'])
```

### New drizzle-zod file

```
packages/database/src/zod/tenants.ts
  insertTenantSchema, selectTenantSchema
```

### Migration

Generate + run after schema changes.

---

## Backend

### Tenants Module

```
apps/backend/src/modules/tenants/
  tenants.module.ts
  tenants.controller.ts
  tenants.service.ts
  dto/
    create-tenant.dto.ts
    update-tenant.dto.ts
```

### API Endpoints

All require super admin (`is_super_admin = true`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tenants` | List all tenants (with search, filter by type/status) |
| `GET` | `/api/tenants/:id` | Get tenant detail (includes staff count, stats) |
| `POST` | `/api/tenants` | Create tenant + provision head_admin user |
| `PATCH` | `/api/tenants/:id` | Update tenant (company_name, slug, contact_email, admin_name) |
| `DELETE` | `/api/tenants/:id` | Delete tenant (cascade: users, permissions, tokens, audit logs) |
| `GET` | `/api/tenants/stats` | Dashboard KPIs (total tenants, by type, by status) |

### DTOs

**create-tenant.dto.ts:**
```typescript
z.object({
  companyName: z.string().min(1).max(255),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/),
  contactEmail: z.string().email(),
  adminName: z.string().min(1).max(100).optional(),
  tenantType: z.enum(['production', 'test']).default('production'),
  // Admin user provisioning
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8), // or auto-generate
})
```

**update-tenant.dto.ts:**
```typescript
z.object({
  companyName: z.string().min(1).max(255).optional(),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
  contactEmail: z.string().email().optional(),
  adminName: z.string().max(100).nullable().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
})
.refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
})
```

### Tenant Service Logic

**Create tenant:**
1. Validate slug uniqueness
2. Insert tenant row
3. Hash admin password
4. Create head_admin `app_users` row with `mustChangePassword: true`
5. Audit log: `create_tenant`
6. Return tenant + admin credentials

**Delete tenant:**
1. Verify tenant exists
2. Revoke all sessions for all tenant users
3. Delete tenant (cascade handles: app_users → manager_permissions, refresh_tokens, audit_logs)
4. Audit log: `delete_tenant`

**List tenants:**
- Search by company_name, slug, contact_email
- Filter by tenant_type (production/test)
- Filter by status (active/inactive/suspended)
- Return count of staff users per tenant

**Stats:**
- Total tenants
- Active vs inactive count
- Production vs test count
- Total users across all tenants

### Shared Types

**`packages/shared-types/src/tenants.types.ts`:**
```typescript
type CreateTenantPayload = { ... }
type UpdateTenantPayload = { ... }
type TenantListItem = { id, slug, companyName, contactEmail, tenantType, status, staffCount, createdAt }
type TenantDetail = TenantListItem & { adminName, contactPhone, trialEndsAt, users: UserListItem[] }
type TenantStats = { total, active, inactive, production, test, totalUsers }
```

### API Client

**`packages/api-client/src/tenants.api.ts`:**
```typescript
createTenantsApi(api) → list, getById, create, update, delete, stats
```

---

## Frontend — Admin App

### New App

```
apps/frontend/admin/
  package.json            # @drive247/admin
  next.config.ts
  tsconfig.json
  src/
    app/
      layout.tsx          # Root layout + providers
      globals.css
      (auth)/
        login/page.tsx    # Super admin login (is_super_admin check)
      (dashboard)/
        layout.tsx        # Auth guard + sidebar + header
        page.tsx          # Dashboard with KPI cards
        tenants/
          page.tsx        # Tenant list table
        tenants/[id]/
          page.tsx        # Tenant detail page
    stores/
      admin-auth-store.ts # Super admin auth (checks is_super_admin)
    lib/
      api.ts              # createApiClient wired to admin store
```

### Pages

**Login** (`/login`):
- Same pattern as portal login
- After login, check `user.isSuperAdmin === true` — reject if not
- Redirect to dashboard

**Dashboard** (`/`):
- 4-6 KPI cards: Total Tenants, Active, Inactive, Production, Test, Total Users
- Uses `GET /api/tenants/stats`
- Quick action buttons: "Create Tenant"

**Tenants List** (`/tenants`):
- Table with columns: Company Name, Slug, Email, Type (badge), Status (text color), Staff Count, Created At, Actions
- Search input (filters company name, slug, email)
- Filter by type (production/test/all) and status (active/inactive/all)
- "Create Tenant" button → opens dialog
- Create dialog: company name, slug, contact email, admin email, admin name, tenant type
- On success: show credentials modal (admin email + password + portal URL)

**Tenant Detail** (`/tenants/[id]`):
- Info card: company name, slug, contact email, admin name, tenant type, status, created at
- Edit button → inline edit or dialog
- Staff users table: name, email, role, status, last login
- Delete button (danger zone, with confirmation)

### UI Components Needed

From `@drive247/ui` (already have): Button, Input, Label, Card, Badge, Table, Dialog, Select, Alert, Separator, DropdownMenu, Avatar, Tabs

May need to add via shadcn CLI: `skeleton` (loading states)

---

## Workspace Updates

### pnpm-workspace.yaml

Already covers `apps/frontend/*` — admin will be auto-detected.

### Root package.json

Add script: `"dev:admin": "pnpm --filter @drive247/admin dev"`

### Port

Admin runs on port **3003** (matches V1 convention).

---

## Implementation Order

### Step 1: Expand tenants schema
- [ ] Add `tenantTypeEnum` to enums.ts
- [ ] Add new columns to tenants.ts (contactEmail, contactPhone, adminName, tenantType, trialEndsAt)
- [ ] Create `packages/database/src/zod/tenants.ts`
- [ ] Update barrel exports
- [ ] Generate + run migration
- [ ] Rebuild packages/database

### Step 2: Shared types + API client
- [ ] Create `packages/shared-types/src/tenants.types.ts`
- [ ] Create `packages/api-client/src/tenants.api.ts`
- [ ] Update barrel exports
- [ ] Rebuild shared-types

### Step 3: Backend tenants module
- [ ] Create DTOs: `create-tenant.dto.ts`, `update-tenant.dto.ts`
- [ ] Create `tenants.service.ts` (CRUD + stats + admin user provisioning)
- [ ] Create `tenants.controller.ts` (all endpoints, super admin only)
- [ ] Create `tenants.module.ts`
- [ ] Wire into `app.module.ts`
- [ ] Update seed to use expanded tenant fields

### Step 4: Test with Postman
- [ ] Create tenant → verify admin user provisioned
- [ ] List tenants → verify search + filters
- [ ] Get tenant detail → verify staff count
- [ ] Update tenant → verify slug uniqueness
- [ ] Delete tenant → verify cascade
- [ ] Stats endpoint → verify counts

### Step 5: Create admin frontend app
- [ ] Scaffold `apps/frontend/admin` (same pattern as portal)
- [ ] Admin auth store (is_super_admin check)
- [ ] API client wired to admin store
- [ ] Login page
- [ ] Dashboard layout + sidebar

### Step 6: Admin frontend pages
- [ ] Dashboard page with KPI cards
- [ ] Tenants list page with table + search + filters + create dialog
- [ ] Tenant detail page with edit + staff users + delete
- [ ] Add `skeleton` shadcn component for loading states

### Step 7: Test end-to-end
- [ ] Login as super admin
- [ ] Create a new tenant via UI
- [ ] See it in the list
- [ ] View detail, edit fields
- [ ] Delete it
- [ ] Verify dashboard stats update

---

## Notes

- Super admin login has NO tenant slug header — `x-tenant-slug` is omitted
- All tenant endpoints require `@Roles(UserRole.HEAD_ADMIN)` + super admin check in service
- When creating a tenant, the admin user password can be auto-generated and shown once in a credentials modal
- Slug validation: lowercase alphanumeric + hyphens only, 3-50 chars
- Reserved slugs (www, admin, portal, api, app) should be blocked
- Delete is a hard delete with cascade — use confirmation dialog with tenant name typed to confirm
