# Rentals — Phase 1 Plan (Simple CRUD + Lifecycle)

> Simple, tenant-scoped rental CRUD in the portal dashboard. **Phase 1 only.** The table is named `rentals` to match V1 and to support the full lifecycle (pending → active → completed/cancelled) as features layer on. Heavy features (pricing engine, payments, e-sign, insurance, extensions, mileage, damages, notifications, customer self-booking) are deferred.

---

## Scope

### In
- `rentals` table — minimum columns for Phase 1 (customer + vehicle + date range + amount + status)
- Backend module: list, get, create, update, **transition status** (dedicated endpoint), delete
- **Vehicle conflict detection** — no overlapping active/pending rentals on the same vehicle (enforced on create + update)
- **Status transition guards** — pending → active → completed/cancelled, with terminal states
- Portal UI: list page, dedicated `/rentals/new` form page, detail page with edit + status actions
- Customer picker (search) and vehicle picker (search + conflict warning)
- Search by customer name / vehicle reg + status filter
- Role-based authorization (no manager-permissions granularity yet)

### Out (deferred)
| Deferred | Depends on |
|----------|-----------|
| Auto-pricing (tier × duration × surcharges) | Pricing engine feature |
| Payments / ledger / invoices | Payments module |
| Stripe preauth + capture | Stripe integration |
| E-sign (BoldSign) | Integrations module |
| Insurance (tenant-level + Bonzah) | Insurance feature |
| Extensions | Extensions feature |
| Mileage tracking (start/end odometer, excess) | Mileage feature |
| Damages | Damages feature |
| Key handovers / lockbox | Lockbox feature |
| Installments | Installments feature |
| Customer self-booking (`apps/booking/`) | Booking app feature |
| Pending-bookings approval queue | Customer self-booking |
| Rental number generator (readable ID) | Nice-to-have |
| Pickup / return location + times | Ops feature |
| Dynamic pricing (weekend/holiday surcharges) | Dynamic pricing feature |
| Blocked dates (maintenance) | Availability feature |
| Notifications | Notifications feature |
| Reviews | Reviews feature |
| Extras | Extras feature |
| Gig driver flag on rental | Already on customer |
| Notes / timeline events | Not needed for MVP |
| Manager per-tab permissions | Feature #21 |

---

## Database

### New enums — `packages/database/src/schema/enums.ts`

```ts
export const rentalStatusEnum = pgEnum('rental_status', [
  'pending',
  'active',
  'completed',
  'cancelled',
]);

export const rentalPeriodTypeEnum = pgEnum('rental_period_type', [
  'daily',
  'weekly',
  'monthly',
]);
```

### New table — `packages/database/src/schema/rentals.ts`

```
rentals
  id             UUID           PK, default random
  tenant_id      UUID           FK → tenants(id) ON DELETE CASCADE, NOT NULL
  customer_id    UUID           FK → customers(id) ON DELETE RESTRICT, NOT NULL
  vehicle_id     UUID           FK → vehicles(id)  ON DELETE RESTRICT, NOT NULL
  start_date     DATE           NOT NULL
  end_date       DATE           NOT NULL
  period_type    ENUM           rentalPeriodTypeEnum, NOT NULL
  total_amount   NUMERIC(12,2)  NOT NULL
  status         ENUM           rentalStatusEnum, NOT NULL, default 'pending'
  created_at     TIMESTAMPTZ    NOT NULL, default now()
  updated_at     TIMESTAMPTZ    NOT NULL, default now()

  CHECK (end_date >= start_date)
```

