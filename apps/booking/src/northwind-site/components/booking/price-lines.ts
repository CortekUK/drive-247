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

/** "3 days × $40.00", or "9 days at the weekly rate" for a part-week. */
export function rentalCaption(quote: QuoteResult, formatCurrency: Format): string {
  const { rentalSummary } = quote;
  const unitPlural = rentalSummary.quantity === 1 ? "" : "s";
  return rentalSummary.quantityIsWhole
    ? `${rentalSummary.quantity} ${rentalSummary.unitLabel}${unitPlural} × ${formatCurrency(rentalSummary.unitRate)}`
    : `${rentalSummary.rentalDays} day${rentalSummary.rentalDays === 1 ? "" : "s"} at the ${rentalSummary.tier} rate`;
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
