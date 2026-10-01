"use client";

import type React from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import type { TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { cardBrandLabel } from "@/components/subscription/card-brand-icon";
import { billingDocumentsOf, billingStatusOf, BILLING_STATUS_LABEL } from "@/lib/billing-documents";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";

/**
 * The invoice / receipt, v2, drawn as the paper it has always been: a white
 * slip with torn zig-zag edges, a centred header, dashed rules, the lines and
 * a TOTAL, and a stamp saying whether it was paid.
 *
 * A v2 fork of `LocalInvoiceView` (components/settings/subscription-settings),
 * which v1's billing page and Settings still render, untouched. Same facts and
 * the same rules: no invented card, the line-by-line breakdown when Stripe
 * gave us one (integration billing), and the merged Subscription / E-sign rows
 * otherwise.
 *
 * The paper is paper in both themes — white, dark ink — because that is what
 * the object is. The torn edges are a CSS mask (real cut-outs), so the shadow
 * is a drop-shadow on the wrapper, which follows the masked shape.
 * `data-print-root` makes "Print" print the slip alone (global.css).
 */

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

function Rule() {
  return <div aria-hidden className="my-4 border-t border-dashed border-border" />;
}

export function ReceiptDialogV2({
  invoice,
  tenantName,
  cardBrand,
  cardLast4,
  open,
  onClose,
  lines,
  linesLoading = false,
  linesUnavailable = false,
}: {
  invoice: TenantSubscriptionInvoice | null;
  tenantName: string;
  cardBrand?: string | null;
  cardLast4?: string | null;
  open: boolean;
  onClose: () => void;
  /** Integration billing only: the invoice line by line from Stripe. */
  lines?: Array<{ label: string; amount: number }> | null;
  linesLoading?: boolean;
  linesUnavailable?: boolean;
}) {
  if (!invoice) return null;

  const status = billingStatusOf(invoice);
  const paid = status === "paid";
  const docs = billingDocumentsOf(invoice);
  const money = (c: number) => formatMoney(c, invoice.currency);
  const signed = (c: number) => (c < 0 ? `−${money(-c)}` : money(c));
  const period = `${formatBillDate(invoice.period_start) ?? "—"} – ${formatBillDate(invoice.period_end) ?? "—"}`;
  const stampTone =
    status === "paid"
      ? "border-green-600/60 text-green-700 dark:text-green-300"
      : status === "refunded"
        ? "border-blue-600/60 text-blue-700 dark:text-blue-300"
        : status === "void"
          ? "border-neutral-400 text-muted-foreground"
          : "border-red-600/60 text-red-700 dark:text-red-300";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] gap-5 overflow-y-auto bg-transparent p-0 shadow-none ring-0 sm:max-w-[500px] dark:ring-0"
      >
        <DialogTitle className="sr-only">
          {paid ? "Receipt" : "Invoice"} {invoice.invoice_number ?? ""}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {BILLING_STATUS_LABEL[status]} · {money(paid ? invoice.amount_paid : invoice.amount_due)}
        </DialogDescription>

        {/* The slip. */}
        <div style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.08)) drop-shadow(0 12px 24px rgba(0,0,0,0.18))" }}>
          <div
            data-print-root
            className="relative bg-popover px-9 pb-10 pt-10 font-mono text-[12.5px] leading-relaxed text-foreground"
            style={{ WebkitMask: ZIGZAG, mask: ZIGZAG }}
          >
            {/* Header */}
            <div className="text-center">
              <p className="font-sans text-lg font-semibold tracking-[0.2em] text-foreground">DRIVE247</p>
              <p className="text-[11px] text-muted-foreground">Platform subscription</p>
              <p className="mt-4 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">{paid ? "Receipt" : "Invoice"}</p>
              <p className="text-foreground">{invoice.invoice_number ?? "—"}</p>
            </div>

            <Rule />

            <div className="space-y-1">
              <Row label={invoice.paid_at ? "Paid" : "Date"} value={formatBillDate(invoice.paid_at || invoice.invoice_date || invoice.created_at) ?? "—"} />
              <Row label="Billed to" value={tenantName} />
              <Row label="Period" value={period} />
              {cardLast4 && <Row label="Card" value={`${cardBrandLabel(cardBrand)} •••• ${cardLast4}`} />}
            </div>

            <Rule />

            {/* Lines */}
            <div className="space-y-2">
              {lines && lines.length > 0 ? (
                lines.map((l, i) => (
                  <div key={`${l.label}-${i}`} className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0">{l.label}</span>
                    <span className="shrink-0 tabular-nums">{signed(l.amount)}</span>
                  </div>
                ))
              ) : linesLoading ? (
                <div className="h-4 w-full animate-pulse rounded bg-muted" aria-label="Loading the invoice lines" />
              ) : linesUnavailable ? (
                <p className="text-muted-foreground">The line-by-line breakdown couldn&apos;t be loaded. The total below is what was billed.</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0">Monthly subscription</span>
                    <span className="shrink-0 tabular-nums">{money(invoice.base_amount ?? invoice.amount_due)}</span>
                  </div>
                  {invoice.usage_amount != null && invoice.usage_amount > 0 && (
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0">
                        E-sign usage
                        <span className="text-muted-foreground">
                          {" "}× {invoice.usage_quantity || 0}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{money(invoice.usage_amount)}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <Rule />

            <div className="flex items-baseline justify-between gap-4 text-[15px] font-semibold text-foreground">
              <span>TOTAL</span>
              <span className="tabular-nums">{money(invoice.amount_due)}</span>
            </div>
            {paid && (
              <div className="mt-1 flex items-baseline justify-between gap-4 text-muted-foreground">
                <span>Amount paid</span>
                <span className="tabular-nums">{money(invoice.amount_paid)}</span>
              </div>
            )}

            {/* The stamp — the one thing on a paper receipt you read first. */}
            <div className="mt-6 flex justify-center">
              <span
                className={`-rotate-6 rounded-md border-2 px-4 py-1 font-sans text-sm font-bold uppercase tracking-[0.25em] opacity-80 ${stampTone}`}
              >
                {BILLING_STATUS_LABEL[status]}
              </span>
            </div>

            <Rule />

            <p className="text-center text-[11px] text-muted-foreground">Thank you for running your business on Drive247.</p>
            {/* A barcode, as printed receipts carry — decoration only. */}
            <div
              aria-hidden
              className="mx-auto mt-4 h-9 w-48 opacity-70"
              style={{
                background:
                  "repeating-linear-gradient(90deg, hsl(var(--foreground)) 0 2px, transparent 2px 4px, hsl(var(--foreground)) 4px 5px, transparent 5px 8px, hsl(var(--foreground)) 8px 11px, transparent 11px 12px)",
              }}
            />
          </div>
        </div>

        {/* Actions, off the paper. */}
        <div className="flex flex-wrap justify-center gap-2 print:hidden">
          <Button variant="secondary" onClick={onClose} className="rounded-xl">
            Close
          </Button>
          {docs.invoiceDownload && (
            <Button variant="secondary" className="rounded-xl" asChild>
              <a href={docs.invoiceDownload} target="_blank" rel="noopener noreferrer">
                Invoice PDF
              </a>
            </Button>
          )}
          <Button onClick={() => window.print()} className="rounded-xl">
            Print receipt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
