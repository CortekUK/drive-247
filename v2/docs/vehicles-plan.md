# Vehicles — Phase 1 Plan (Simple CRUD)

> Simple, tenant-scoped vehicle CRUD in the portal dashboard. **Phase 1 only.** Heavy features (photos, expenses, service records, blocked dates, dynamic pricing, extras, P&L, analytics, disposal flow) are deferred until their dependencies land.

---

## Scope

### In
- Vehicle table (minimal columns for Phase 1)
- Backend CRUD module (list, get, create, update, delete)
- Portal UI: list page + detail page + add dialog + edit dialog
- Search by reg / make / model
- Status filter (active / inactive)
- Role-based authorization (no manager-permissions granularity yet)

### Out (deferred)
| Deferred | Depends on |
|----------|-----------|
| Photos / files | S3 storage layer |
| Expenses, service records | Not valuable without rentals |
| Blocked dates | Booking engine |
| Dynamic pricing overrides | `tenant_holidays` feature |
| Extras | `rental_extras` feature |
| P&L / analytics | Rentals + expenses + views |
| Events log | Derived from rentals/expenses |
| Disposal lifecycle | Kept as simple `status = inactive` toggle for now |
| Manager per-tab permissions | Feature #21 |
| Compliance reminders (MOT/tax) | Notifications feature |

---

## Database

### New enum — `packages/database/src/schema/enums.ts`

```ts
export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'active',
  'inactive',
]);
```

### New table — `packages/database/src/schema/vehicles.ts`

```
vehicles
  id             UUID           PK, default random
  tenant_id      UUID           FK → tenants(id) ON DELETE CASCADE, NOT NULL
  reg            TEXT           NOT NULL
  make           TEXT           NOT NULL
  model          TEXT           NOT NULL
  year           INTEGER        NOT NULL
  daily_rent     NUMERIC(10,2)  NOT NULL
  weekly_rent    NUMERIC(10,2)  NOT NULL
  monthly_rent   NUMERIC(10,2)  NOT NULL
  status         ENUM           vehicleStatusEnum, NOT NULL, default 'active'
  created_at     TIMESTAMPTZ    NOT NULL, default now()
  updated_at     TIMESTAMPTZ    NOT NULL, default now()

  UNIQUE (tenant_id, reg)   -- same reg can exist across tenants, unique within one
```

### New drizzle-zod file — `packages/database/src/zod/vehicles.ts`

```ts
export const insertVehicleSchema = createInsertSchema(vehicles, { ... });
export const selectVehicleSchema = createSelectSchema(vehicles);
```

### Barrel updates
- `packages/database/src/schema/index.ts` → export vehicles
- `packages/database/src/zod/index.ts` → export vehicles zod

### Migration
- `pnpm db:generate` → new SQL file in `apps/backend/src/database/migrations/`
- `pnpm db:migrate`

---

## Shared Types — `packages/shared-types/src/`

### `enums.ts` (append)
```ts
export enum VehicleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}
```

### `vehicles.types.ts` (new)
```ts
export interface VehicleResponse {
  id: string;
  tenantId: string;
  reg: string;
  make: string;
  model: string;
  year: number;
  dailyRent: string;       // numeric as string from pg
  weeklyRent: string;
  monthlyRent: string;
  status: VehicleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleListQuery {
  search?: string;
  status?: VehicleStatus;
  page?: number;
  limit?: number;
}

export interface VehicleListResponse {
  items: VehicleResponse[];
  meta: { page: number; limit: number; total: number };
}

export type CreateVehiclePayload = Omit<VehicleResponse, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;
```

### `index.ts` — export new file

---

## API Client — `packages/api-client/src/vehicles.api.ts`

