# Finances — one tab for payments, invoices, fines and payment plans (slice 2)

**Status:** Sep 25 2026, branch `haseeb/payment-unification`. Spec §7 ("merge
the payments, invoices and fines tabs … the merged tab's name will be
Finances"), with §5.2 (Stripe identity), §5.3 (reconcile, no blockers), §5.4
(show the math) and §8 (how much does this customer owe me) folded in. Slice 1
(payment plans) is `docs/PAYMENT_PLANS_DESIGN.md`.

**The one idea:** organise by the operator's four questions, not by the three
tables — *What am I owed? What came in? What's coming? What needs me?*

**Safety rule for this slice: no new money-writing path.** Every action on the
page reuses an existing, already-live mutation (record payment, refund, send a
link, approve/reject, add a fine) or a slice-1 payment-plan action. Finances is
a new way of LOOKING at the money, not a new way of moving it.

---

## 1. Rollout

- **Canary only:** a `finances` v2 area, `northwind` by **slug**, and **not**
  widened by `tenants.portal_experience = 'v2'` (real v2 tenants — nasir, squad,
  self-serve signups — keep their three tabs until this is reviewed on
  northwind). Every other tenant sees nothing change; prove it with a test.
- **Sidebar (canary):** the Payments, Invoices and Fines rows become one
  **Finances** row (`/finances`). The customiser's stored preferences may still
  name the old hrefs — they must not produce ghost rows or hide Finances.
- **Old routes (canary):** `/payments` → `/finances?view=received`,
  `/invoices` → `/finances?view=billed`, `/fines` → `/finances?view=fines`.
  Detail routes (`/payments/[id]`, `/fines/[id]`, `/fines/new`, analytics)
  are untouched. Trax deep links keep working.
- **Permissions:** managers keep their three existing keys — no
  `manager_permissions` migration. `/finances` is reachable when the manager
  holds **any** of `payments` / `invoices` / `fines` (the `ROUTE_ALSO_ALLOWED_BY`
  pattern in `lib/permissions.ts`); each view shows only when its key is held
  (Received ← payments, Billed ← invoices, Fines ← fines, Upcoming ← payments).
  Read-only (`viewer`) grants hide the actions, never the numbers.

## 2. Layout (top to bottom)

1. **Header** — "Finances", one line of description, actions: Send payment
   link · Record payment · Export. (Add fine lives on the Fines view.)
2. **Math strip** — four cards, each a **filter** (clicking one filters the
   list to exactly the rows that make its number):
   **Outstanding** (+ "N customers") · **Overdue** (+ "N rentals") ·
   **Collected** in the chosen period (+ count, and "Refunded $X" when non-zero) ·
   **Upcoming · 7 days** (+ count, "N auto · N links").
3. **Needs attention** — rendered only when non-empty. Each item: what
   happened, in words, and its one-click fixes (§4).
4. **View switch** — Billed · Received · Upcoming · Fines (only the views the
   user may see), one **shared filter bar**: search (customer, rental, vehicle,
   **Stripe/Square reference**), status, method, period (Today · 7 days · This
   month · All · custom).
5. **Table** — v2 list kit (`ListTable` …), indigo header, text-only status.
6. **Side panel** — any row opens it: the whole story of that money (§5).

Mobile: cards stack two-up, rows collapse to their key facts, the side panel is
a full-screen sheet. No horizontal page scroll.

## 3. Definitions — every number is defined once

All money is integer cents in the model. Dates are the **tenant's** local
calendar (`tenants.timezone`), never UTC.

- **Outstanding** — the tenant-wide sum of exactly what `useCustomerBalance`
  computes per customer (`hooks/use-customer-balance.ts:67`): ledger `Charge`
  rows' `remaining_amount`, excluding cancelled/rejected rentals and PAYG
  rentals, counting a `Rental` charge only once its `due_date` ≤ today, plus
  open PAYG accruals. **Extract that reducer into
  `lib/finances/balance.ts` and make the hook call it** (behaviour-preserving;
  a parity test runs old and new on the same fixtures), so the customer page,
  the rental page and Finances can never disagree.
- **Overdue** — the part of Outstanding on charges whose `due_date` < today.
- **Collected (period)** — payments with `payment_type 'Payment'`, status ∈
  Applied/Credit/Partial/Completed/Partial Refund, **not** `requires_capture`
  (the `CAPTURED_CREDIT_STATUSES` rule — a placeholder link row is not money),
  `payment_date` in the period; net of `refund_amount`. Refunded is shown
  beside it, not netted silently.
- **Upcoming (7 days)** — open `payment_plan_occurrences` (scheduled / due /
  partially_paid / failed with a retry) due in the next 7 days, remaining
  amount. Hidden when the payment-plan tables are absent.
- **Bill** (the Billed view) — ledger charges grouped per rental: one bill for
  the booking's own charges, one per extension (`extension_id`). It is built
  from the **ledger**, not the `invoices` table: that table is only written at
  non-PAYG booking time, so links, charges and extensions never reach it. The
  invoice number is shown when an `invoices` row exists for the rental.
  Columns: **Total · Paid · Credited · Balance**, where Total = Σ positive
  charge amounts, Paid = Σ `payment_applications.amount_applied` on them,
  Credited = Σ |negative charge amounts| (adjustments), Balance = Σ
  `remaining_amount`. **Tie-out:** when Total − Paid − Credited ≠ Balance (the
  15 drifted charges measured Sep 25), the row shows *"Doesn't add up by
  $X"* instead of quietly showing a number.
- **Status in words** — Paid · Open · "12 days overdue" · "In credit $X".

### 3.1 Hand-derived fixture (acceptance test for the bill math)

Rental R1 (due dates all in the past): Rental 500.00 (remaining 0, applied
500.00) · Tax 50.00 (remaining 20.00, applied 30.00) · Adjustment −20.00
(remaining −20.00). Extension E1 on R1: Extension Rental 200.00 (remaining
200.00, applied 0).

| bill | Total | Paid | Credited | Balance | ties out |
|---|---|---|---|---|---|
| R1 · Booking | 55000 | 53000 | 2000 | 0 | yes |
| R1 · Extension #1 | 20000 | 0 | 0 | 20000 | yes |

Outstanding for R1's customer = 0 + 2000 − 2000 + 20000 = **20000**.
Drift case: one charge 100.00, remaining 0, no applications → Total 10000,
Paid 0, Credited 0, Balance 0 → **doesn't add up by 10000**.

## 4. Needs attention — each item with its fix

| kind | when | fix actions (existing paths only) |
|---|---|---|
| card declined | a plan occurrence `failed` | Send link · Retry · Record payment (slice-1 actions) |
| needs the customer | a plan occurrence `requires_action` | Send link · Record payment |
| awaiting review | a payment with `verification_status = 'pending'` | Approve · Reject (the existing Payments flow) |
| possible duplicate | ≥ 2 captured payments, same rental, same amount, same `payment_date` | Review → side panel listing them, with Refund on each |
| unapplied credit | captured `Credit`/`Partial` payment with `remaining_amount` > 0 | Open the customer / rental where it can be applied |

Sorted by money at stake. Lost/stolen/fraud decline codes are never shown in
words (`customerSafeReason`).

## 5. The side panel

- **Payment:** amount · method · date · status · **provider reference + dashboard
  link** via `lib/payment-plans-ui/dashboard-link.ts` (a verified URL or a
  plain-English route, never a guessed or `/connect/` URL) · **Paid off**: each
  charge it was applied to (category, rental, amount) from
  `payment_applications` · unapplied remainder · plan context ("Payment 2 of 5")
  · who recorded it and when · Refund / Partial refund (existing refund dialog).
- **Bill:** every line (category, amount, remaining, due) · the payments that
  settled it · Total − Paid − Credited = Balance written out · Send payment
  link · Record payment.
- **Upcoming:** the plan's schedule with this payment highlighted · the plan's
  row actions.
- **Fine:** the existing fine detail.

## 6. Data loading — correctness rules

- **Never compute a total from a truncated result.** PostgREST caps a select at
  1,000 rows by default; a busy tenant (GMT: 301 extensions alone) passes that.
  Page with `.range()` until exhausted, or aggregate in SQL. A test must prove a
  1,001-row fixture is summed completely.
- Every query is tenant-scoped (`tenant_id = tenant.id`) and keyed
  `["finances", tenant.id, …]`; `enabled: !!tenant && financesOn`.
- `{ error }` is checked on every call; an error shows an error state, never
  a zero.
- Category strings are exact: ledger fines are `'Fine'` (singular).

## 7. Out of scope for this slice

The same views scoped to a rental and to a customer (slice 2b — the components
are built scope-ready: every hook takes an optional `{ rentalId, customerId }`)
· two-way balance adjustments and off-platform credit (§8, needs the lead's
revenue decision) · auto-extend renewals in Upcoming (slice 3) · moving the
detail pages.

## 8. Ownership

| agent | owns |
|---|---|
| **Finances model** | `apps/portal/src/lib/finances/**` (pure: types, `balance.ts`, bills, receipts, stats, attention, filters) · `apps/portal/src/hooks/use-finances*.ts` · the behaviour-preserving refactor of `hooks/use-customer-balance.ts` to call `balance.ts` · their tests |
| **Finances UI** | `apps/portal/src/app/(dashboard)/finances/**` · `apps/portal/src/components/finances/**` · the `finances` v2 area · sidebar + redirects + `lib/permissions.ts` entries · Trax catalogue · their tests |
| **Plans safety** | slice-1 fixes (below) in the payment-plans SQL, engine, memory store, manage function, UI entry and their tests |

### 8.1 Pinned model API (the UI builds against this)

```ts
// apps/portal/src/lib/finances/types.ts
export type FinanceView = "billed" | "received" | "upcoming" | "fines";
export type Period = "today" | "7d" | "month" | "all" | { from: string; to: string };
export interface FinanceScope { rentalId?: string; customerId?: string }
export interface FinanceFilters { search?: string; statuses?: string[]; methods?: string[]; period: Period; card?: "outstanding" | "overdue" | "collected" | "upcoming" | null }
export interface FinanceStats { outstandingCents: number; outstandingCustomers: number; overdueCents: number; overdueRentals: number; collectedCents: number; collectedCount: number; refundedCents: number; upcomingCents: number; upcomingCount: number; upcomingAuto: number; upcomingLinks: number }
export interface BillLine { chargeId: string; category: string; amountCents: number; remainingCents: number; appliedCents: number; dueDate: string | null }
export interface BillRow { key: string; rentalId: string; rentalRef: string; extensionId: string | null; label: string; customerId: string; customerName: string; vehicleReg: string | null; invoiceNumber: string | null; issuedOn: string; dueOn: string | null; totalCents: number; paidCents: number; creditedCents: number; balanceCents: number; tiesOut: boolean; mismatchCents: number; status: "paid" | "open" | "overdue" | "credit"; overdueDays: number | null; lines: BillLine[] }
export interface ReceiptRow { paymentId: string; date: string; customerId: string; customerName: string; rentalId: string | null; rentalRef: string | null; vehicleReg: string | null; amountCents: number; refundedCents: number; unappliedCents: number; method: string | null; provider: "stripe" | "square" | "manual"; providerRef: string | null; providerMode: "test" | "live" | null; status: "approved" | "pending_review" | "rejected" | "refunded" | "partially_refunded" | "pending"; appliedTo: { chargeId: string; category: string; rentalRef: string | null; amountCents: number }[]; planLabel: string | null; occurrenceId: string | null }
export interface UpcomingRow { occurrenceId: string; planId: string; rentalId: string; rentalRef: string; customerId: string; customerName: string; dueDate: string; seqLabel: string; amountCents: number; method: "auto_charge" | "checkout_link" | "manual"; status: string }
export type AttentionKind = "card_declined" | "needs_customer" | "awaiting_review" | "possible_duplicate" | "unapplied_credit";
export interface AttentionItem { key: string; kind: AttentionKind; title: string; detail: string; amountCents: number; rentalId: string | null; customerId: string | null; paymentIds: string[]; occurrenceId: string | null }

// apps/portal/src/hooks/use-finances.ts
export function useFinances(filters: FinanceFilters, scope?: FinanceScope): {
  stats: FinanceStats | undefined; attention: AttentionItem[]; bills: BillRow[]; receipts: ReceiptRow[]; upcoming: UpcomingRow[];
  plansAvailable: boolean; isLoading: boolean; error: Error | null; refetch: () => void;
};
```
The Fines view reuses the existing fines list components.
