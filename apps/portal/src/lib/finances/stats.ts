/**
 * The math strip (design §3). Pure. Every number is a sum over the rows the
 * matching card filter returns (`cardRows` in ./filters) — so clicking a card
 * can never show rows that add up to something else.
 *
 *   Outstanding   Σ bill.outstandingCents — per customer, exactly what
 *                 useCustomerBalance computes (lib/finances/balance.ts).
 *                 "N customers" = customers whose part is above zero.
 *   Overdue       Σ bill.overdueCents — the part of Outstanding on charges due
 *                 before today. "N rentals" = rentals (or, for charges on no
 *                 rental, customers) whose overdue part is above zero.
 *   Collected     Σ receipt.netCents (amount − refund, never below zero) over
 *                 collected receipts in the period; `refundedCents` is what was
 *                 netted off those same rows — shown beside it, never hidden.
 *   Upcoming      Σ remaining on open occurrences in the next 7 days;
 *                 split by collection method (auto charge / payment link).
 */

import type { CardRows } from "./filters";
import type { FinanceStats } from "./types";

export function computeStats(rows: CardRows): FinanceStats {
  let outstandingCents = 0;
  const byCustomer = new Map<string, number>();
  for (const b of rows.outstanding) {
    outstandingCents += b.outstandingCents;
    byCustomer.set(b.customerId, (byCustomer.get(b.customerId) ?? 0) + b.outstandingCents);
  }
  let outstandingCustomers = 0;
  byCustomer.forEach((c) => {
    if (c > 0) outstandingCustomers += 1;
  });

  let overdueCents = 0;
  const overdueBy = new Map<string, number>();
  for (const b of rows.overdue) {
    overdueCents += b.overdueCents;
    const k = b.onRental ? `rental:${b.rentalId}` : `customer:${b.customerId}`;
    overdueBy.set(k, (overdueBy.get(k) ?? 0) + b.overdueCents);
  }
  let overdueRentals = 0;
  overdueBy.forEach((c) => {
    if (c > 0) overdueRentals += 1;
  });

  let collectedCents = 0;
  let refundedCents = 0;
  for (const r of rows.collected) {
    collectedCents += r.netCents;
    refundedCents += r.amountCents - r.netCents;
  }

  let upcomingCents = 0;
  let upcomingAuto = 0;
  let upcomingLinks = 0;
  for (const u of rows.upcoming) {
    upcomingCents += u.amountCents;
    if (u.method === "auto_charge") upcomingAuto += 1;
    else if (u.method === "checkout_link") upcomingLinks += 1;
  }

  return {
    outstandingCents,
    outstandingCustomers,
    overdueCents,
    overdueRentals,
    collectedCents,
    collectedCount: rows.collected.length,
    refundedCents,
    upcomingCents,
    upcomingCount: rows.upcoming.length,
    upcomingAuto,
    upcomingLinks,
  };
}
