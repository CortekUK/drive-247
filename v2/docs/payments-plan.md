# Invoices & Payments — Phase 1 Plan

> The billing layer for Drive247: invoices tied to rentals (auto-created), manual invoices for standalone charges, manual payments and refunds, tenant tax settings. Modelled directly on the ACRM spec — same logic, Drive247 terminology.

---

## Scope

### In
- Three new tables: `invoices`, `invoice_items`, `payments`
- Three new columns on `tenants`: `tax_rate`, `tax_label`, `tax_inclusive`
- One new column on `tenants`: `invoice_sequence` (per-tenant counter)
- **Auto-invoice** creation when a rental is created (status `DRAFT`, one line item `"Rental — {reg} ({dates})"` at `rental.total_amount`)
- **Manual invoice** creation (`rental_id = NULL` path) for standalone charges
- **Line items**: add / edit / remove (DRAFT only), per-item PERCENTAGE/FIXED discount
- **Invoice-level**: PERCENTAGE or FIXED discount, notes, due_date
- **Record payment** manually (CASH / CARD / BANK_TRANSFER, gateway = MANUAL)
- **Refund** a specific payment (manual; negative payment linked to original)
- **Void** invoice (only when no successful payments)
- Invoice numbering: `{TENANT_SLUG}-INV-{YEAR}-{0000}` continuous per tenant
- **Tax snapshot** at invoice creation (rate + label from tenant; supports `tax_inclusive` mode)
- Portal pages: invoices list + invoice detail (items + payments embedded) + manual-create form
- **Rental detail page**: Payment Summary card (invoice #, total, paid, due, status, "View invoice")
- **Customer detail page**: Financial Summary card (total invoiced, total paid, outstanding, last payment)
- **Customer list**: Outstanding Balance column (calculated)
- Tenant Settings page addition: tax configuration

### Out (deferred)
| Deferred | Why |
|----------|-----|
| Stripe online payments | Phase 2 — env keys + webhook module |
| Stripe refund API calls | Depends on Stripe integration |
| Overdue cron (BullMQ daily job) | Phase 2 — keep `OVERDUE` in enum but no auto-transition |
| `SENT` status | No email, no customer portal — nothing to "send" to |
| Dashboard stats cards | Separate feature (depends on finalized data flow) |
| PDF generation | Separate ticket — explicitly carved out in the ACRM spec |
| Email sending (invoice notifications) | Depends on notifications module |
| Customer self-serve "pay now" | Depends on customer portal |
| Invoice edit after any payment | Business rule — DRAFT only is editable |
| Late-fee auto-generation | Depends on overdue cron |
| Multi-currency | Single currency per tenant (GBP default) |

---

## File Structure (created/modified)

### New

```
v2/
├── docs/
│   └── payments-plan.md                                 ← THIS FILE
│
├── packages/
│   ├── database/src/
│   │   ├── schema/
│   │   │   ├── invoices.ts                              ← NEW
│   │   │   ├── invoice-items.ts                         ← NEW
│   │   │   └── payments.ts                              ← NEW
│   │   └── zod/
│   │       ├── invoices.ts                              ← NEW
│   │       ├── invoice-items.ts                         ← NEW
│   │       └── payments.ts                              ← NEW
│   │
│   ├── shared-types/src/
│   │   ├── invoices.types.ts                            ← NEW
│   │   └── payments.types.ts                            ← NEW
│   │
│   └── api-client/src/
│       ├── invoices.api.ts                              ← NEW
│       └── payments.api.ts                              ← NEW
│
└── apps/
    ├── backend/src/
    │   ├── database/migrations/
    │   │   └── 0005_<drizzle-generated>.sql             ← NEW (auto-gen)
    │   │
    │   └── modules/
    │       ├── invoices/
    │       │   ├── invoices.module.ts                   ← NEW
    │       │   ├── invoices.controller.ts               ← NEW
    │       │   ├── invoice-items.controller.ts          ← NEW
    │       │   ├── invoices.service.ts                  ← NEW (CRUD + recalc + numbering + auto-create)
    │       │   ├── invoice-items.service.ts             ← NEW
    │       │   └── dto/
    │       │       ├── create-invoice.dto.ts            ← NEW
    │       │       ├── update-invoice.dto.ts            ← NEW
    │       │       ├── list-invoices.dto.ts             ← NEW
    │       │       ├── create-invoice-item.dto.ts       ← NEW
    │       │       └── update-invoice-item.dto.ts       ← NEW
    │       │
    │       └── payments/
    │           ├── payments.module.ts                   ← NEW
    │           ├── payments.controller.ts               ← NEW
    │           ├── payments.service.ts                  ← NEW
    │           └── dto/
    │               ├── record-payment.dto.ts            ← NEW
    │               └── refund-payment.dto.ts            ← NEW
    │
    └── frontend/portal/src/
        ├── app/(dashboard)/
        │   ├── invoices/
        │   │   ├── page.tsx                             ← NEW (list + filters)
        │   │   ├── new/page.tsx                         ← NEW (manual create)
        │   │   └── [id]/page.tsx                        ← NEW (detail with items + payments)
        │   └── settings/                                ← NEW DIR (if not present)
        │       └── tax/page.tsx                         ← NEW (tax settings form)
        │
        └── components/invoices/
            ├── invoices-table.tsx                       ← NEW
            ├── invoice-form.tsx                         ← NEW (manual create; customer picker + items)
            ├── line-items-editor.tsx                    ← NEW (add / edit / remove lines, DRAFT only)
            ├── line-item-form.tsx                       ← NEW (inline form for one line)
            ├── invoice-totals-card.tsx                  ← NEW (subtotal / discount / tax / total / paid / due)
            ├── invoice-status-badge.tsx                 ← NEW
            ├── invoice-discount-form.tsx                ← NEW
            ├── record-payment-dialog.tsx                ← NEW
            ├── refund-payment-dialog.tsx                ← NEW
            └── void-invoice-dialog.tsx                  ← NEW
```

### Modified (existing)

```
packages/database/src/
├── schema/
│   ├── enums.ts                            ← ADD 6 enums
│   ├── tenants.ts                          ← ADD tax_rate, tax_label, tax_inclusive, invoice_sequence
│   └── index.ts                            ← EXPORT invoices, invoice-items, payments
└── zod/
    └── index.ts                            ← EXPORT new zod files

packages/shared-types/src/
├── enums.ts                                ← ADD InvoiceStatus, DiscountType, PaymentType, PaymentMethod, PaymentGateway, PaymentStatus
├── tenants.types.ts                        ← ADD tax + invoice_sequence fields to TenantDetail
├── customers.types.ts                      ← ADD outstandingBalance to CustomerListItem, CustomerFinancialsResponse
└── index.ts                                ← EXPORT invoices.types, payments.types

packages/api-client/src/
├── customers.api.ts                        ← ADD financials() method
├── tenants.api.ts                          ← ADD updateTax() method (super-admin context) OR separate settings endpoint
└── index.ts                                ← EXPORT createInvoicesApi, createPaymentsApi

apps/backend/src/
├── app.module.ts                           ← REGISTER InvoicesModule, PaymentsModule
└── modules/
    ├── rentals/rentals.service.ts          ← CALL InvoicesService.autoCreateForRental() after rental insert
    ├── rentals/rentals.module.ts           ← IMPORT InvoicesModule
    ├── customers/customers.service.ts      ← JOIN invoices for outstandingBalance in list; new financials() method
    └── tenants/tenants.service.ts          ← handle tax field updates (for tenant settings)

apps/frontend/portal/src/
├── lib/api.ts                              ← WIRE invoicesApi, paymentsApi
├── app/(dashboard)/
│   ├── layout.tsx                          ← ADD "Invoices" sidebar entry
│   ├── rentals/[id]/page.tsx               ← ADD Payment Summary card
│   ├── customers/page.tsx                  ← ADD Outstanding Balance column
│   └── customers/[id]/page.tsx             ← ADD Financial Summary card
```

---

## Database

### New enums — `packages/database/src/schema/enums.ts`

```ts
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'partially_paid',
  'paid',
  'overdue',
  'void',
  'refunded',
]);

export const discountTypeEnum = pgEnum('discount_type', [
  'percentage',
  'fixed',
]);

export const paymentTypeEnum = pgEnum('payment_type', [
  'payment',
  'refund',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'card',
  'bank_transfer',
]);

export const paymentGatewayEnum = pgEnum('payment_gateway', [
  'manual',
  'stripe',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'succeeded',
  'failed',
  'refunded',
]);
```

### Tenants table — add 4 columns

```
tenants (ALTER)
  + tax_rate          NUMERIC(5,2)  NOT NULL, default 0       -- e.g. 20.00 = 20%
  + tax_label         TEXT          NOT NULL, default 'Tax'   -- 'VAT', 'GST', etc.
  + tax_inclusive     BOOLEAN       NOT NULL, default false
  + invoice_sequence  INTEGER       NOT NULL, default 0       -- atomic per-tenant counter
```

### `invoices` table

```
invoices
  id                  UUID          PK, default random
  tenant_id           UUID          FK → tenants(id) ON DELETE CASCADE, NOT NULL
  rental_id           UUID          FK → rentals(id) ON DELETE SET NULL, nullable  (null = manual invoice)
  customer_id         UUID          FK → customers(id) ON DELETE RESTRICT, NOT NULL
  invoice_number      TEXT          NOT NULL
  status              ENUM          invoiceStatusEnum, NOT NULL, default 'draft'
  subtotal            INTEGER       NOT NULL, default 0           -- cents
  discount_type       ENUM          discountTypeEnum, nullable
  discount_value      INTEGER       nullable                      -- raw value (e.g. 10 for 10%, 5000 for £50)
  discount_amount     INTEGER       NOT NULL, default 0           -- calculated cents
  tax_rate            NUMERIC(5,2)  NOT NULL, default 0           -- snapshot
  tax_label           TEXT          NOT NULL, default 'Tax'       -- snapshot
  tax_inclusive       BOOLEAN       NOT NULL, default false       -- snapshot
  tax_amount          INTEGER       NOT NULL, default 0           -- calculated cents
  total_amount        INTEGER       NOT NULL, default 0           -- cents
  amount_paid         INTEGER       NOT NULL, default 0           -- cents, auto-maintained
  amount_due          INTEGER       NOT NULL, default 0           -- cents, auto-maintained
  due_date            DATE          NOT NULL
  notes               TEXT          nullable
  created_at          TIMESTAMPTZ   NOT NULL, default now()
  updated_at          TIMESTAMPTZ   NOT NULL, default now()

  UNIQUE (tenant_id, invoice_number)
```

### `invoice_items` table

```
invoice_items
  id                UUID          PK, default random
  tenant_id         UUID          FK → tenants(id) ON DELETE CASCADE, NOT NULL
  invoice_id        UUID          FK → invoices(id) ON DELETE CASCADE, NOT NULL
  description       TEXT          NOT NULL                -- snapshot
  quantity          INTEGER       NOT NULL, default 1
  unit_price        INTEGER       NOT NULL                -- cents, snapshot
  discount_type     ENUM          discountTypeEnum, nullable
  discount_value    INTEGER       nullable
  discount_amount   INTEGER       NOT NULL, default 0     -- calculated cents
  line_total        INTEGER       NOT NULL                -- (quantity × unit_price) − discount_amount
  created_at        TIMESTAMPTZ   NOT NULL, default now()

  CHECK (quantity > 0)
  CHECK (unit_price >= 0)
```

### `payments` table

```
payments
  id                      UUID          PK, default random
  tenant_id               UUID          FK → tenants(id) ON DELETE CASCADE, NOT NULL
  invoice_id              UUID          FK → invoices(id) ON DELETE RESTRICT, NOT NULL
  type                    ENUM          paymentTypeEnum, NOT NULL
  amount                  INTEGER       NOT NULL              -- cents (positive = payment, negative = refund)
  payment_method          ENUM          paymentMethodEnum, NOT NULL
  payment_gateway         ENUM          paymentGatewayEnum, NOT NULL  -- Phase 1: only 'manual'
  gateway_transaction_id  TEXT          nullable                       -- Stripe pi_* (Phase 2)
  linked_payment_id       UUID          FK → payments(id) ON DELETE SET NULL, nullable  -- refund → original
  status                  ENUM          paymentStatusEnum, NOT NULL
  notes                   TEXT          nullable
  paid_at                 TIMESTAMPTZ   NOT NULL
  created_at              TIMESTAMPTZ   NOT NULL, default now()
  updated_at              TIMESTAMPTZ   NOT NULL, default now()

  CHECK ((type = 'payment' AND amount > 0) OR (type = 'refund' AND amount < 0))
```

### FK delete behaviour summary

| FK | On delete | Why |
|---|---|---|
| `invoices.tenant_id → tenants` | CASCADE | Wipe everything when tenant is deleted |
| `invoices.rental_id → rentals` | SET NULL | Rental deletion detaches but preserves invoice history |
| `invoices.customer_id → customers` | RESTRICT | Can't delete customer with billing history |
| `invoice_items.invoice_id → invoices` | CASCADE | Items die with their invoice |
| `payments.invoice_id → invoices` | RESTRICT | Can't delete an invoice with payments — must refund first |
| `payments.linked_payment_id → payments` | SET NULL | Defensive: orphan refund records rather than block |

---

## Calculations

### Line total
```
line_total = quantity * unit_price - line_discount_amount

line_discount_amount (if discount_type present):
  PERCENTAGE: (quantity * unit_price) * discount_value / 100
  FIXED:      discount_value   (clamped to ≤ quantity * unit_price)
```

### Invoice totals
```
subtotal = SUM(line_total) across invoice_items

invoice_discount_amount:
  PERCENTAGE: subtotal * discount_value / 100
  FIXED:      discount_value   (clamped to ≤ subtotal)

pre_tax = subtotal - invoice_discount_amount

tax_amount:
  tax_rate = 0          → 0
  tax_inclusive = false → pre_tax * tax_rate / 100
  tax_inclusive = true  → pre_tax - round(pre_tax * 100 / (100 + tax_rate))
                          (the portion of pre_tax that is tax; total_amount stays = pre_tax)

total_amount:
  tax_inclusive = false → pre_tax + tax_amount
  tax_inclusive = true  → pre_tax
```

All intermediate division uses integer math with `Math.round` for consistency (banker's rounding avoided for simplicity; off-by-1p rounding is acceptable in Phase 1).

### Auto-maintained fields

After any payment / refund / item change, the service recomputes:
```
amount_paid = SUM(payments.amount WHERE status = 'succeeded')   -- negatives (refunds) naturally subtract
amount_due  = total_amount - amount_paid
status      = see Status Lifecycle below
```

---

## Status Lifecycle

Computed by the service after any mutation (line items, discount, payment, refund, void):

```
If status is 'void':           stays void (terminal)
If status is 'draft' AND no payments recorded: stays draft
If amount_paid == total_amount AND total_amount > 0: → paid
If amount_paid > 0 AND amount_paid < total_amount: → partially_paid
If amount_paid < 0 after refund (impossible under normal flow): error
If all payments fully refunded (amount_paid == 0 AND refunds issued): → refunded
```

No `SENT` in Phase 1 (no delivery mechanism yet).
`OVERDUE` stays in the enum but the cron job is deferred — service never transitions INTO `overdue` in Phase 1.

### Valid transitions

| From | To | Trigger |
|------|-----|---------|
| `draft` | `partially_paid` | first payment recorded |
| `draft` | `paid` | first payment fully covers total |
| `draft` | `void` | manual void (no payments) |
| `partially_paid` | `paid` | remaining payment |
| `partially_paid` | `refunded` | all paid amounts refunded |
| `paid` | `partially_paid` | partial refund |
| `paid` | `refunded` | full refund |

Edit locks: once status is anything other than `draft`, line items and invoice-level discount/notes can no longer be mutated. Voided and refunded are effectively terminal.

---

## Invoice Numbering

**Format:** `{TENANT_SLUG_UPPERCASE}-INV-{YYYY}-{0000}`
Examples: `DOGARR-INV-2026-0001`, `DOGARR-INV-2026-0042`, `DOGARR-INV-2027-0143`

**Sequence**: continuous per tenant. Year in the label reflects creation date; the counter never resets.

**Implementation**:
```sql
UPDATE tenants
SET invoice_sequence = invoice_sequence + 1
WHERE id = :tenantId
RETURNING invoice_sequence, slug;
```
Atomic row lock on `tenants` row. Compose number from result. Never reused, never repeated.

---

## Backend Modules

### InvoicesModule

**Routes** (`@RequireTenant()`, `ParseUUIDPipe` on `:id`):

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `GET` | `/api/invoices` | all 5 | list (filters: status, customerId, dateFrom, dateTo, search by invoice_number, page, limit) |
| `GET` | `/api/invoices/:id` | all 5 | detail (items + payments embedded) |
| `POST` | `/api/invoices` | head_admin, admin, manager, ops | create manual invoice |
| `PATCH` | `/api/invoices/:id` | head_admin, admin, manager, ops | update invoice-level fields (DRAFT only: discount, due_date, notes) |
| `DELETE` | `/api/invoices/:id` | head_admin | delete (DRAFT only, no payments) |
| `POST` | `/api/invoices/:id/void` | head_admin, admin | transition → VOID (no payments) |
| `POST` | `/api/invoices/:invoiceId/items` | head_admin, admin, manager, ops | add line item (DRAFT only) |
| `PATCH` | `/api/invoices/:invoiceId/items/:itemId` | head_admin, admin, manager, ops | update line item (DRAFT only) |
| `DELETE` | `/api/invoices/:invoiceId/items/:itemId` | head_admin, admin, manager, ops | remove line item (DRAFT only) |

**Service responsibilities:**
- `list(query)` — JOIN customer + rental basic refs; filters; pagination
- `getById(id)` — detail with items + payments embedded
- `create(input)` — manual invoice; customer must belong to tenant; optional rental must belong to tenant
- `update(id, patch)` — DRAFT only; invoice-level fields only; recalc totals
- `void(id)` — DRAFT / unpaid only
- `remove(id)` — DRAFT only, 0 payments; head_admin only (for dev cleanup)
- `addItem / updateItem / removeItem` — DRAFT only; recalc totals
- `autoCreateForRental(rental, tenantSnapshot)` — called from RentalsService; 1 line item from rental.total_amount
- `recalc(id)` — recompute subtotal → discount → tax → total → amount_paid → amount_due → status; atomic
- `nextInvoiceNumber(tenantId)` — atomic increment + slug prefix compose
- `assertEditable(invoice)` — throws if not DRAFT

### PaymentsModule

**Routes**:

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `POST` | `/api/invoices/:invoiceId/payments` | head_admin, admin, manager, ops | record payment |
| `POST` | `/api/invoices/:invoiceId/payments/:paymentId/refund` | head_admin, admin | refund a specific payment |

**Service responsibilities:**
- `record(invoiceId, input)` — validate invoice is active (not void/refunded); validate amount ≤ amount_due; insert payment (type=payment, gateway=manual, status=succeeded); InvoicesService.recalc(invoiceId)
- `refund(invoiceId, paymentId, input)` — validate original is succeeded (not already refunded); validate refund amount ≤ original amount; insert refund payment (type=refund, amount=negative, linked_payment_id=original); mark original status=refunded when fully refunded; InvoicesService.recalc

**Cross-module wiring**:
- `PaymentsModule` imports `InvoicesModule` to inject `InvoicesService` for `recalc()`
- `RentalsModule` imports `InvoicesModule` to inject `InvoicesService` for `autoCreateForRental()`

---

## DTOs

### Invoices
```ts
// create-invoice.dto.ts — MANUAL invoice
{
  customerId: uuid,
  rentalId: uuid | null,       // optional link (usually null)
  dueDate: ISO date,
  notes?: string,
  discountType?: 'percentage' | 'fixed',
  discountValue?: number (integer, raw value),
  items: [                      // at least 1 item required
    {
      description: string (1..200),
      quantity: integer >= 1,
      unitPrice: integer >= 0,  // cents
      discountType?: 'percentage' | 'fixed',
      discountValue?: integer,
    },
    ...
  ]
}

// update-invoice.dto.ts — DRAFT only
{
  dueDate?: ISO date,
  notes?: string | null,
  discountType?: 'percentage' | 'fixed' | null,
  discountValue?: integer | null,
}

// list-invoices.dto.ts
{ search?, status?, customerId?, rentalId?, dateFrom?, dateTo?, page?, limit? }
```

### Items
```ts
// create-invoice-item.dto.ts
{ description, quantity, unitPrice, discountType?, discountValue? }

// update-invoice-item.dto.ts — partial of create, at-least-one refine
```

### Payments
```ts
// record-payment.dto.ts
{
  amount: integer > 0,              // cents
  paymentMethod: 'cash' | 'card' | 'bank_transfer',
  paidAt?: ISO datetime (default: now),
  notes?: string,
}

// refund-payment.dto.ts
{
  amount: integer > 0,              // cents (service negates)
  notes?: string,
}
```

---

## Auto-invoice on Rental Create

When `POST /api/rentals` succeeds, `RentalsService.create()` additionally calls:

```ts
await this.invoicesService.autoCreateForRental(rental);
```

`autoCreateForRental(rental)`:
1. Load tenant (slug, tax_rate, tax_label, tax_inclusive)
2. Convert `rental.total_amount` (NUMERIC in pounds) to integer cents: `Math.round(Number(rental.totalAmount) * 100)`
3. Acquire next invoice number
4. Insert invoice with status=DRAFT, tax snapshot from tenant, due_date = rental.start_date, 0 amount_paid
5. Insert 1 invoice_item: description = `"Rental — {reg} ({startDate} to {endDate})"`, quantity=1, unit_price=cents
6. Recalc totals
7. Return the invoice

Failure isolation: if invoice creation fails after rental creation, the rental is already persisted. For Phase 1 accept this edge case (re-run manually). Phase 2: wrap in a transaction.

---

## Customer Outstanding Balance

### List column (extend existing customers list)
Aggregate via LEFT JOIN in `customers.service.ts`:
```sql
LEFT JOIN (
  SELECT customer_id, SUM(amount_due) AS balance
  FROM invoices
  WHERE tenant_id = :tenantId AND status NOT IN ('void', 'refunded')
  GROUP BY customer_id
) b ON b.customer_id = customers.id
```
Add `outstandingBalance: number | null` to `CustomerListItem`.

### Detail card (new endpoint)
`GET /api/customers/:id/financials` → `CustomerFinancialsResponse`:
```ts
{
  totalInvoiced: number,    // SUM(total_amount) non-void
  totalPaid: number,        // SUM(amount_paid) non-void
  outstanding: number,      // SUM(amount_due) non-void-non-refunded
  lastPaymentAt: string | null,
}
```

---

## Frontend

### Sidebar
Add "Invoices" entry between Rentals and Users.

### Invoices list page (`/invoices`)

- Header: title + `[+ Manual Invoice]` button → `/invoices/new`
- Filter row: status select, date range (from / to), customer picker, search-by-number
- Table: `#`, Customer, Rental (link if present), Date, Total, Paid, Due, Status

### Invoice detail page (`/invoices/[id]`)

- Header: invoice number + status badge
- Action bar (conditional on status):
  - `[Void]` — DRAFT + no payments
  - `[Delete]` — DRAFT + no payments (head_admin only)
- Info row: Customer (link), Rental (link or "—")
- **Line Items section** (editable only when DRAFT):
  - Table with inline add / edit / remove
- **Invoice-level discount** (editable only when DRAFT)
- **Totals card**: Subtotal, Discount, Tax, Total, Paid, Due
- **Payments section**:
  - Table: Date, Amount, Method, Gateway, Status, Notes, Actions (`Refund` button on each succeeded payment — head_admin/admin)
  - `[+ Record Payment]` — disabled for void / fully-paid / refunded
- **Notes**

### Manual invoice form (`/invoices/new`)
- Customer picker
- (Optional) Rental picker limited to that customer's rentals
- Due date
- Line items editor (at least one required)
- Invoice-level discount
- Notes
- Submit → creates DRAFT invoice → redirects to detail

### Rental detail update
Add Payment Summary card near top:
```
Invoice: DOGARR-INV-2026-0042   [View]
Total:   £480.00
Paid:    £100.00
Due:     £380.00
Status:  PARTIALLY PAID
```
If no invoice yet (rare — shouldn't happen with auto-create): hide card.

### Customer list update
Add `Outstanding Balance` column. Right-aligned currency.

### Customer detail update
Add Financial Summary card (Total Invoiced, Total Paid, Outstanding, Last Payment).

### Tenant tax settings (portal)
New `/settings/tax` page (or addition to existing settings if present):
- tax_rate (number, 0–100, 2 decimals)
- tax_label (text, default 'VAT')
- tax_inclusive (toggle)
- Help text: "These apply to new invoices only. Existing invoices keep the rate they were created with."

---

## Business Rules (non-negotiable)

1. **Every query filters by `tenant_id`.** No exceptions.
2. **All money is INTEGER cents.** Never floats.
3. **Balances are always calculated**, never stored as standalone values on customers.
4. **Snapshots are immutable**: description, unit_price, tax_rate, tax_label, tax_inclusive — frozen at invoice creation.
5. **DRAFT is the only editable state**. Any status beyond draft locks line items, discount, and tax.
6. **Void requires zero payments.** Refund first, then void if desired.
7. **Refund = new payment with negative amount** linked to original; never mutate the original amount.
8. **Stripe integration is NOT in this phase.** Payment gateway is always `manual`.
9. **Invoice numbers never repeat, never reuse** — even for void/refunded invoices.
10. **Auto-invoice on rental create** — always, with the one-line-item shape.

---

## Implementation Order

### Step 1 — Shared schema + types (packages)
- [ ] Add 6 enums to `schema/enums.ts`
- [ ] Extend `schema/tenants.ts`: `tax_rate`, `tax_label`, `tax_inclusive`, `invoice_sequence`
- [ ] Create `schema/invoices.ts`, `schema/invoice-items.ts`, `schema/payments.ts` with FKs + CHECKs
- [ ] Create matching `zod/*.ts` files
- [ ] Update barrel exports
- [ ] Add 6 TS enums to `shared-types/enums.ts`
- [ ] Create `shared-types/invoices.types.ts`, `payments.types.ts`
- [ ] Extend `shared-types/tenants.types.ts` and `customers.types.ts`
- [ ] Barrel export

### Step 2 — Migration
- [ ] `pnpm db:generate` — inspect SQL (6 enums, 4 new tenant cols, 3 new tables, all FKs + CHECKs)
- [ ] `pnpm db:migrate`
- [ ] Rebuild `@drive247/database` + `@drive247/shared-types` dist

### Step 3 — API client
- [ ] `packages/api-client/src/invoices.api.ts`
- [ ] `packages/api-client/src/payments.api.ts`
- [ ] Extend `customers.api.ts` with `financials()`
- [ ] Extend `tenants.api.ts` with tax settings endpoint (if needed)
- [ ] Barrel export

### Step 4 — Backend: InvoicesModule
- [ ] DTOs (5 files)
- [ ] `invoices.service.ts` — CRUD, recalc, numbering, auto-create stub
- [ ] `invoice-items.service.ts` — add/update/remove with recalc call
- [ ] `invoices.controller.ts` — all invoice endpoints
- [ ] `invoice-items.controller.ts` — nested item endpoints
- [ ] `invoices.module.ts`
- [ ] Wire into `app.module.ts`

### Step 5 — Backend: PaymentsModule
- [ ] DTOs (2 files)
- [ ] `payments.service.ts` — record + refund (injects InvoicesService)
- [ ] `payments.controller.ts`
- [ ] `payments.module.ts` (imports InvoicesModule)
- [ ] Wire into `app.module.ts`

### Step 6 — Backend: wire auto-invoice into rentals
- [ ] `RentalsModule` imports `InvoicesModule`
- [ ] `RentalsService.create()` calls `invoicesService.autoCreateForRental(rental)` after insert
- [ ] Update tests / verify with Postman

### Step 7 — Backend: customer financials
- [ ] Extend `customers.service.list()` with invoice LEFT JOIN → `outstandingBalance`
- [ ] Add `customers.service.getFinancials(id)`
- [ ] Add `GET /api/customers/:id/financials` endpoint

### Step 8 — Backend: tenant tax settings endpoint
- [ ] Extend `tenants.service.update()` to accept tax fields (or add dedicated settings endpoint in portal-appropriate place)
- [ ] Confirm role check (tenant-scoped head_admin only — not super-admin-only)

### Step 9 — Postman tests
- [ ] Create rental → auto-invoice appears (status=DRAFT, 1 line item)
- [ ] List invoices with filters
- [ ] Manual invoice create with 2 line items + invoice discount
- [ ] Add / update / remove line item on DRAFT → totals recompute
- [ ] Attempt to edit after first payment → 409 (locked)
- [ ] Record partial payment → status partially_paid
- [ ] Record remaining payment → status paid
- [ ] Refund partial → status back to partially_paid
- [ ] Refund remaining → status refunded
- [ ] Void DRAFT unpaid → succeeds
- [ ] Void invoice with payments → 409
- [ ] Delete invoice with payments → 409
- [ ] Customer financials endpoint returns correct totals
- [ ] Outstanding balance column correct for list
- [ ] Invoice number format correct, per-tenant, sequential

### Step 10 — Frontend: API wiring + sidebar
- [ ] `invoicesApi`, `paymentsApi` in `lib/api.ts`
- [ ] Sidebar "Invoices" entry

### Step 11 — Frontend: invoices pages
- [ ] `components/invoices/invoice-status-badge.tsx`
- [ ] `components/invoices/invoices-table.tsx`
- [ ] `components/invoices/line-item-form.tsx`
- [ ] `components/invoices/line-items-editor.tsx`
- [ ] `components/invoices/invoice-discount-form.tsx`
- [ ] `components/invoices/invoice-totals-card.tsx`
- [ ] `components/invoices/record-payment-dialog.tsx`
- [ ] `components/invoices/refund-payment-dialog.tsx`
- [ ] `components/invoices/void-invoice-dialog.tsx`
- [ ] `components/invoices/invoice-form.tsx` (manual create)
- [ ] `app/(dashboard)/invoices/page.tsx`
- [ ] `app/(dashboard)/invoices/new/page.tsx`
- [ ] `app/(dashboard)/invoices/[id]/page.tsx`

### Step 12 — Frontend: cross-feature additions
- [ ] Rental detail page: Payment Summary card
- [ ] Customer list: Outstanding Balance column
- [ ] Customer detail: Financial Summary card
- [ ] Tenant settings: tax configuration page

### Step 13 — End-to-end browser test
- [ ] Login, create rental → auto-invoice appears
- [ ] Open invoice, add damage-fee line item while DRAFT, verify totals
- [ ] Record partial payment → status flips
- [ ] Record remainder → status paid
- [ ] Refund one payment → amounts + status correct
- [ ] Create manual invoice with custom line items and discount
- [ ] Void an unpaid DRAFT
- [ ] Verify tenant isolation with second tenant

---

## Notes

- **Money conversion between rentals and invoices** — rentals store `NUMERIC(12,2)` (pounds), invoices store INTEGER cents. `autoCreateForRental` multiplies by 100 with `Math.round`. A future migration can align both to cents; out of scope for this feature.
- **Tax snapshot mechanism** — `invoices.tax_rate / tax_label / tax_inclusive` are *copied* from `tenants.*` at creation time. Changing tenant tax settings later does NOT retroactively update existing invoices.
- **Concurrency on invoice_sequence** — the `UPDATE ... RETURNING` atomic increment is collision-proof. No explicit transaction needed; row-level lock does it.
- **Recalc is idempotent** — calling `invoicesService.recalc(id)` any number of times produces the same result. Safe to call liberally after any mutation.
- **Payment `amount` is always positive in the DTO**; the service multiplies by `-1` when recording a refund. DB CHECK enforces the invariant.
- **`OVERDUE` in enum but unreachable in Phase 1** — keeps future cron implementation a single-line status transition; no enum migration needed later.
- **`SENT` deliberately omitted** — reintroduces cleanly in Phase 2 when email / customer portal is built.
- **Update `MIGRATION_GUIDE.md`** feature tracker: mark Payments (Phase 1) as in progress / done as we go.
