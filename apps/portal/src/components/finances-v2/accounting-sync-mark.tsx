"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useTenant } from "@/contexts/TenantContext";
import {
  type AccountingProvider,
  type SyncItemRow,
  useAccountingConnections,
  useSyncItemsLive,
  useSyncMarks,
} from "@/hooks/use-accounting-v2";
import { cn } from "@/lib/utils";

/**
 * "Synced to Xero / Zoho" on a payment or refund row of the invoice drawer.
 *
 * The provider's own mark, 14px, beside the amount — the same logo.dev marks
 * the Integrations board uses. Sent: the plain logo. Waiting: faded. Failed:
 * faded with an amber ring. The tooltip says which and when (or why not).
 * Nothing at all when no accounting integration is connected; one mark per
 * connected provider when both are.
 *
 * `AccountingSyncMarks` loads the state of every payment on the invoice in ONE
 * query and keeps it live; each `SyncMark` only reads from it.
 */

// logo.dev — publishable key (safe client-side), as integrations-board.tsx.
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const LOGO_DOMAIN: Record<AccountingProvider, string> = { xero: "xero.com", zoho: "zoho.com" };
const SHORT: Record<AccountingProvider, string> = { xero: "Xero", zoho: "Zoho" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { providers: AccountingProvider[]; byKey: Map<string, SyncItemRow> };
const SyncMarksContext = createContext<Ctx | null>(null);

export function AccountingSyncMarks({ paymentIds, children }: { paymentIds: string[]; children: React.ReactNode }) {
  const { tenant } = useTenant();
  const conns = useAccountingConnections(tenant?.id);
  const providers = useMemo(
    () => (conns.data ?? [])
      .filter((c) => c.status === "connected" || c.status === "needs_reauth" || c.status === "error")
      .map((c) => c.provider),
    [conns.data],
  );
  // Mock (preview) payments carry non-uuid ids: they have no sync state to look up.
  const ids = useMemo(() => paymentIds.filter((id) => UUID.test(id)), [paymentIds]);
  const on = providers.length > 0;
  const marks = useSyncMarks(tenant?.id, ids, on);
  useSyncItemsLive(tenant?.id, on && ids.length > 0);

  const value = useMemo<Ctx>(() => {
    const byKey = new Map<string, SyncItemRow>();
    for (const r of marks.data ?? []) byKey.set(`${r.provider}:${r.source_type}:${r.source_id}`, r);
    return { providers, byKey };
  }, [providers, marks.data]);

  return <SyncMarksContext.Provider value={value}>{children}</SyncMarksContext.Provider>;
}

export function SyncMark({ kind, sourceId, className }: { kind: "payment" | "refund"; sourceId: string; className?: string }) {
  const ctx = useContext(SyncMarksContext);
  if (!ctx || ctx.providers.length === 0) return null;
  const marks = ctx.providers
    .map((p) => ({ provider: p, item: ctx.byKey.get(`${p}:${kind}:${sourceId}`) }))
    // No item: this payment is not in the books' scope (e.g. before the connection).
    .filter((m): m is { provider: AccountingProvider; item: SyncItemRow } => !!m.item);
  if (marks.length === 0) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", className)}>
      {marks.map((m) => <Mark key={m.provider} provider={m.provider} item={m.item} />)}
    </span>
  );
}

function Mark({ provider, item }: { provider: AccountingProvider; item: SyncItemRow }) {
  const [failed, setFailed] = useState(false);
  const name = SHORT[provider];
  const tip = item.status === "sent"
    ? `Synced to ${name}${item.sent_at ? ` · ${format(new Date(item.sent_at), "MMM d, yyyy")}` : ""}`
    : item.status === "waiting"
      ? `Waiting to sync to ${name}${item.last_error ? ` · ${item.last_error}` : ""}`
      : `Not synced to ${name} yet — ${item.last_error ?? "it failed"}. Retrying automatically.`;
  const tone = item.status === "sent" ? "" : item.status === "waiting" ? "opacity-45 grayscale" : "opacity-60 ring-1 ring-warning ring-offset-1 ring-offset-background";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={tip} className="inline-flex cursor-default rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {failed ? (
            <span className={cn("inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-muted text-[9px] font-bold text-muted-foreground", tone)}>
              {name[0]}
            </span>
          ) : (
            <img
              src={`https://img.logo.dev/${LOGO_DOMAIN[provider]}?token=${LOGO_TOKEN}&size=64&format=png`}
              alt=""
              className={cn("h-3.5 w-3.5 rounded-[3px] object-contain", tone)}
              onError={() => setFailed(true)}
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[18rem] text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
}