**FK behaviors chosen**
- `tenant_id` ON DELETE CASCADE — tenant delete wipes its rentals along with everything else.
- `customer_id` ON DELETE RESTRICT — prevents deleting a customer with rental history (phase 2 we'll revisit with soft-delete).
- `vehicle_id` ON DELETE RESTRICT — same reasoning.

### New drizzle-zod file — `packages/database/src/zod/rentals.ts`

```ts
export const insertRentalSchema = createInsertSchema(rentals);
export const selectRentalSchema = createSelectSchema(rentals);
```

### Barrel updates
- `packages/database/src/schema/index.ts` → export rentals
- `packages/database/src/zod/index.ts` → export rentals zod

### Migration
- `pnpm db:generate` → new SQL file (`0004_*.sql`)
- Inspect (two new enums + table + two FKs + CHECK)
- `pnpm db:migrate`

---

## Shared Types — `packages/shared-types/src/`

### `enums.ts` (append)
```ts
export enum RentalStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum RentalPeriodType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}
```

### `rentals.types.ts` (new)
```ts
export type CreateRentalPayload = {
  customerId: string;
  vehicleId: string;
  startDate: string;     // ISO date
  endDate: string;       // ISO date
  periodType: RentalPeriodType;
  totalAmount: number;
  status?: RentalStatus; // default pending
};

export type UpdateRentalPayload = Partial<
  Pick<CreateRentalPayload, 'startDate' | 'endDate' | 'periodType' | 'totalAmount'>
>;

export type TransitionRentalPayload = {
  status: Exclude<RentalStatus, 'pending'>;   // only allow outbound transitions
};

export type RentalListQuery = {
  search?: string;              // matches customer name OR vehicle reg
  status?: RentalStatus;
  customerId?: string;
  vehicleId?: string;
  page?: number;
  limit?: number;
};

// Denormalized list row — includes basic customer + vehicle refs so the
// list table doesn't need a second query per row
export type RentalListItem = {
  id: string;
  tenantId: string;
  startDate: string;
  endDate: string;
  periodType: RentalPeriodType;
  totalAmount: string;
  status: RentalStatus;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; email: string | null };
  vehicle:  { id: string; reg: string; make: string; model: string };
};

export type RentalDetail = RentalListItem;

export type RentalListResponse = {
  items: RentalListItem[];
  meta: { page: number; limit: number; total: number };
};
```

### `index.ts` — export new file

---

## API Client — `packages/api-client/src/rentals.api.ts`

```ts
export function createRentalsApi(api: AxiosInstance) {
  return {
    list: (query?: RentalListQuery) => api.get('/rentals', { params: query }),
    getById: (id: string) => api.get(`/rentals/${id}`),
    create: (data: CreateRentalPayload) => api.post('/rentals', data),
    update: (id: string, data: UpdateRentalPayload) => api.patch(`/rentals/${id}`, data),
    transition: (id: string, data: TransitionRentalPayload) =>
      api.patch(`/rentals/${id}/status`, data),
    remove: (id: string) => api.delete(`/rentals/${id}`),
  };
}
```

Update `packages/api-client/src/index.ts` barrel.

---

## Backend — `apps/backend/src/modules/rentals/`

### Structure
```
modules/rentals/
├── rentals.module.ts
├── rentals.controller.ts
├── rentals.service.ts
└── dto/
    ├── create-rental.dto.ts
    ├── update-rental.dto.ts
    ├── transition-rental.dto.ts
    └── list-rentals.dto.ts
```

### DTOs — drizzle-zod shapes + business refines

```ts
// create-rental.dto.ts
export const createRentalSchema = z
  .object({
    customerId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    periodType: z.nativeEnum(RentalPeriodType),
    totalAmount: z.coerce.number().min(0).max(99999999),
    status: z.nativeEnum(RentalStatus).default(RentalStatus.PENDING),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

// update-rental.dto.ts — partial fields (no customerId/vehicleId change once created)
// with same endDate >= startDate refine when both are supplied or when one is
// combined with the existing row (checked in service)

// transition-rental.dto.ts
export const transitionRentalSchema = z.object({
  status: z.enum([
    RentalStatus.ACTIVE,
    RentalStatus.COMPLETED,
    RentalStatus.CANCELLED,
  ]),
});

// list-rentals.dto.ts — search, status, customerId, vehicleId, page, limit
```

### Controller

All endpoints:
- `@RequireTenant()` (resolve from user context)
- `:id` → `ParseUUIDPipe`
- Mutations gated by `@Roles(HEAD_ADMIN, ADMIN, MANAGER, OPS)`
- Reads gated by all five roles

| Method | Path | Roles |
|--------|------|-------|
| `GET`    | `/api/rentals`            | all 5 |
| `GET`    | `/api/rentals/:id`        | all 5 |
| `POST`   | `/api/rentals`            | head_admin, admin, manager, ops |
| `PATCH`  | `/api/rentals/:id`        | head_admin, admin, manager, ops |
| `PATCH`  | `/api/rentals/:id/status` | head_admin, admin, manager, ops |
| `DELETE` | `/api/rentals/:id`        | head_admin, admin |

### Service logic

- Uses `TenantContextService.requireTenantId()` everywhere
- **List**: join `customers` + `vehicles`, filter by tenant; optional `ilike` search matches `customer.name` OR `vehicle.reg`; optional status/customerId/vehicleId filters; paginated
- **Get**: join + filter by `{ id, tenantId }` — 404 if not found
- **Create**:
  1. Verify `customer` belongs to tenant — 404 otherwise
  2. Verify `vehicle` belongs to tenant — 404 otherwise
  3. Verify vehicle status = `active` — 400 otherwise ("vehicle is inactive")
  4. **Conflict check** (below) — 409 on overlap
  5. Insert row
- **Update**:
  1. Load existing where `{ id, tenantId }` — 404 if missing
  2. Reject if status is terminal (`completed` / `cancelled`) — 409 "cannot edit after completion"
  3. If `startDate`/`endDate` changed, **re-run conflict check** with new range excluding this row's id
  4. Apply patch
- **Transition**:
  1. Load existing — 404 if missing
  2. Call `assertCanTransition(existing.status, input.status)` — 409 on invalid transition
  3. Update status
- **Delete**: hard delete where `{ id, tenantId }`; returns 204

### Conflict detection

Query used by create + update:
```sql
SELECT 1 FROM rentals
 WHERE tenant_id = :tenantId
   AND vehicle_id = :vehicleId
   AND status IN ('pending', 'active')
   AND id <> :excludeId  -- NULL on create
   AND start_date <= :endDate
   AND end_date >= :startDate
LIMIT 1;
```
Half-open semantics (inclusive boundaries on both ends) — so a rental ending on May 10 conflicts with one starting on May 10. Keep it conservative; swap to exclusive end later if ops want same-day turnover.

### Transition rules

Allowed transitions (everything else throws `ConflictException`):

| From        | To                       |
|-------------|--------------------------|
| `pending`   | `active`, `cancelled`    |
| `active`    | `completed`, `cancelled` |
| `completed` | *(terminal)*             |
| `cancelled` | *(terminal)*             |

**Activation date guard (Rule A):** the `pending → active` transition additionally requires `today >= start_date`. This enforces the semantic meaning of "active" — the customer physically has the vehicle *right now*. A rental starting in the future cannot be activated.

- Error message: `Cannot activate before start date (YYYY-MM-DD). If the customer is picking up early, edit the rental to change the start date first.`
- Early-pickup workflow: admin updates `start_date` to today via `PATCH /rentals/:id`, then activates. This keeps the rental record accurate (always reflects the actual pickup date, not just the originally-booked date).
- Why not a vehicle-state check ("no other active rental on this vehicle")? The existing conflict check already blocks overlapping active+pending rentals at create/update time, so a vehicle-state guard would be redundant. Rule A is stricter and cleaner because it enforces semantics rather than just preventing the one obvious inconsistency.

### Wire up
- Add `RentalsModule` to `app.module.ts` imports
- Rebuild `@drive247/database` + `@drive247/shared-types` dist after schema changes

---

## Frontend — `apps/frontend/portal/src/`

### Routes
```
app/(dashboard)/rentals/
├── page.tsx              # List + search + status filter + "New rental" button
├── new/
│   └── page.tsx          # Create form (dedicated page, not dialog)
└── [id]/
    └── page.tsx          # Detail + edit dialog + status actions + delete
```

### Components
```
components/rentals/
├── rentals-table.tsx     # shadcn Table: Customer, Vehicle, Dates, Amount, Status, Actions
├── customer-picker.tsx   # Combobox-style search via customersApi; shows name + email
├── vehicle-picker.tsx    # Combobox-style search via vehiclesApi; filters inactive; shows reg + make/model; warns on conflict once dates selected
├── rental-form.tsx       # Shared form used by new/ and edit dialog; fields: customer, vehicle, start, end, period_type, total_amount
└── status-actions.tsx    # Buttons for next-legal transitions on detail page (Activate, Complete, Cancel) based on current status
```

### Lib update — `apps/frontend/portal/src/lib/api.ts`
Add `export const rentalsApi = createRentalsApi(api);`

### Sidebar
Add a "Rentals" entry to the portal dashboard sidebar, between "Vehicles" and "Customers".

### Pattern
Same as vehicles / customers — local `useState` + `useEffect`, no React Query, shadcn UI only.

### shadcn components needed
Already in `@drive247/ui`: Button, Input, Label, Card, Badge, Table, Dialog, Select, Separator, DropdownMenu. Nothing new.

*Combobox / search popover* — we'll build `customer-picker.tsx` and `vehicle-picker.tsx` as simple controlled Input + dropdown list (no new shadcn components needed for Phase 1).

---

## Implementation Order

### Step 1 — Shared schema + types
- [ ] Add `rentalStatusEnum` and `rentalPeriodTypeEnum` to `packages/database/src/schema/enums.ts`
- [ ] Create `packages/database/src/schema/rentals.ts` with CHECK constraint + two FKs
- [ ] Create `packages/database/src/zod/rentals.ts`
- [ ] Update schema + zod barrel exports
- [ ] Add `RentalStatus`, `RentalPeriodType` enums to `@drive247/shared-types`
- [ ] Create `packages/shared-types/src/rentals.types.ts` + barrel

### Step 2 — Migration
- [ ] `pnpm db:generate`
- [ ] Inspect SQL (two enums, CHECK, both FKs with RESTRICT)
- [ ] `pnpm db:migrate`

### Step 3 — API client
- [ ] `packages/api-client/src/rentals.api.ts`
- [ ] Barrel export

### Step 4 — Backend module
- [ ] `rentals.service.ts` — list (with join), get, create (+ conflict check), update (+ re-conflict-check, + terminal-status guard), transition (+ rules), remove; private `assertNoConflict()` and `assertCanTransition()`
- [ ] DTOs: `create`, `update`, `transition`, `list`
- [ ] `rentals.controller.ts` (roles per table above, `PATCH /:id/status`)
- [ ] `rentals.module.ts`
- [ ] Wire into `app.module.ts`
- [ ] Rebuild `@drive247/database` + `@drive247/shared-types` dist

### Step 5 — Postman tests
- [ ] Create valid → 201
- [ ] Create with customer from a different tenant → 404
- [ ] Create with vehicle from a different tenant → 404
- [ ] Create with inactive vehicle → 400
- [ ] Create overlapping (same vehicle, overlapping range, status=pending) → 409
- [ ] Create overlapping with a `cancelled`/`completed` rental → 201 (excluded from conflict check)
- [ ] Create same-day back-to-back (end May 10 ↔ start May 10) → 409 (documented policy)
- [ ] Update to shift dates into an overlap → 409
- [ ] Update a `completed` rental → 409
- [ ] Transition pending → cancelled → 200
- [ ] Transition cancelled → active → 409 (terminal)
- [ ] Transition active → completed → 200
- [ ] List with search, status, customerId, vehicleId filters → correct results
- [ ] Delete → 204; subsequent GET → 404
- [ ] Role checks (viewer read-only; ops can mutate but not delete)

### Step 6 — Frontend wiring
- [ ] `rentalsApi` in `lib/api.ts`
- [ ] Add `/rentals` to sidebar

### Step 7 — Frontend pages & components
- [ ] `components/rentals/customer-picker.tsx`
- [ ] `components/rentals/vehicle-picker.tsx` (with live conflict warning once dates are filled)
- [ ] `components/rentals/rental-form.tsx`
- [ ] `components/rentals/status-actions.tsx`
- [ ] `components/rentals/rentals-table.tsx`
- [ ] `app/(dashboard)/rentals/page.tsx`
- [ ] `app/(dashboard)/rentals/new/page.tsx`
- [ ] `app/(dashboard)/rentals/[id]/page.tsx`

### Step 8 — End-to-end
- [ ] Login as tenant user
- [ ] Create customer + vehicle (if tenant is empty)
- [ ] Create rental via UI, verify conflict warning blocks overlapping booking
- [ ] Transition pending → active → completed via UI buttons
- [ ] Verify terminal statuses disable edit button
- [ ] Verify tenant isolation (second tenant cannot see rentals from the first)

---

## Notes

- **Naming**: table is `rentals` (matches V1). "Booking" is a lifecycle stage (`status = 'pending'`), not a separate table.
- **No rental_number**: UUID is the only identifier in Phase 1. Readable number generator can come later as a column + sequence.
- **Amount is manual**: user enters `total_amount`. Auto-calc (tier × duration × surcharges) is a separate follow-up feature. Keeps Phase 1 honest — we're not pretending to price yet.
- **Conflict rule**: pending+active rentals block each other; completed/cancelled do not. Inclusive boundaries on both dates (same-day turnover NOT allowed in Phase 1).
- **RESTRICT on FKs**: deleting a customer or vehicle with rental history is blocked by the DB. Portal UI surfaces the error as "Cannot delete — has rental history" and offers the deactivate path instead.
- **Status separate from update**: mutating `status` via generic `PATCH /:id` is not allowed. Use `PATCH /:id/status` with the guard rules — makes intent explicit in logs and lets future workflow events (e.g., "ActivatedRental" audit entry) hook in cleanly.
- **No notes/timeline field yet** — we'll add an `audit_logs` entry per transition later; for now the absence is deliberate.
- **Update doc**: mark feature #8 "Booking flow (Phase 1)" in `MIGRATION_GUIDE.md` as in progress / done as we go.