```ts
export function createVehiclesApi(api: AxiosInstance) {
  return {
    list: (query?: VehicleListQuery) => api.get('/vehicles', { params: query }),
    getById: (id: string) => api.get(`/vehicles/${id}`),
    create: (data: CreateVehiclePayload) => api.post('/vehicles', data),
    update: (id: string, data: UpdateVehiclePayload) => api.patch(`/vehicles/${id}`, data),
    delete: (id: string) => api.delete(`/vehicles/${id}`),
  };
}
```

Update `packages/api-client/src/index.ts` barrel.

---

## Backend — `apps/backend/src/modules/vehicles/`

### Structure
```
modules/vehicles/
├── vehicles.module.ts
├── vehicles.controller.ts
├── vehicles.service.ts
└── dto/
    ├── create-vehicle.dto.ts
    ├── update-vehicle.dto.ts
    └── list-vehicles.dto.ts
```

### DTOs — use drizzle-zod shapes

```ts
// create-vehicle.dto.ts
import { insertVehicleSchema } from '@drive247/database';

export const createVehicleDto = z.object({
  reg: insertVehicleSchema.shape.reg,
  make: insertVehicleSchema.shape.make,
  model: insertVehicleSchema.shape.model,
  year: z.coerce.number().int().min(1900).max(2100),
  dailyRent: z.coerce.number().min(0),
  weeklyRent: z.coerce.number().min(0),
  monthlyRent: z.coerce.number().min(0),
  status: z.nativeEnum(VehicleStatus).default(VehicleStatus.ACTIVE),
});

// update-vehicle.dto.ts — partial, with .refine() ensuring at least one field
// list-vehicles.dto.ts — search, status, page, limit (defaults: page=1, limit=20)
```

### Controller

All endpoints:
- `@RequireTenant()` (resolve from user context)
- `:id` → `ParseUUIDPipe`
- Mutations gated by `@Roles(HEAD_ADMIN, ADMIN, MANAGER, OPS)`
- Reads gated by `@Roles(HEAD_ADMIN, ADMIN, MANAGER, OPS, VIEWER)`

| Method | Path | Roles |
|--------|------|-------|
| `GET` | `/api/vehicles` | all 5 |
| `GET` | `/api/vehicles/:id` | all 5 |
| `POST` | `/api/vehicles` | head_admin, admin, manager, ops |
| `PATCH` | `/api/vehicles/:id` | head_admin, admin, manager, ops |
| `DELETE` | `/api/vehicles/:id` | head_admin, admin |

### Service

- Uses `TenantContextService.requireTenantId()` for all queries
- **List**: filter by tenant_id; optional `ilike` search on reg/make/model; optional status filter; paginated
- **Get**: filter by `{ id, tenantId }` — 404 if not found
- **Create**: insert with tenant_id from context; on `UNIQUE (tenant_id, reg)` violation → 409 Conflict with clear message
- **Update**: update where `{ id, tenantId }`; same conflict handling if reg changes to duplicate
- **Delete**: hard delete where `{ id, tenantId }`

No audit logging in Phase 1 (keep simple — can add later when auditLogs gains `resource_type = 'vehicle'` actions).

### Wire up
- Add `VehiclesModule` to `app.module.ts` imports.

---

## Frontend — `apps/frontend/portal/src/`

### Routes
```
app/(dashboard)/
├── vehicles/
│   ├── page.tsx              # List + search + status filter + "Add" dialog
│   └── [id]/
│       └── page.tsx          # Detail view + Edit dialog + Delete button
```

### Components (new, in portal)
```
components/vehicles/
├── vehicles-table.tsx        # shadcn Table: Reg, Make/Model, Year, Daily Rent, Status, actions
├── add-vehicle-dialog.tsx    # shadcn Dialog + react-hook-form + zod
├── edit-vehicle-dialog.tsx   # same shape, prefilled, partial submit
└── delete-vehicle-alert.tsx  # shadcn AlertDialog confirmation
```

Keep forms **flat** (no tabs) — Phase 1 fields fit on one screen.

