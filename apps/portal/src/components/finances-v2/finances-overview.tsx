"use client";

import { useMemo } from "react";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { FeaturedDeck } from "@/components/shared/featured-deck-v2";
import { invoiceTotals, isLanded, refundShare, type FinanceIndex, type FinanceInvoice } from "./finance-data";

/**
 * The Finances hero row: one simple graph and one featured card, the same
 * shape as Customers and Vehicles (see customers-overview.tsx for the brief).
 *
 * EVERY NUMBER HERE IS REAL, and describes exactly the invoices the table
 * below lists. This file runs no query: it reads the invoices the tab already
 * fetched and the finance index the table already built (same query key).
 *
 * WHAT COUNTS.
 *   - INVOICED: each invoice's total, on its invoice date. The total is summed
 *     from the rental's charges (extensions included), as the table shows it.
 *   - COLLECTED (the lighter line): money applied to those invoices' charges,
 *     on the day the payment landed (`paid_at`, else `payment_date`), net of
 *     any refund on it. Only payments whose money actually landed count — the
 *     same rule as receipts.
 *
 * THE CARD is Auto-charge (lib/featured-cards.ts): the Auto-Extend setting
 * that bills the customer's saved card without a pay link.
 */

/** A bare date is local; a timestamp is an instant. */
function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDate(value) : new Date(value);
}

export function FinancesOverview({
  invoices,
  index,
  currencyCode,
}: {
  invoices: readonly FinanceInvoice[];
  index: FinanceIndex;
  currencyCode: string;
}) {
  const metrics = useMemo<HeroMetric[]>(() => {
    const invoiced: { at: Date; amount: number }[] = [];
    const collected: { at: Date; amount: number }[] = [];

    for (const invoice of invoices) {
      const { charges, total } = invoiceTotals(invoice, index);
      if (invoice.invoice_date && total) invoiced.push({ at: toDate(invoice.invoice_date), amount: total });

      for (const charge of charges) {
        for (const alloc of index.allocsByCharge.get(charge.id) ?? []) {
          const payment = index.paymentById.get(alloc.payment_id);
          const when = payment?.paid_at ?? payment?.payment_date;
          if (!payment || !when || !isLanded(payment)) continue;
          // Net of any refund on it: collected is money KEPT, not money that
          // passed through and went back out.
          const applied = Number(alloc.amount_applied || 0);
          collected.push({ at: toDate(when), amount: applied - refundShare(payment, applied, charge.id) });
        }
      }
    }

    return [
      {
        key: "invoiced",
        label: "Invoiced",
        kind: "flow",
        description:
          "Invoice totals on their invoice date, summed from each rental's charges. The lighter line is money collected against them, on the day it landed.",
        format: (v) => formatCurrency(v, currencyCode),
        events: invoiced,
        secondary: { label: "Collected", events: collected },
      },
    ];
  }, [invoices, index, currencyCode]);

  return (
    <HeroRow
      chart={<HeroChart metrics={metrics} anchor="finances-chart" />}
      card={<FeaturedDeck tab="finances" anchor="finances-featured" className="lg:min-h-0" />}
    />
  );
}
