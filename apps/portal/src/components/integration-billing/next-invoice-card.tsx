"use client";

/**
 * Next invoice — the integration-billing tenant's Billing page (build spec D11).
 *
 * "Next invoice kab aayegi" and, line by line, what is on it:
 *
 *   Platform subscription                      $200.00
 *   Inshur subscription                         $20.00
 *   ─────────────────────────────────────────────────
 *   Total                                      $220.00
 *
 * never one merged "$220" ("200 alag likha, 20 alag likha — ye do line
 * banegi"). The rows are Stripe's own upcoming-invoice preview for the
 * tenant's platform subscription, labelled by the edge function — so this is
 * also the honest answer to "what happens when that day comes": it is exactly
 * what Stripe will bill, not a sum computed here.
 */
import type { ReactNode } from "react";
import { CalendarDays, Receipt } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsLoadError } from "@/components/settings-v2/section-states";
import { formatBillDate, formatMoney, formatSignedMoney } from "@/lib/integration-billing/catalog";
import { useUpcomingInvoice } from "@/lib/integration-billing/hooks";
import { IntegrationBillingError, type InvoiceLine } from "@/lib/integration-billing/api-client";

/** The rows of an invoice, then its total. Shared with the receipt viewer. */
export function InvoiceLinesTable({
  lines,
  total,
  amountDue,
  currency,
  balanced,
}: {
  lines: InvoiceLine[];
  total: number;
  amountDue: number;
  currency: string;
  balanced: boolean;
}) {
  return (
    <div>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((line, i) => (
            <tr key={`${line.kind}-${line.integrationKey ?? ""}-${i}`} className="border-b border-border/60">
              <td className="py-2.5 pr-3 text-foreground">{line.label}</td>
              <td
                className={
                  "whitespace-nowrap py-2.5 text-right tabular-nums " +
                  (line.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")
                }
              >
                {formatSignedMoney(line.amount, currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 pr-3 font-semibold text-foreground">Total</td>
            <td className="whitespace-nowrap pt-3 text-right font-semibold tabular-nums text-foreground">
              {formatSignedMoney(total, currency)}
            </td>
          </tr>
          {amountDue !== total && (
            <tr>
              <td className="pt-1 pr-3 text-muted-foreground">Amount due, after your account credit</td>
              <td className="whitespace-nowrap pt-1 text-right tabular-nums text-muted-foreground">
                {formatMoney(amountDue, currency)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>
      {!balanced && (
        <p className="mt-2 text-xs text-muted-foreground">
          The lines above do not add up to the total exactly. The total is what Stripe will charge.
        </p>
      )}
    </div>
  );
}

export function NextInvoiceCard() {
  const { data, isLoading, error, refetch, isFetching } = useUpcomingInvoice({ enabled: true });

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-2.5" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  } else if (error) {
    body =
      error instanceof IntegrationBillingError && error.code === "not_set_up" ? (
        <p className="text-sm text-muted-foreground">
          Your next invoice will show here line by line once premium integrations are switched on.
        </p>
      ) : (
        <SettingsLoadError
          thing="your next invoice"
          error={error}
          reason={error.message}
          onRetry={() => refetch()}
          retrying={isFetching}
          variant="inline"
        />
      );
  } else if (!data) {
    body = (
      <p className="text-sm text-muted-foreground">
        There is no upcoming invoice on your plan right now.
      </p>
    );
  } else {
    const date = formatBillDate(data.date);
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          {date ? (
            <span>
              Billed on <span className="font-medium text-foreground">{date}</span>
            </span>
          ) : (
            <span>Billed on your next billing date</span>
          )}
        </div>
        <InvoiceLinesTable
          lines={data.lines}
          total={data.total}
          amountDue={data.amountDue}
          currency={data.currency}
          balanced={data.balanced}
        />
      </div>
    );
  }

  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Receipt className="size-4 text-muted-foreground" aria-hidden />
        Next invoice
      </h2>
      <div className="rounded-lg border bg-card p-5">{body}</div>
    </section>
  );
}
