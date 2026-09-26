/**
 * The customer balance rule — ONE copy, shared by `hooks/use-customer-balance.ts`
 * (the customer page, the Add Payment dialog) and Finances, so the three can
 * never disagree about what a customer owes. Pure: no React, no Supabase.
 *
 * The rule (extracted verbatim from use-customer-balance.ts; a parity test runs
 * the original inline code and these functions over the same fixtures):
 *
 *   Outstanding = Σ `remaining_amount` on ledger `Charge` rows, skipping
 *     - charges on the customer's cancelled (`status = 'Cancelled'`) or rejected
 *       (`approval_status = 'rejected'`) rentals,
 *     - charges on the customer's pay-as-you-go rentals (their outstanding is the
 *       open `payg_accruals` instead — both describe the same unpaid day, so
 *       counting both double-counts),
 *     - a `Rental` charge whose `due_date` is after today (not yet due).
 *     Every other charge counts regardless of due date — fines, fees, negative
 *     adjustments, the Security Deposit charge.
 *   + open PAYG accrual day-totals (daily_rate + tax_amount + service_fee_amount)
 *     on the customer's non-closed PAYG rentals, skipping cancelled/rejected ones.
 *
 *   Credit = Σ `remaining_amount` on payments whose status is Applied, Credit or
 *     Partial and whose capture_status is not 'requires_capture'. A Stripe hold
 *     awaiting capture is not money (a $147 debtor once read as $1,577 in credit).
 *
 * The dollar functions (`sumLedgerBalance`, `summarizeCustomerLedger`,
 * `sumAvailableCredit`, `sumPaygAccruals`) keep the hook's exact arithmetic —
 * same order of additions on the same floats — so its results are identical.
 * Finances uses the same predicates with `toCents` per row.
 */

import { parseLocalDate } from "@/lib/date-utils";
import { todayInZone } from "@/lib/payment-plans-ui/format";

/** Payment statuses whose unapplied remainder is real, captured money. */
export const CAPTURED_CREDIT_STATUSES = ["Applied", "Credit", "Partial"];

/**
 * What "today" means. With neither `today` nor `timeZone` → the browser's local
 * calendar, compared exactly as the hook always has. `today` (a 'YYYY-MM-DD'
 * day already resolved in the tenant's zone) wins over `timeZone`.
 */
export interface BalanceClock {
  now: Date;
  timeZone?: string | null;
  today?: string | null;
}

export interface BalanceChargeLike {
  type?: string | null;
  amount?: any;
  remaining_amount?: any;
  due_date?: string | null;
  category?: string | null;
  rental_id?: string | null;
}

export interface BalancePaymentLike {
  status?: string | null;
  capture_status?: string | null;
  remaining_amount?: any;
}

