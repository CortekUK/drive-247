/**
 * AccountingSyncStripe — Sprint 3, Spec §10.7.
 *
 * Embedded on the rental detail page underneath the Payments section. Shows
 * every financial_event for the rental and its sync state per active provider.
 *
 * Display:
 *   ✓ Invoice INV-04127 · Synced 12 May 2026
 *   ✓ Payment £450 · Synced 12 May 2026
 *   ⏳ Damage charge £150 · Pending
 *   ✗ Late fee £25 · Failed → [click to open failure detail]
 *
 * Hidden entirely when:
 *   - Tenant has no active accounting_connections rows
 *   - There are zero financial_events for this rental
 */
"use client";

import { useMemo } from "react";
import { CheckCircle2, Clock, XCircle, MinusCircle, Calculator } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalAccountingState, type SyncLogRow, type SyncStateValue } from "@/hooks/use-accounting-sync";

const STATE_LABEL: Record<SyncStateValue, string> = {
  synced: "Synced",
  pending: "Pending",
  syncing: "Syncing",
  failed: "Failed",
  skipped: "Skipped",
};

const STATE_ICON: Record<SyncStateValue, typeof CheckCircle2> = {
  synced: CheckCircle2,
  pending: Clock,
  syncing: Clock,
  failed: XCircle,
  skipped: MinusCircle,
};

const STATE_COLOUR: Record<SyncStateValue, string> = {
  synced: "text-emerald-600",
  pending: "text-blue-600",
  syncing: "text-indigo-600",
  failed: "text-red-600",
  skipped: "text-zinc-500",
};

const fmtMoney = (cents: number, currency: string) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents) / 100;
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(abs)}`;
};

function prettyEventType(raw: string): string {
  return raw.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

interface Props {
  rentalId: string;
}

export function AccountingSyncStripe({ rentalId }: Props) {
  const { tenant } = useTenant();
  const hasActiveConnection = (tenant as { integration_xero?: boolean; integration_zoho_books?: boolean } | null)?.integration_xero
    || (tenant as { integration_xero?: boolean; integration_zoho_books?: boolean } | null)?.integration_zoho_books;

  const query = useRentalAccountingState(hasActiveConnection ? rentalId : null);

  // Group by provider so we render two stripes if both connected.
  const byProvider = useMemo(() => {
    const map = new Map<string, SyncLogRow[]>();
    for (const row of query.data ?? []) {
      const list = map.get(row.provider) ?? [];
      list.push(row);
      map.set(row.provider, list);
    }
    return map;
  }, [query.data]);

  if (!hasActiveConnection) return null;
  if (query.isLoading) return null;       // Hidden during load — don't flash a stripe and then hide it
  if (byProvider.size === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Accounting</span>
      </div>

      <div className="space-y-3">
        {[...byProvider.entries()].map(([provider, rows]) => (
          <div key={provider}>
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              {provider === "xero" ? "Xero" : "Zoho Books"}
            </div>
            <ul className="space-y-1.5">
              {rows.map((row) => {
                const Icon = STATE_ICON[row.state];
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${STATE_COLOUR[row.state]}`} />
                      <span className="font-medium">{prettyEventType(row.event?.event_type ?? "")}</span>
                      {row.event && (
                        <span className="text-muted-foreground">{fmtMoney(row.event.amount_cents, row.event.currency)}</span>
                      )}
                      {row.external_invoice_id && (
                        <span className="text-muted-foreground">· {row.external_invoice_id.slice(0, 12)}</span>
                      )}
                    </div>
                    <span className={`text-[11px] ${STATE_COLOUR[row.state]}`}>
                      {STATE_LABEL[row.state]}
                      {row.state === "synced" && row.synced_at && ` ${new Date(row.synced_at).toLocaleDateString()}`}
                      {row.state === "failed" && row.last_error_code && ` · ${row.last_error_code}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
