/**
 * The Billed view — ledger charges grouped into bills (design §3). Pure.
 *
 * One bill per rental for the booking's own charges, one per extension
 * (`ledger_entries.extension_id`), and one per customer for charges that sit on
 * no rental. Built from the LEDGER, not the `invoices` table: that table is only
 * written at non-PAYG booking time, so payment links, operator charges and
 * extensions never reach it. The invoice number is shown when a row exists.
 *
 *   Total    = Σ positive charge amounts
 *   Paid     = Σ payment_applications.amount_applied on those charges
 *   Credited = Σ |negative charge amounts| (adjustments)
 *   Balance  = Σ remaining_amount
 *
 * Tie-out: Total − Paid − Credited should equal Balance. It does not when a
 * path wrote `remaining_amount` without an allocation record (15 charges on
 * Sep 25 2026, both directions). Such a bill carries `tiesOut: false` and the
 * gap in `mismatchCents`, so the page says "Doesn't add up by $X" instead of
 * quietly showing a number.
 */

import { formatMoney } from "@/lib/payment-plans-ui/format";
import {
  chargeCountsForCustomer,
  excludedRentalReason,
  paygAccrualCents,
  rentalSetsByCustomer,
  toCents,
  type BalanceClock,
} from "./balance";
import { rentalRefOf, UNKNOWN_CUSTOMER, type FinanceLookups } from "./lookups";
import { dayOf, daysFrom, instantDay } from "./period";
import type { BillLine, BillRow, FinanceContext, FinanceRawData, RawCharge } from "./types";

export const BOOKING_LABEL = "Booking";
export const NO_RENTAL_LABEL = "Not on a rental";

interface Group {
  key: string;
  rentalId: string | null;
  extensionId: string | null;
  customerId: string | null;
  charges: RawCharge[];
}

export function billKey(rentalId: string | null, extensionId: string | null, customerId: string | null): string {
  if (!rentalId) return `none:${customerId ?? "unknown"}`;
  return extensionId ? `${rentalId}:ext:${extensionId}` : `${rentalId}:booking`;
}

