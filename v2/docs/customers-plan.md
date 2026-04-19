# Customers — Phase 1 Plan (Simple CRUD)

> Simple, tenant-scoped customer CRUD in the portal dashboard. **Phase 1 only.** Heavy features (documents, verification/Veriff, gig-driver images, blocking, rental history, payments, reviews, customer-portal auth) are deferred until their dependencies land.

---

## Scope

### In
- `customers` table — minimum columns for Phase 1
- Backend CRUD module (list, get, create, update, delete)
- Portal UI: list page + detail page + add dialog + edit dialog
- Search by name / email / phone
- Status filter (active / inactive)
- Role-based authorization (no manager-permissions granularity yet)

### Out (deferred)
| Deferred | Depends on |
|----------|-----------|
| Documents | S3 storage |
| Gig-driver proof images | S3 storage |
| Profile photo | S3 storage |
| Veriff / identity verification | Integrations module |
| Customer-portal auth (`customer_users`) | Feature #4 |
| Blocking / blacklist | Dedicated blocking feature |
| Rejection workflow | Needs verification to reject against |
| Rental history / payments / fines tabs | Those tables don't exist yet in V2 |
| Reviews summary | Reviews feature |
| `type` (Individual / Company) | Not needed for MVP |
| Next of Kin fields | Not needed for MVP |
| DOB, license_number, id_number | Defer with verification feature |
| WhatsApp opt-in | Defer with notifications feature |
| Manager per-tab permissions | Feature #21 |

---

## Database

### New enum — `packages/database/src/schema/enums.ts`

```ts
export const customerStatusEnum = pgEnum('customer_status', [
  'active',
  'inactive',
]);
```

### New table — `packages/database/src/schema/customers.ts`

```
customers
  id          UUID        PK, default random
  tenant_id   UUID        FK → tenants(id) ON DELETE CASCADE, NOT NULL
  name        TEXT        NOT NULL
  email       TEXT        nullable
  phone       TEXT        nullable
  status      ENUM        customerStatusEnum, NOT NULL, default 'active'
  created_at  TIMESTAMPTZ NOT NULL, default now()
  updated_at  TIMESTAMPTZ NOT NULL, default now()

  UNIQUE (tenant_id, email) WHERE email IS NOT NULL   -- partial unique
```

**Drizzle:**
```ts
(table) => [
  uniqueIndex('customers_email_tenant_idx')
    .on(table.tenantId, table.email)
    .where(sql`email IS NOT NULL`),
]
```

### New drizzle-zod file — `packages/database/src/zod/customers.ts`

```ts
export const insertCustomerSchema = createInsertSchema(customers);
export const selectCustomerSchema = createSelectSchema(customers);
```

### Barrel updates
- `packages/database/src/schema/index.ts` → export customers
- `packages/database/src/zod/index.ts` → export customers zod

### Migration
- `pnpm db:generate` → new SQL file in `apps/backend/src/database/migrations/`
- `pnpm db:migrate`

---

## Shared Types — `packages/shared-types/src/`

### `enums.ts` (append)
```ts
export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}
```

### `customers.types.ts` (new)
```ts
export type CreateCustomerPayload = {
  name: string;
  email?: string | null;
  phone?: string | null;
  status?: CustomerStatus;
};

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

export type CustomerListQuery = {
  search?: string;
  status?: CustomerStatus;
  page?: number;
  limit?: number;
};

export type CustomerResponse = {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
};

export type CustomerListResponse = {
  items: CustomerResponse[];
  meta: { page: number; limit: number; total: number };
};
```

### `index.ts` — export new file

---

## API Client — `packages/api-client/src/customers.api.ts`

```ts
export function createCustomersApi(api: AxiosInstance) {
  return {
    list: (query?: CustomerListQuery) => api.get('/customers', { params: query }),
    getById: (id: string) => api.get(`/customers/${id}`),
    create: (data: CreateCustomerPayload) => api.post('/customers', data),
    update: (id: string, data: UpdateCustomerPayload) => api.patch(`/customers/${id}`, data),
    remove: (id: string) => api.delete(`/customers/${id}`),
  };
}
```

Update `packages/api-client/src/index.ts` barrel.

---

## Backend — `apps/backend/src/modules/customers/`

### Structure
```
modules/customers/
├── customers.module.ts
├── customers.controller.ts
├── customers.service.ts
└── dto/
    ├── create-customer.dto.ts
    ├── update-customer.dto.ts
    └── list-customers.dto.ts
```

### DTOs — drizzle-zod shapes + refine

```ts
// create-customer.dto.ts
export const createCustomerSchema = z.object({
  name: insertCustomerSchema.shape.name.min(1, 'Name is required').max(100),
  email: z.string().trim().email().max(255).optional().nullable(),
  phone: z.string().trim().min(3).max(30).optional().nullable(),
  status: z.nativeEnum(CustomerStatus).default(CustomerStatus.ACTIVE),
}).refine(
  (data) => !!(data.email || data.phone),
  { message: 'Either email or phone is required', path: ['email'] },
);

// update-customer.dto.ts — partial, .refine() requiring at least one field
// list-customers.dto.ts — search, status, page, limit (defaults: page=1, limit=20)
```

