import type { QuoteExtraLine, QuoteResult } from "@nw/lib/quote/types";

import { formatIsoDateLabel } from "./time-utils";

/**
 * The words around the bill's numbers — the captions under each line. Shared by
 * `price-summary.tsx` and `@nw/site-v2/booking/price-summary` so the two bills
 * can never describe the same quote differently. No arithmetic here: every
 * figure is read off `QuoteResult` (see `compute-quote.ts`).
 */

type Format = (amount: number) => string;

/** Whether the per-period breakdown (seasonal/weekend groups) is shown. */
export function showsRentalGroups(quote: QuoteResult): boolean {
  const { rentalSummary } = quote;
  return (
    !quote.hideBreakdown &&
    rentalSummary.kind === "dynamic" &&
    rentalSummary.groups.length > 0
  );
}

/**
 * The caption under "Vehicle rental". It must never show a sum that differs
 * from the amount beside it.
 *
 *  - No surcharge: the tier's rate, "3 days × $50.00" or "1 week × $300.00"
 *    ("9 days at the weekly rate" for a part-week).
 *  - Surcharged, every day the same price: that day price, "3 days × $65.00".
 *  - Surcharged, prices differ: just "3 days"; the day lines below give each rate.
 *
 * Before (P6, 2026-11-11) a 30% holiday read "3 days × $50.00" beside $195.00,
 * because the caption always used the car's base rate.
 */
export function rentalCaption(quote: QuoteResult, formatCurrency: Format): string {
  const { rentalSummary, vehicleTotal } = quote;
  const days = rentalSummary.rentalDays;
  const dayWord = `day${days === 1 ? "" : "s"}`;
  const matches = (amount: number) => Math.abs(amount - vehicleTotal) < 0.005;

  if (rentalSummary.kind !== "dynamic") {
    const unitPlural = rentalSummary.quantity === 1 ? "" : "s";
    if (rentalSummary.quantityIsWhole && matches(rentalSummary.quantity * rentalSummary.unitRate)) {
      return `${rentalSummary.quantity} ${rentalSummary.unitLabel}${unitPlural} × ${formatCurrency(rentalSummary.unitRate)}`;
    }
    if (!rentalSummary.quantityIsWhole) return `${days} ${dayWord} at the ${rentalSummary.tier} rate`;
    return `${days} ${dayWord}`;
  }

  const rates = new Set(rentalSummary.groups.map((g) => Math.round(g.rate * 100)));
  if (rates.size === 1 && rentalSummary.groups.length > 0) {
    const rate = rentalSummary.groups[0].rate;
    if (matches(days * rate)) return `${days} ${dayWord} × ${formatCurrency(rate)}`;
  }
  return `${days} ${dayWord}`;
}

/** A breakdown group's dates: one day, or a range. */
export function groupDateRange(group: { startDate: string; endDate: string }): string {
  return `${formatIsoDateLabel(group.startDate)}${
    group.startDate === group.endDate ? "" : ` – ${formatIsoDateLabel(group.endDate)}`
  }`;
}

/** "2 × $5.00 × 3 days" for a per-day extra, "2 × $5.00" otherwise. */
export function extraLineCaption(line: QuoteExtraLine, formatCurrency: Format): string {
  return line.perDay
    ? `${line.quantity} × ${formatCurrency(line.unitPrice)} × ${line.billedDays} day${line.billedDays === 1 ? "" : "s"}`
    : `${line.quantity} × ${formatCurrency(line.unitPrice)}`;
}
