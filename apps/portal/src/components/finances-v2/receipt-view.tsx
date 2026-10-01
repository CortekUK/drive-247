"use client";

/**
 * The receipt for ONE payment — proof that this money was received, and what
 * it paid. One payment, one receipt: a payment split across Rental and
 * Insurance shows under both charges, and both open this.
 *
 * Drawn as the paper slip Drive247's own subscription receipt already is
 * (components/billing-v2/receipt-dialog-v2.tsx): white paper with torn zig-zag
 * edges, a centred header, dashed rules, the lines, a TOTAL and a stamp. Same
 * construction, so an operator's receipt to their customer and our receipt to
 * the operator look like the same kind of object. The paper is paper in both
 * themes — white, dark ink. `data-print-root` makes "Print" print the slip
 * alone (global.css).
 *
 * Built from what is already on the payment and its allocations, so it needs
 * no table and no write. Rendered inside the invoice sheet in place of the
 * charges list.
 */

import type React from "react";
import { format } from "date-fns";
import { Printer } from "lucide-react";
import { SheetDescription, SheetTitle } from "@/components/ui-v2/sheet";
import { Button } from "@/components/ui-v2/button";
import { formatCurrency } from "@/lib/format-utils";
import {
  EPS,
  manualMethod,
  refundOf,
  paymentChannel,
  paymentProvider,
  receiptNumber,
  type FinancePayment,
  type PaymentChannel,
} from "./finance-data";

/** How the payment was taken, as a customer would read it on a receipt. */
const CHANNEL_WORDS: Record<PaymentChannel, string> = {
  "Link emailed": "Paid by link",
  "At booking": "Paid at booking",
  "Auto-charge": "Card on file",
  Manual: "Recorded by staff",
};
const PROVIDER_WORDS = { stripe: "Stripe", square: "Square", manual: null } as const;

/** The torn top and bottom edges: real cut-outs, via a CSS mask (as receipt-dialog-v2). */
const ZIGZAG = [
  "conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 14px 51% repeat-x",
  "conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 14px 51% repeat-x",
].join(", ");

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{value}</span>
    </div>
  );
}

/**
 * One receipt line per charge TYPE, not per charge. A pay-as-you-go rental adds
 * a Rental, Tax and Service Fee charge for every day, so a single payment can
 * settle a dozen charges; listed one by one they read as a jumble of repeats.
 * Grouped: "Rental × 4", its date range beneath, one total per type.
 * Ordered as a rental is built: hire first, then protection, fees and tax.
 */
const LINE_ORDER = [
  "Rental", "Extension Rental", "Insurance", "Extension Insurance", "Security Deposit",
  "Delivery Fee", "Collection Fee", "Extras", "Excess Mileage", "Fine", "Damage",
  "Service Fee", "Extension Service Fee", "Tax", "Extension Tax", "Adjustment",
];

function groupLines(appliedTo: { category: string; amount: number; date?: string | null }[]) {
  const byType = new Map<string, { category: string; amount: number; count: number; dates: string[] }>();
  for (const a of appliedTo) {
    const g = byType.get(a.category) ?? { category: a.category, amount: 0, count: 0, dates: [] };
    g.amount += a.amount;
    g.count += 1;
    if (a.date) g.dates.push(a.date.slice(0, 10));
    byType.set(a.category, g);
  }
  const rank = (c: string) => {
    const i = LINE_ORDER.indexOf(c);
    return i === -1 ? LINE_ORDER.length : i;
  };
  const day = (d: string) => format(new Date(`${d}T00:00:00`), "MMM d");
  return [...byType.values()]
    .sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category))
    .map((g) => {
      const dates = [...new Set(g.dates)].sort();
      // A date range only helps when the line covers more than one day.
      const range = g.count > 1 && dates.length > 1 ? `${day(dates[0])} – ${day(dates[dates.length - 1])}` : null;
      return { category: g.category, amount: g.amount, count: g.count, range };
    });
}

function Rule() {
  return <div aria-hidden className="my-3 border-t border-dashed border-border" />;
}