### Hooks (new)
```
hooks/
├── use-vehicles.ts              # useQuery list, keys: ['vehicles', search, status, page]
├── use-vehicle.ts               # useQuery detail, key: ['vehicle', id]
└── use-vehicle-mutations.ts     # create / update / delete; invalidates lists
```

All hooks reuse `vehiclesApi` from `@/lib/api.ts`.

### Lib update — `apps/frontend/portal/src/lib/api.ts`
Add `export const vehiclesApi = createVehiclesApi(api);`.

### Sidebar
Add a "Vehicles" entry to the portal dashboard sidebar (wherever the current nav lives).

### shadcn components needed
Already in `@drive247/ui`: Button, Input, Label, Card, Badge, Table, Dialog, Select, Alert, Separator, DropdownMenu, Tabs. Nothing new required for Phase 1.

---

## Implementation Order

### Step 1 — Shared schema + types
- [ ] Add `vehicleStatusEnum` to `packages/database/src/schema/enums.ts`
- [ ] Create `packages/database/src/schema/vehicles.ts`
- [ ] Create `packages/database/src/zod/vehicles.ts`
- [ ] Update schema + zod barrel exports
- [ ] Add `VehicleStatus` enum to `@drive247/shared-types`
- [ ] Create `packages/shared-types/src/vehicles.types.ts` + barrel

### Step 2 — Migration
- [ ] `pnpm db:generate`
- [ ] Inspect generated SQL
- [ ] `pnpm db:migrate`

### Step 3 — API client
- [ ] `packages/api-client/src/vehicles.api.ts`
- [ ] Barrel export

### Step 4 — Backend module
- [ ] `vehicles.service.ts`
- [ ] `dto/create-vehicle.dto.ts`, `update-vehicle.dto.ts`, `list-vehicles.dto.ts`
- [ ] `vehicles.controller.ts`
- [ ] `vehicles.module.ts`
- [ ] Wire into `app.module.ts`

### Step 5 — Postman tests
- [ ] List (empty tenant)
- [ ] Create valid → 201
- [ ] Create duplicate reg → 409
- [ ] List with search + status filter → correct results
- [ ] Get by id → 200; wrong tenant → 404
- [ ] Update → 200
- [ ] Delete → 204; confirm 404 after
- [ ] Role checks (viewer can read, cannot write; ops cannot delete)

### Step 6 — Frontend wiring
- [ ] `vehiclesApi` in `lib/api.ts`
- [ ] `use-vehicles.ts`, `use-vehicle.ts`, `use-vehicle-mutations.ts`
- [ ] Add `/vehicles` route to sidebar

### Step 7 — Frontend pages & components
- [ ] `vehicles-table.tsx`
- [ ] `add-vehicle-dialog.tsx`
- [ ] `edit-vehicle-dialog.tsx`
- [ ] `delete-vehicle-alert.tsx`
- [ ] `app/(dashboard)/vehicles/page.tsx` (list + search + filter + add dialog)
- [ ] `app/(dashboard)/vehicles/[id]/page.tsx` (detail + edit dialog + delete)

### Step 8 — End-to-end
- [ ] Login as tenant head_admin
- [ ] Create, list (with search + filter), view, edit, delete from UI
- [ ] Verify tenant isolation (second tenant cannot see vehicles from the first)

---

## Notes

- **Ultra-minimal schema** — only what's needed to identify and price a vehicle: reg, make/model/year, 3 rents, status. Everything else (color, fuel type, VIN, notes, availability toggles, compliance dates, security, mileage, acquisition, disposal) is deferred.
- **Numeric fields**: pg returns `NUMERIC` as string. DTOs coerce on the way in, responses leave as string; frontend formats for display.
- **Status is simple on/off** — 'Rented' / 'Disposed' logic deferred; `inactive` covers both for Phase 1.
- **Sidebar entry** — role gating for now. Manager per-tab permissions get layered on in Feature #21.
- **Plan doc**: update the `MIGRATION_GUIDE.md` feature tracker to mark #6 "Vehicle management (Phase 1)" as in progress / done as we go.