export interface BalanceAccrualLike {
  rental_id?: string | null;
  daily_rate?: any;
  tax_amount?: any;
  service_fee_amount?: any;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `numeric` dollar column (number or string) → integer cents. The ONE dollars→cents boundary. */
export function toCents(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const nowClock = (): BalanceClock => ({ now: new Date() });

/**
 * A `Rental` charge dated after today is not yet due. Other categories are
 * always due. With a `timeZone`, "today" is that zone's calendar day; without
 * one it is exactly the hook's `parseLocalDate(due_date) > new Date()`.
 */
export function isNotYetDueRentalCharge(entry: BalanceChargeLike, clock: BalanceClock = nowClock()): boolean {
  if (entry.category !== "Rental" || !entry.due_date) return false;
  if (clock.today || clock.timeZone) {
    const day = String(entry.due_date).split("T")[0];
    if (ISO_DAY.test(day)) return day > (clock.today || todayInZone(clock.timeZone, clock.now));
  }
  return parseLocalDate(entry.due_date) > clock.now;
}

/**
 * Does this charge's `remaining_amount` count toward the customer's balance?
 * `excludedRentalIds` / `paygRentalIds` are the CUSTOMER's cancelled-or-rejected
 * and pay-as-you-go rentals — see `rentalSetsByCustomer`.
 */
export function chargeCountsTowardBalance(
  entry: BalanceChargeLike,
  excludedRentalIds: Set<string>,
  paygRentalIds: Set<string>,
  clock: BalanceClock = nowClock(),
): boolean {
  if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return false;
  if (entry.rental_id && paygRentalIds.has(entry.rental_id)) return false;
  if (isNotYetDueRentalCharge(entry, clock)) return false;
  return true;
}

/** `useCustomerBalance`'s ledger figure, in dollars, with the hook's exact arithmetic. */
export function sumLedgerBalance(
  entries: BalanceChargeLike[],
  excludedRentalIds: Set<string>,
  paygRentalIds: Set<string>,
  clock: BalanceClock = nowClock(),
): number {
  return entries.reduce((sum, entry) => {
    if (!chargeCountsTowardBalance(entry, excludedRentalIds, paygRentalIds, clock)) return sum;
    return sum + (entry.remaining_amount || 0);
  }, 0);
}

/** `useCustomerBalanceWithStatus`'s ledger pass, in dollars, with the hook's exact arithmetic. */
export function summarizeCustomerLedger(
  entries: BalanceChargeLike[],
  excludedRentalIds: Set<string>,
  paygRentalIds: Set<string>,
  clock: BalanceClock = nowClock(),
): { totalCharges: number; totalPayments: number; outstandingDebt: number } {
  let totalCharges = 0;
  let totalPayments = 0;
  let outstandingDebt = 0;
  entries.forEach((entry) => {
    if (entry.type === "Charge") {
      // Charges on cancelled/rejected rentals are not charges at all here.
      if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return;
      totalCharges += entry.amount;
      // PAYG rentals: payg_accruals is the authority, added by the caller.
      if (entry.rental_id && paygRentalIds.has(entry.rental_id)) return;
      if (isNotYetDueRentalCharge(entry, clock)) return;
      outstandingDebt += entry.remaining_amount || 0;
    } else if (entry.type === "Payment") {
      totalPayments += Math.abs(entry.amount);
    }
  });
  return { totalCharges, totalPayments, outstandingDebt };
}

/**
 * Captured, settled money — the only payments whose unapplied remainder is
 * credit. The status whitelist matches the booking app
 * (`.in('status', ['Applied','Credit','Partial'])`) and so excludes BOTH
 * uncaptured Stripe holds (status 'Pending' / capture_status 'requires_capture',
 * which carry remaining_amount = the full amount but are NOT money) AND the
 * Refunded/Cancelled rows reject-rental can leave with remaining_amount > 0.
 * Counting either inflated credit and — because net = debt − credit — could
 * flip a customer who owed money into a bogus "In Credit" (a $147 debtor shown
 * as ~$1,577 in credit from stale holds).
 */
export function isCapturedCredit(payment: BalancePaymentLike): boolean {
  if (!CAPTURED_CREDIT_STATUSES.includes(payment.status as string)) return false;
  // Belt-and-suspenders: a genuinely captured payment never keeps
  // capture_status='requires_capture', so a hold mislabeled with a
  // captured-looking status can't inflate credit either.
  if (payment.capture_status === "requires_capture") return false;
  return true;
}

/** `useCustomerBalanceWithStatus`'s available credit, in dollars, with the hook's exact arithmetic. */
export function sumAvailableCredit(payments: BalancePaymentLike[] | null | undefined): number {
  let availableCredit = 0;
  payments?.forEach((payment) => {
    if (!isCapturedCredit(payment)) return;
    availableCredit += payment.remaining_amount || 0;
  });
  return availableCredit;
}

/** One open PAYG accrual's day total, in dollars. */
export function paygAccrualDayTotal(a: BalanceAccrualLike): number {
  return Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0);
}

/** One open PAYG accrual's day total, in cents (each column converted on its own). */
export function paygAccrualCents(a: BalanceAccrualLike): number {
  return toCents(a.daily_rate) + toCents(a.tax_amount) + toCents(a.service_fee_amount);
}

/** Open PAYG accruals, in dollars, skipping cancelled/rejected rentals — the hook's exact arithmetic. */
export function sumPaygAccruals(accruals: BalanceAccrualLike[] | null | undefined, excludedRentalIds: Set<string>): number {
  let total = 0;
  accruals?.forEach((a) => {
    if (a.rental_id && excludedRentalIds.has(a.rental_id)) return;
    total += paygAccrualDayTotal(a);
  });
  return total;
}

/** The hook's `.or("status.eq.Cancelled,approval_status.eq.rejected")`, as a predicate. */
export function excludedRentalReason(r: { status?: string | null; approval_status?: string | null }): "cancelled" | "rejected" | null {
  if (r.status === "Cancelled") return "cancelled";
  if (r.approval_status === "rejected") return "rejected";
  return null;
}

export interface CustomerRentalSets {
  excluded: Set<string>;
  payg: Set<string>;
}

/**
 * Per customer, the two rental sets the hook builds with its per-customer
 * queries: cancelled-or-rejected rentals, and `is_pay_as_you_go = true`
 * rentals. Keyed by the RENTAL's customer, exactly as the hook's
 * `.eq("customer_id", customerId)` reads them — so a charge filed under one
 * customer on another customer's rental is treated as the hook treats it.
 */
export function rentalSetsByCustomer(
  rentals: { id: string; customer_id: string | null; status?: string | null; approval_status?: string | null; is_pay_as_you_go?: boolean | null }[],
): Map<string, CustomerRentalSets> {
  const out = new Map<string, CustomerRentalSets>();
  for (const r of rentals) {
    if (!r.customer_id) continue;
    let sets = out.get(r.customer_id);
    if (!sets) {
      sets = { excluded: new Set(), payg: new Set() };
      out.set(r.customer_id, sets);
    }
    if (excludedRentalReason(r)) sets.excluded.add(r.id);
    if (r.is_pay_as_you_go === true) sets.payg.add(r.id);
  }
  return out;
}

const EMPTY_SETS: CustomerRentalSets = { excluded: new Set(), payg: new Set() };

/**
 * Finances: does this charge count toward its customer's balance? A charge with
 * no `customer_id` is never on any customer's balance (the hook reads charges by
 * customer), so it never counts.
 */
export function chargeCountsForCustomer(
  charge: BalanceChargeLike & { customer_id?: string | null },
  sets: Map<string, CustomerRentalSets>,
  clock: BalanceClock,
): boolean {
  if (!charge.customer_id) return false;
  if (charge.type != null && charge.type !== "Charge") return false;
  const s = sets.get(charge.customer_id) ?? EMPTY_SETS;
  return chargeCountsTowardBalance(charge, s.excluded, s.payg, clock);
}