export function ReceiptView({
  payment,
  companyName,
  invoiceNumber,
  customerName,
  vehicle,
  appliedTo,
  currencyCode,
}: {
  payment: FinancePayment;
  companyName: string;
  invoiceNumber: string;
  customerName: string | null;
  vehicle: string | null;
  /** Every charge this payment paid, and how much went to each. */
  appliedTo: { category: string; amount: number; date?: string | null }[];
  currencyCode: string;
}) {
  const money = (n: number) => formatCurrency(n, currencyCode);
  const when = payment.paid_at ?? payment.payment_date;
  const received = Number(payment.amount || 0);
  // Any refund on this payment — full or part, online or by hand (see refundOf).
  const refund = refundOf(payment);
  const refunded = refund?.amount ?? 0;
  const applied = appliedTo.reduce((s, a) => s + a.amount, 0);
  const lines = groupLines(appliedTo);
  // Money received but not put toward any charge sits on the account. A refund
  // gives money back but does not undo what it paid (the charges stay settled),
  // so it is not taken off here.
  const onAccount = received - applied;
  const number = receiptNumber(payment.id);
  const stamp =
    refunded >= received - EPS && refunded > EPS
      ? { label: "Refunded", tone: "border-blue-600/60 text-blue-700 dark:text-blue-300" }
      : refunded > EPS
        ? { label: "Part refunded", tone: "border-blue-600/60 text-blue-700 dark:text-blue-300" }
        : { label: "Paid", tone: "border-green-600/60 text-green-700 dark:text-green-300" };
  const refundHow = refund
    ? [
        refund.provider === "manual" ? "by hand" : `to card · ${refund.provider === "stripe" ? "Stripe" : "Square"}`,
        refund.date ? format(new Date(refund.date), "MMM d") : null,
        refund.pending ? "processing" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <SheetTitle className="sr-only">Receipt {number}</SheetTitle>
      <SheetDescription className="sr-only">
        {money(received)} received from {customerName ?? "the customer"} for invoice {invoiceNumber}.
      </SheetDescription>

      {/* The slip, straight on the sheet — no tray, no tilt. */}
      <div className="px-2 py-4">
        <div
          className="mx-auto max-w-[420px]"
          style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.08)) drop-shadow(0 12px 24px rgba(0,0,0,0.18))" }}
        >
          <div
            data-print-root
            className="relative bg-popover px-7 pb-7 pt-7 font-mono text-[12.5px] leading-snug text-foreground"
            style={{ WebkitMask: ZIGZAG, mask: ZIGZAG }}
          >
            {/* Header */}
            <div className="text-center">
              <p className="font-sans text-lg font-semibold uppercase tracking-[0.2em] text-foreground">
                {companyName || "Receipt"}
              </p>
              {/* One line for what this is and its number. */}
              <p className="mt-1 text-[11px] text-muted-foreground">
                <span className="uppercase tracking-[0.3em]">Receipt</span>
                <span className="mx-1.5">·</span>
                <span className="text-foreground">{number}</span>
              </p>
            </div>

            <Rule />

            <div className="space-y-1">
              <Row label="Paid" value={when ? format(new Date(when), "MMM d, yyyy") : "—"} />
              <Row label="Received from" value={customerName ?? "—"} />
              <Row
                label="Method"
                value={[
                  paymentChannel(payment) === "Manual" ? manualMethod(payment) : payment.method || "Card",
                  CHANNEL_WORDS[paymentChannel(payment)],
                  PROVIDER_WORDS[paymentProvider(payment)],
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Row label="For invoice" value={invoiceNumber} />
              {vehicle && <Row label="Vehicle" value={vehicle} />}
            </div>

            <Rule />

            {/* Lines: what this payment paid */}
            <div className="space-y-1">
              {lines.map((l) => (
                <div key={l.category}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0">
                      {l.category}
                      {l.count > 1 && <span className="text-muted-foreground"> × {l.count}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
                  </div>
                  {l.range && <div className="text-[11px] text-muted-foreground">{l.range}</div>}
                </div>
              ))}
              {onAccount > EPS && (
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0">On account</span>
                  <span className="shrink-0 tabular-nums">{money(onAccount)}</span>
                </div>
              )}
              {refunded > EPS && (
                <div className="text-muted-foreground">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0">Refunded</span>
                    <span className="shrink-0 tabular-nums">−{money(refunded)}</span>
                  </div>
                  <div className="text-[11px]">{refundHow}</div>
                </div>
              )}
            </div>

            <Rule />

            {/* TOTAL, with the stamp beside it — the one thing on a paper
                receipt you read first, without a block of its own. */}
            <div className="flex items-center justify-between gap-4 text-[15px] font-semibold text-foreground">
              <span>TOTAL</span>
              <span className="flex items-center gap-3">
                <span
                  className={`-rotate-6 rounded-md border-2 px-2 py-0.5 font-sans text-[11px] font-bold uppercase tracking-[0.2em] opacity-80 ${stamp.tone}`}
                >
                  {stamp.label}
                </span>
                <span className="tabular-nums">{money(received)}</span>
              </span>
            </div>

            <Rule />

            <p className="text-center text-[11px] text-muted-foreground">Thank you for your business.</p>
            {/* A barcode, as printed receipts carry — decoration only. */}
            <div
              aria-hidden
              className="mx-auto mt-2.5 h-6 w-40 opacity-70"
              style={{
                background:
                  "repeating-linear-gradient(90deg, hsl(var(--foreground)) 0 2px, transparent 2px 4px, hsl(var(--foreground)) 4px 5px, transparent 5px 8px, hsl(var(--foreground)) 8px 11px, transparent 11px 12px)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Actions, off the paper. */}
      <div className="flex justify-center print:hidden">
        <Button onClick={() => window.print()} className="rounded-xl">
          <Printer className="h-4 w-4" />
          Print receipt
        </Button>
      </div>
    </>
  );
}
