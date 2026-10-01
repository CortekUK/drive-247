"use client";

import type React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import type { TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { BILLING_STATUS_LABEL, billingDocumentsOf, billingStatusOf } from "@/lib/billing-documents";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";

/**
 * Payment history, opened from the big number on v2 Billing. ONE timeline, in
 * the order an operator cares about them:
 *
 *   - Upcoming — the next bill: when, and how much.
 *   - Overdue & unpaid — every OPEN invoice (failed, overdue or just due),
 *     each with Pay now. Status comes from `billingStatusOf`, the one place
 *     Billing derives failed / overdue / due, so this can't disagree with it.
 *   - Past payments — paid (and refunded) invoices, newest first, with the
 *     receipt and the invoice.
 */

function period(inv: TenantSubscriptionInvoice): string {
  const a = formatBillDate(inv.period_start);
  const b = formatBillDate(inv.period_end);
  return a && b ? `${a} – ${b}` : a ?? b ?? "—";
}

const newestFirst = (a: TenantSubscriptionInvoice, b: TenantSubscriptionInvoice) =>
  (b.period_start ?? b.created_at ?? "").localeCompare(a.period_start ?? a.created_at ?? "");

export function PaymentHistoryDialogV2({
  open,
  onOpenChange,
  invoices,
  upcoming,
  onViewInvoice,
  payDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoices: TenantSubscriptionInvoice[];
  /** The next bill, when there is one. */
  upcoming: { date: string | null; amount: number | null; currency: string; estimated: boolean } | null;
  /** Opens the receipt viewer the page already has. */
  onViewInvoice: (inv: TenantSubscriptionInvoice) => void;
  /** Sample data: money actions are switched off. */
  payDisabled: boolean;
}) {
  const withStatus = invoices.map((inv) => ({ inv, status: billingStatusOf(inv) }));
  const unpaid = withStatus
    .filter((r) => r.status === "failed" || r.status === "overdue" || r.status === "due")
    .sort((a, b) => newestFirst(a.inv, b.inv));
  const past = withStatus
    .filter((r) => r.status === "paid" || r.status === "refunded")
    .sort((a, b) => newestFirst(a.inv, b.inv));

  /* ONE trail, oldest at the top and the next bill at the bottom — read down
     it the way time runs. Same timeline as "Price breakdown". Built
     newest-first below, then reversed once. */
  type Item = {
    key: string;
    dot: string;
    /** A very light wash of the row's state colour. */
    tint: string;
    caption: string | null;
    title: string;
    sub: React.ReactNode;
    right: React.ReactNode;
  };
  const items: Item[] = [];

  if (upcoming && (upcoming.date || upcoming.amount != null)) {
    items.push({
      key: "upcoming",
      dot: "bg-amber-400",
      tint: "bg-amber-50/70 dark:bg-amber-500/[0.07]",
      caption: formatBillDate(upcoming.date),
      title: "Next bill",
      sub: <span className="text-foreground">{upcoming.estimated ? "Upcoming · estimated" : "Upcoming"}</span>,
      right: (
        <span className="text-sm font-semibold tabular-nums">
          {upcoming.amount != null ? formatMoney(upcoming.amount, upcoming.currency) : "—"}
        </span>
      ),
    });
  }

  for (const { inv, status } of unpaid) {
    const docs = billingDocumentsOf(inv);
    const due = status === "due";
    const canPay = !!docs.invoiceView && !payDisabled;
    items.push({
      key: inv.id,
      dot: due ? "bg-amber-400" : "bg-red-500",
      tint: due ? "bg-amber-50/70 dark:bg-amber-500/[0.07]" : "bg-red-50/70 dark:bg-red-500/[0.07]",
      caption: formatBillDate(inv.due_date ?? inv.period_start),
      title: period(inv),
      sub: (
        <span className="text-foreground">{BILLING_STATUS_LABEL[status]}</span>
      ),
      right: (
        <div className="flex items-baseline gap-4">
          <span className="text-sm font-semibold tabular-nums">{formatMoney(inv.amount_due, inv.currency)}</span>
          {canPay ? (
            <a href={docs.invoiceView!} target="_blank" rel="noopener noreferrer" className={LINK}>
              Pay now
            </a>
          ) : (
            <span className="text-sm text-muted-foreground/60">Pay now</span>
          )}
        </div>
      ),
    });
  }

  for (const { inv, status } of past) {
    const docs = billingDocumentsOf(inv);
    items.push({
      key: inv.id,
      dot: status === "paid" ? "bg-green-500" : "bg-blue-500",
      tint: status === "paid" ? "bg-green-50/70 dark:bg-green-500/[0.07]" : "bg-blue-50/70 dark:bg-blue-500/[0.07]",
      caption: formatBillDate(inv.paid_at ?? inv.period_start),
      title: period(inv),
      sub: (
        <span className="text-foreground">{BILLING_STATUS_LABEL[status]}</span>
      ),
      right: (
        <div className="flex items-baseline gap-4">
          <span className="text-sm font-semibold tabular-nums">{formatMoney(inv.amount_paid, inv.currency)}</span>
          <button type="button" onClick={() => onViewInvoice(inv)} className={LINK}>
            View
          </button>
          {docs.receiptView && (
            <a href={docs.receiptView} target="_blank" rel="noopener noreferrer" className={LINK}>
              Receipt
            </a>
          )}
        </div>
      ),
    });
  }

  items.reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-7 pb-2 pt-7 text-left">
          <DialogTitle>Payment history</DialogTitle>
          <DialogDescription>Your next bill, anything unpaid, and what you&apos;ve paid.</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-7 pb-7 pt-5">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills yet.</p>
          ) : (
            /* The line is drawn per row so it FITS the trail: it starts at the
               first dot, runs through the gaps, and stops at the last dot —
               no tail above or below. Each dot sits on its row's centre. */
            <ol className="space-y-3">
              {items.map((it, i) => {
                const first = i === 0;
                const last = i === items.length - 1;
                return (
                  <li key={it.key} className="relative flex items-stretch gap-4">
                    <div aria-hidden className="relative w-2 shrink-0">
                      {items.length > 1 && (
                        <span
                          className="absolute left-1/2 w-px -translate-x-1/2 bg-border"
                          style={{ top: first ? "50%" : "-0.75rem", bottom: last ? "50%" : "0" }}
                        />
                      )}
                      <span className={`absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ring-4 ring-background ${it.dot}`} />
                    </div>
                    <div className={`flex min-w-0 flex-1 items-center justify-between gap-4 rounded-xl px-4 py-3 ${it.tint}`}>
                      <div className="min-w-0">
                        {it.caption && (
                          <p className="mb-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{it.caption}</p>
                        )}
                        <p className="text-sm font-medium">{it.title}</p>
                        <p className="mt-0.5 text-xs">{it.sub}</p>
                      </div>
                      <div className="shrink-0">{it.right}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const LINK =
  "text-sm text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none";
