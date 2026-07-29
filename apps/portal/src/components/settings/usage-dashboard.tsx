"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { Skeleton } from "@/components/ui/skeleton";

/** How many invoices to show before the tenant asks for more. */
const RECENT_INVOICE_COUNT = 3;

// ── Helpers ──────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function formatCurrencyFromCents(amount: number, currency = "usd") {
  return formatCurrency(amount / 100, currency);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Invoice History Table ────────────────────────────────────────────

function InvoiceHistoryTable({
  invoices,
  onViewInvoice,
}: {
  invoices: TenantSubscriptionInvoice[];
  onViewInvoice: (invoice: TenantSubscriptionInvoice) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (invoices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No invoices yet</p>
    );
  }

  // Show the three most recent transactions by default. Older invoices stay
  // reachable behind "Show all" rather than being discarded — a tenant may
  // legitimately need to pull an older receipt for their accountant.
  const visibleInvoices = showAll
    ? invoices
    : invoices.slice(0, RECENT_INVOICE_COUNT);
  const hiddenCount = invoices.length - visibleInvoices.length;

  return (
    // `w-full` alone let the six columns crush into each other instead of
    // scrolling — the wrapper could never overflow because the table always
    // shrank to fit it. A min-width gives the scroller something to scroll.
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[36rem]">
        <thead>
          <tr className="border-b bg-primary/5">
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
              Period
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
              Base
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
              Usage
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-semibold text-primary">
              Total
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
              Status
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-semibold text-primary">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleInvoices.map((inv) => {
            const hasUsageBreakdown = inv.base_amount != null;
            // Prefer the PDF (a real downloadable receipt); fall back to the
            // hosted invoice page. Verified in prod: all existing invoice rows
            // carry both, so this is populated in practice — but a row whose
            // webhook never landed can have neither, and we show a disabled
            // control rather than a dead link.
            const documentUrl =
              inv.stripe_invoice_pdf || inv.stripe_hosted_invoice_url || null;
            return (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-2.5 px-3 text-sm text-muted-foreground">
                  {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                </td>
                <td className="whitespace-nowrap py-2.5 px-3 text-sm text-right tabular-nums text-muted-foreground">
                  {hasUsageBreakdown
                    ? formatCurrencyFromCents(inv.base_amount!, inv.currency)
                    : "—"}
                </td>
                <td className="whitespace-nowrap py-2.5 px-3 text-sm text-right tabular-nums text-muted-foreground">
                  {hasUsageBreakdown && inv.usage_amount
                    ? `${formatCurrencyFromCents(inv.usage_amount, inv.currency)} (${inv.usage_quantity || 0})`
                    : "—"}
                </td>
                <td className="whitespace-nowrap py-2.5 px-3 text-sm text-right font-medium tabular-nums">
                  {formatCurrencyFromCents(inv.amount_due, inv.currency)}
                </td>
                <td className="py-2.5 px-3 text-sm">
                  <span
                    className={
                      inv.status === "paid"
                        ? "text-green-500"
                        : inv.status === "open"
                          ? "text-orange-500"
                          : "text-muted-foreground"
                    }
                  >
                    {inv.status === "paid"
                      ? "Paid"
                      : inv.status === "open"
                        ? "Open"
                        : inv.status}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-sm">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => onViewInvoice(inv)}
                      className="text-primary hover:underline"
                    >
                      View
                    </button>
                    {(inv.status === "open" || inv.status === "uncollectible") && inv.stripe_hosted_invoice_url && (
                      <a
                        href={inv.stripe_hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-orange-600 hover:underline"
                      >
                        Pay
                      </a>
                    )}
                    {documentUrl ? (
                      <a
                        href={documentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Download invoice"
                        aria-label={`Download invoice for ${formatDate(inv.period_start)}`}
                        className="text-muted-foreground transition-colors hover:text-primary"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    ) : (
                      <span
                        title="Invoice document not available"
                        aria-label="Invoice document not available"
                        className="cursor-not-allowed text-muted-foreground/40"
                      >
                        <Download className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(hiddenCount > 0 || showAll) && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 px-3 text-sm font-medium text-primary hover:underline"
        >
          {showAll
            ? "Show less"
            : `Show all ${invoices.length} invoices`}
        </button>
      )}
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────

export function UsageDashboard({
  invoices,
  invoicesLoading,
  onViewInvoice,
}: {
  invoices: TenantSubscriptionInvoice[];
  invoicesLoading: boolean;
  onViewInvoice: (invoice: TenantSubscriptionInvoice) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Invoices</h3>
      {invoicesLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <InvoiceHistoryTable
          invoices={invoices}
          onViewInvoice={onViewInvoice}
        />
      )}
    </div>
  );
}