const byDueThenEntry = (a: RawCharge, b: RawCharge) => {
  const da = dayOf(a.due_date) ?? "9999-12-31";
  const db = dayOf(b.due_date) ?? "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  const ea = String(a.entry_date ?? a.created_at ?? "");
  const eb = String(b.entry_date ?? b.created_at ?? "");
  if (ea !== eb) return ea < eb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const minDay = (days: (string | null)[]): string | null => {
  let best: string | null = null;
  for (const d of days) if (d && (best === null || d < best)) best = d;
  return best;
};

export function buildBills(raw: FinanceRawData, lk: FinanceLookups, ctx: FinanceContext): BillRow[] {
  const clock: BalanceClock = { now: new Date(), today: ctx.today, timeZone: ctx.timeZone };
  const sets = rentalSetsByCustomer(raw.rentals);
  const groups = new Map<string, Group>();

  const groupFor = (rentalId: string | null, extensionId: string | null, customerId: string | null) => {
    const key = billKey(rentalId, extensionId, customerId);
    let g = groups.get(key);
    if (!g) {
      g = { key, rentalId, extensionId: rentalId ? extensionId : null, customerId, charges: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const c of raw.charges) {
    if (c.type != null && c.type !== "Charge") continue;
    groupFor(c.rental_id ?? null, c.extension_id ?? null, c.customer_id ?? null).charges.push(c);
  }

  // Open PAYG accruals belong to the rental's booking bill. The hook reads them
  // through `rentals!inner(customer_id)`, so they are the rental's customer's,
  // and a cancelled/rejected rental's accruals never count.
  const paygOpenByRental = new Map<string, number>();
  for (const a of raw.accruals) {
    if (!a.rental_id) continue;
    if (a.rentals && a.rentals.payg_closed_at) continue;
    const rental = lk.rentalById.get(a.rental_id);
    const customerId = a.rentals?.customer_id ?? rental?.customer_id ?? null;
    if (!customerId) continue;
    const excluded = rental ? !!excludedRentalReason(rental) : !!sets.get(customerId)?.excluded.has(a.rental_id);
    if (excluded) continue;
    paygOpenByRental.set(a.rental_id, (paygOpenByRental.get(a.rental_id) ?? 0) + paygAccrualCents(a));
    groupFor(a.rental_id, null, customerId);
  }

  // Extension numbering when `rental_extensions.sequence_number` is missing:
  // the order each extension's first charge was entered, per rental.
  const extOrder = new Map<string, { id: string; first: string }[]>();
  groups.forEach((g) => {
    if (!g.rentalId || !g.extensionId) return;
    const first = minDay(g.charges.map((c) => dayOf(c.entry_date) ?? instantDay(c.created_at, ctx.timeZone))) ?? "";
    const list = extOrder.get(g.rentalId) ?? [];
    list.push({ id: g.extensionId, first });
    extOrder.set(g.rentalId, list);
  });
  extOrder.forEach((list) => list.sort((a, b) => (a.first !== b.first ? (a.first < b.first ? -1 : 1) : a.id < b.id ? -1 : 1)));

  const bills: BillRow[] = [];
  groups.forEach((g) => {
    const rental = g.rentalId ? lk.rentalById.get(g.rentalId) ?? null : null;
    const customerId = rental?.customer_id ?? g.customerId ?? g.charges.find((c) => c.customer_id)?.customer_id ?? "";
    const charges = [...g.charges].sort(byDueThenEntry);

    const lines: BillLine[] = charges.map((c) => {
      const applications = (lk.allocationsByCharge.get(c.id) ?? []).map((a) => ({ paymentId: a.paymentId, amountCents: a.amountCents }));
      return {
        chargeId: c.id,
        category: c.category ?? "",
        amountCents: toCents(c.amount),
        remainingCents: toCents(c.remaining_amount),
        appliedCents: applications.reduce((s, a) => s + a.amountCents, 0),
        dueDate: dayOf(c.due_date),
        // entry_date is a NOT NULL date column; created_at (an instant) is the
        // fallback, read in the tenant's zone.
        entryDate: dayOf(c.entry_date) ?? instantDay(c.created_at, ctx.timeZone),
        applications,
        countsTowardOutstanding: chargeCountsForCustomer(c, sets, clock),
      };
    });

    let totalCents = 0;
    let creditedCents = 0;
    let paidCents = 0;
    let balanceCents = 0;
    let ledgerOutstanding = 0;
    let overdueCents = 0;
    const overdueSince: (string | null)[] = [];
    for (const l of lines) {
      if (l.amountCents > 0) totalCents += l.amountCents;
      else if (l.amountCents < 0) creditedCents += -l.amountCents;
      paidCents += l.appliedCents;
      balanceCents += l.remainingCents;
      if (!l.countsTowardOutstanding) continue;
      ledgerOutstanding += l.remainingCents;
      if (l.dueDate && l.dueDate < ctx.today) {
        overdueCents += l.remainingCents;
        if (l.remainingCents > 0) overdueSince.push(l.dueDate);
      }
    }
    const mismatchCents = totalCents - paidCents - creditedCents - balanceCents;

    const isBooking = !!g.rentalId && !g.extensionId;
    const paygOpenCents = isBooking ? paygOpenByRental.get(g.rentalId!) ?? 0 : 0;
    const isPayg = rental?.is_pay_as_you_go === true;
    const outstandingCents = ledgerOutstanding + paygOpenCents;

    // What the status words are about. A PAYG rental's booking bill owes its
    // open accruals (its ledger rows describe the same days); everything else
    // owes its balance.
    const owed = isBooking && isPayg ? paygOpenCents : balanceCents;
    let status: BillRow["status"];
    let overdueDays: number | null = null;
    const since = minDay(overdueSince);
    if (owed > 0 && overdueCents > 0 && since) {
      status = "overdue";
      overdueDays = daysFrom(since, ctx.today);
    } else if (owed > 0) status = "open";
    else if (owed < 0) status = "credit";
    else status = "paid";

    let label: string;
    if (!g.rentalId) label = NO_RENTAL_LABEL;
    else if (!g.extensionId) label = BOOKING_LABEL;
    else {
      const seq = lk.extensionById.get(g.extensionId)?.sequence_number;
      const n =
        typeof seq === "number" && seq > 0 ? seq : (extOrder.get(g.rentalId)?.findIndex((e) => e.id === g.extensionId) ?? 0) + 1;
      label = `Extension #${n}`;
    }

    const vehicleId = rental?.vehicle_id ?? charges.find((c) => c.vehicle_id)?.vehicle_id ?? null;
    const owing = lines.filter((l) => l.remainingCents > 0).map((l) => l.dueDate);

    bills.push({
      key: g.key,
      rentalId: g.rentalId ?? "",
      rentalRef: g.rentalId ? rentalRefOf(rental, g.rentalId) ?? "" : "—",
      extensionId: g.extensionId,
      label,
      customerId,
      customerName: (customerId && lk.customerNameById.get(customerId)) || UNKNOWN_CUSTOMER,
      vehicleReg: vehicleId ? lk.vehicleRegById.get(vehicleId) ?? null : null,
      invoiceNumber: isBooking ? lk.invoiceByRental.get(g.rentalId!)?.invoice_number ?? null : null,
      issuedOn:
        minDay(lines.map((l) => l.entryDate)) ?? dayOf(rental?.start_date) ?? instantDay(rental?.created_at, ctx.timeZone) ?? ctx.today,
      dueOn: minDay(owing) ?? minDay(lines.map((l) => l.dueDate)),
      totalCents,
      paidCents,
      creditedCents,
      balanceCents,
      tiesOut: mismatchCents === 0,
      mismatchCents,
      status,
      overdueDays,
      lines,
      outstandingCents,
      overdueCents,
      paygOpenCents,
      isPayg,
      excludedReason: rental ? excludedRentalReason(rental) : null,
      onRental: !!g.rentalId,
      vehicleId,
      invoiceId: isBooking ? lk.invoiceByRental.get(g.rentalId!)?.id ?? null : null,
    });
  });

  return bills.sort((a, b) => {
    if (a.issuedOn !== b.issuedOn) return a.issuedOn < b.issuedOn ? 1 : -1;
    if (a.rentalRef !== b.rentalRef) return a.rentalRef < b.rentalRef ? -1 : 1;
    if (!a.extensionId !== !b.extensionId) return a.extensionId ? 1 : -1;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/** "Paid" · "Open" · "12 days overdue" · "In credit $20.00". */
export function billStatusText(bill: Pick<BillRow, "status" | "overdueDays" | "balanceCents">, currency = "USD"): string {
  switch (bill.status) {
    case "paid":
      return "Paid";
    case "open":
      return "Open";
    case "overdue": {
      const d = bill.overdueDays ?? 0;
      if (d <= 0) return "Overdue";
      return `${d} ${d === 1 ? "day" : "days"} overdue`;
    }
    case "credit":
      return `In credit ${formatMoney(Math.abs(bill.balanceCents), currency)}`;
  }
}

/** "Doesn't add up by $100.00", or null when the bill ties out. */
export function tieOutText(
  bill: Pick<BillRow, "tiesOut" | "mismatchCents"> & { excludedReason?: BillRow["excludedReason"] },
  currency = "USD",
): string | null {
  if (bill.tiesOut) return null;
  const amount = formatMoney(Math.abs(bill.mismatchCents), currency);
  // Rejecting or cancelling a booking zeroes its charges without writing an
  // allocation (reject_payment does exactly that), so EVERY such bill would read
  // as drift and bury the real drift in noise. When the gap is charges cleared
  // (mismatch > 0) on a booking that was rejected or cancelled, say what
  // happened instead. Any other gap on those bookings still reads as drift.
  if (bill.excludedReason && bill.mismatchCents > 0) {
    return `Booking ${bill.excludedReason} — ${amount} cleared without a payment`;
  }
  return `Doesn't add up by ${amount}`;
}

/**
 * The math, written out:
 *   "Total $550.00 − Paid $530.00 − Credited $20.00 = Balance $0.00", or, when
 *   it does not tie out,
 *   "Total $100.00 − Paid $0.00 − Credited $0.00 = $100.00, but the ledger's balance is $0.00".
 */
export function billMathText(bill: Pick<BillRow, "totalCents" | "paidCents" | "creditedCents" | "balanceCents">, currency = "USD"): string {
  const $ = (c: number) => formatMoney(c, currency);
  const expected = bill.totalCents - bill.paidCents - bill.creditedCents;
  const lhs = `Total ${$(bill.totalCents)} − Paid ${$(bill.paidCents)} − Credited ${$(bill.creditedCents)}`;
  if (expected === bill.balanceCents) return `${lhs} = Balance ${$(bill.balanceCents)}`;
  return `${lhs} = ${$(expected)}, but the ledger's balance is ${$(bill.balanceCents)}`;
}