### Controller

All endpoints:
- `@RequireTenant()` (resolve from user context)
- `:id` → `ParseUUIDPipe`
- Mutations gated by `@Roles(HEAD_ADMIN, ADMIN, MANAGER, OPS)`
- Reads gated by all five roles

| Method | Path | Roles |
|--------|------|-------|
| `GET` | `/api/customers` | all 5 |
| `GET` | `/api/customers/:id` | all 5 |
| `POST` | `/api/customers` | head_admin, admin, manager, ops |
| `PATCH` | `/api/customers/:id` | head_admin, admin, manager, ops |
| `DELETE` | `/api/customers/:id` | head_admin, admin |

### Service

- Uses `TenantContextService.requireTenantId()` for all queries
- **List**: filter by tenant_id; optional `ilike` search on name/email/phone; optional status filter; paginated
- **Get**: filter by `{ id, tenantId }` — 404 if not found
- **Create**: insert with tenant_id from context; on unique email violation → **409 Conflict** with clear message
- **Update**: update where `{ id, tenantId }`; same conflict handling if email changes to duplicate
- **Delete**: hard delete where `{ id, tenantId }`

### Wire up
- Add `CustomersModule` to `app.module.ts` imports

---

## Frontend — `apps/frontend/portal/src/`

### Routes
```
app/(dashboard)/
├── customers/
│   ├── page.tsx              # List + search + status filter + "Add" dialog
│   └── [id]/
│       └── page.tsx          # Detail view + Edit dialog + Delete button
```

### Components
```
components/customers/
├── add-customer-dialog.tsx
└── edit-customer-dialog.tsx
```

### Lib update — `apps/frontend/portal/src/lib/api.ts`
Add `export const customersApi = createCustomersApi(api);`

### Sidebar
Add a "Customers" entry to the portal dashboard sidebar (next to Vehicles).

### Pattern
Same as vehicles page — local `useState` + `useEffect`, no React Query, shadcn UI only.

### shadcn components needed
All already in `@drive247/ui`: Button, Input, Label, Card, Badge, Table, Dialog, Select, Separator. Nothing new.

---

## Implementation Order

### Step 1 — Shared schema + types
- [ ] Add `customerStatusEnum` to `packages/database/src/schema/enums.ts`
- [ ] Create `packages/database/src/schema/customers.ts`
- [ ] Create `packages/database/src/zod/customers.ts`
- [ ] Update schema + zod barrel exports
- [ ] Add `CustomerStatus` to `@drive247/shared-types`
- [ ] Create `packages/shared-types/src/customers.types.ts` + barrel

### Step 2 — Migration
- [ ] `pnpm db:generate`
- [ ] Inspect generated SQL (verify partial unique index clause)
- [ ] `pnpm db:migrate`

### Step 3 — API client
- [ ] `packages/api-client/src/customers.api.ts`
- [ ] Barrel export

### Step 4 — Backend module
- [ ] `customers.service.ts`
- [ ] `dto/create-customer.dto.ts`, `update-customer.dto.ts`, `list-customers.dto.ts`
- [ ] `customers.controller.ts`
- [ ] `customers.module.ts`
- [ ] Wire into `app.module.ts`
- [ ] Rebuild `@drive247/database` + `@drive247/shared-types` (dist)

### Step 5 — Postman tests
- [ ] Create with email only → 201
- [ ] Create with phone only → 201
- [ ] Create with neither → 400 (refine error)
- [ ] Create duplicate email in same tenant → 409
- [ ] Same email in a second tenant → 201 (tenant isolation)
- [ ] Two customers with NULL email → both succeed
- [ ] List with search + status filter → correct results
- [ ] Get by id → 200; wrong tenant → 404
- [ ] Update → 200; update email to existing one in same tenant → 409
- [ ] Delete → 204; subsequent GET → 404
- [ ] Role checks (viewer can read, cannot write; ops cannot delete)

### Step 6 — Frontend wiring
- [ ] `customersApi` in `lib/api.ts`
- [ ] Add `/customers` to sidebar

### Step 7 — Frontend pages & components
- [ ] `add-customer-dialog.tsx`
- [ ] `edit-customer-dialog.tsx`
- [ ] `app/(dashboard)/customers/page.tsx`
- [ ] `app/(dashboard)/customers/[id]/page.tsx`

### Step 8 — End-to-end
- [ ] Login as tenant user
- [ ] Create, list (with search + filter), view, edit, delete from UI
- [ ] Verify tenant isolation (second tenant cannot see customers from the first)
- [ ] Verify email uniqueness is enforced via UI error toast

---

## Notes

- **Partial unique index** — required because email is nullable; Postgres treats each NULL as distinct, so multiple null-email customers can coexist.
- **At-least-one-of rule** — enforced in the DTO (`.refine()`), not in DB. Keeps the DB honest (both can be null at the type level) and the business rule close to the API surface.
- **Hard delete** — matches vehicles. Once rentals/payments tables exist, we'll revisit whether to add `deleted_at` for soft delete so historical rental records still resolve a customer name.
- **Update doc**: mark feature #7 "Customer management (Phase 1)" in `MIGRATION_GUIDE.md` as in progress / done as we go.
