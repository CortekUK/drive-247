"use client";

import { TenantSubscriptionInvoice } from "@/hooks/use-tenant-subscription";
import { Skeleton } from "@/components/ui/skeleton";

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
  if (invoices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No invoices yet</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
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
          {invoices.map((inv) => {
            const hasUsageBreakdown = inv.base_amount != null;
            return (
              <tr key={inv.id} className="border-b last:border-0">
                <td className="py-2.5 px-3 text-sm text-muted-foreground">
                  {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">
                  {hasUsageBreakdown
                    ? formatCurrencyFromCents(inv.base_amount!, inv.currency)
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right text-muted-foreground">
                  {hasUsageBreakdown && inv.usage_amount
                    ? `${formatCurrencyFromCents(inv.usage_amount, inv.currency)} (${inv.usage_quantity || 0})`
                    : "—"}
                </td>
                <td className="py-2.5 px-3 text-sm text-right font-medium">
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
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
