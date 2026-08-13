/**
 * AccountingSyncLog — Sprint 3 surface (Spec §10.5).
 *
 * Settings → Accounting → View sync log. Shows the queue of every financial
 * event we've tried to sync to the connected provider:
 *   - 4 KPI tiles (Synced / Pending / Failed / Total)
 *   - Filter dropdowns (status + date range)
 *   - Paginated table — event type, rental, amount, status badge, time, action
 *   - Row click → AccountingSyncFailureDrawer with the error + fix-link
 *
 * The KPI tiles refresh every 60s so the operator sees the queue draining
 * in near-real-time after a backfill or after clicking Retry.
 */
"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Clock, XCircle, MinusCircle, ChevronLeft, ChevronRight, RefreshCw, Search, ExternalLink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useAccountingSyncLog,
  useAccountingSyncStats,
  useRetryAccountingSync,
  type SyncLogRow,
  type SyncStateValue,
} from "@/hooks/use-accounting-sync";
import type { AccountingProvider } from "@/hooks/use-accounting-connection";

const STATE_STYLE: Record<SyncStateValue, string> = {
  synced:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  pending: "bg-blue-50 text-blue-700 border-blue-200",
  syncing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  failed:  "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-zinc-50 text-zinc-600 border-zinc-200",
};
const STATE_ICON: Record<SyncStateValue, typeof CheckCircle2> = {
  synced: CheckCircle2,
  pending: Clock,
  syncing: Clock,
  failed: XCircle,
  skipped: MinusCircle,
};

const fmtMoney = (cents: number, currency: string) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents) / 100;
  return `${sign}${new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(abs)}`;
};

interface Props {
  provider: AccountingProvider;
  onBack: () => void;
}

export function AccountingSyncLog({ provider, onBack }: Props) {
  const [stateFilter, setStateFilter] = useState<SyncStateValue | "all">("all");
  const [sinceFilter, setSinceFilter] = useState<string>("30"); // days
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [drawerRow, setDrawerRow] = useState<SyncLogRow | null>(null);

  const pageSize = 25;
  // CRITICAL: this MUST be memoised — recalculating on every render produces
  // a new ISO timestamp every paint, which means the queryKey changes every
  // render and React Query keeps cancelling the in-flight fetch. Result: the
  // log query is stuck in `fetchStatus=fetching` forever. Memoising to depend
  // only on `sinceFilter` makes the queryKey stable across renders.
  const since = useMemo(
    () => (sinceFilter === "all" ? null : new Date(Date.now() - Number(sinceFilter) * 86_400_000).toISOString()),
    [sinceFilter],
  );

  const stats = useAccountingSyncStats(provider);
  const log = useAccountingSyncLog({ provider, state: stateFilter, since, search, page, pageSize });

  const totalPages = Math.max(1, Math.ceil((log.data?.total ?? 0) / pageSize));

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to Accounting
        </button>
        <h2 className="text-lg font-semibold">
          Sync log — {provider === "xero" ? "Xero" : "Zoho Books"}
        </h2>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Synced" value={stats.data?.synced ?? 0} tone="positive" />
        <KpiTile label="Pending" value={stats.data?.pending ?? 0} tone="info" />
        <KpiTile label="Failed" value={stats.data?.failed ?? 0} tone="negative" />
        <KpiTile label="Total" value={stats.data?.total ?? 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={stateFilter} onValueChange={(v) => { setStateFilter(v as SyncStateValue | "all"); setPage(0); }}>
          <SelectTrigger className="h-9 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="synced">Synced</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sinceFilter} onValueChange={(v) => { setSinceFilter(v); setPage(0); }}>
          <SelectTrigger className="h-9 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative ml-2 flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search invoice # or error…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="h-9 pl-7 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { log.refetch(); stats.refetch(); }}
          disabled={log.isFetching}
          className="ml-auto h-9 text-xs"
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${log.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* DEBUG — temporarily visible until the rendering bug is resolved */}
      <div className="rounded bg-yellow-50 px-3 py-2 text-[11px] font-mono text-amber-900">
        DEBUG: data={log.data ? `rows=${log.data.rows?.length ?? "?"}, total=${log.data.total ?? "?"}` : "undefined"}
        {" · "}status={log.status}
        {" · "}fetchStatus={log.fetchStatus}
        {" · "}isError={String(log.isError)}
        {log.error && ` · error=${log.error instanceof Error ? log.error.message : String(log.error)}`}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {((log.data?.rows?.length ?? 0) === 0) && !log.data && !log.isError ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : log.isError ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-rose-600">Couldn&apos;t load sync log</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {log.error instanceof Error ? log.error.message : "Unknown error fetching sync state."}
                {" "}Try refreshing — if it keeps failing, your Xero connection may have expired (reconnect from the Accounting tab).
              </p>
            </div>
          ) : (log.data?.rows ?? []).length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-foreground">No sync events yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Drive247 will start logging here the moment you take a payment, add a damage charge, refund, or extend a rental.
                Until then there&apos;s nothing to sync.
                {(stateFilter !== "all" || search) && " (Or your current filters may be hiding existing rows — try clearing them.)"}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              <li className="grid grid-cols-[1fr_120px_120px_120px_140px_100px] items-center gap-3 px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Event</span><span>Rental</span><span className="text-right">Amount</span><span>Status</span><span>Time</span><span className="text-right">Action</span>
              </li>
              {(log.data?.rows ?? []).map((row) => {
                const Icon = STATE_ICON[row.state];
                return (
                  <li
                    key={row.id}
                    onClick={() => setDrawerRow(row)}
                    className="grid cursor-pointer grid-cols-[1fr_120px_120px_120px_140px_100px] items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
                  >
                    <span className="truncate">
                      <span className="font-medium">{prettyEventType(row.event?.event_type ?? "—")}</span>
                      {row.event?.description && <span className="ml-1 text-[11px] text-muted-foreground">· {row.event.description}</span>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.event?.rental_id ? row.event.rental_id.slice(0, 8) : "—"}
                    </span>
                    <span className="text-right tabular-nums text-xs">
                      {row.event ? fmtMoney(row.event.amount_cents, row.event.currency) : "—"}
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      <Icon className="h-3 w-3" />
                      <Badge variant="outline" className={STATE_STYLE[row.state]}>{row.state}</Badge>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {row.synced_at ? new Date(row.synced_at).toLocaleString() :
                       row.last_attempt_at ? new Date(row.last_attempt_at).toLocaleString() :
                       new Date(row.created_at).toLocaleString()}
                    </span>
                    <span className="text-right">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        View →
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {(log.data?.total ?? 0) > pageSize && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, log.data?.total ?? 0)} of {log.data?.total ?? 0}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="h-8">
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="px-2">Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="h-8">
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Failure drawer */}
      <AccountingSyncFailureDrawer row={drawerRow} onClose={() => setDrawerRow(null)} onOpenMappings={onBack} />
    </div>
  );
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone?: "positive" | "negative" | "info" }) {
  const color = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : tone === "info" ? "text-blue-600" : "text-foreground";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-medium tabular-nums ${color}`}>{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function prettyEventType(raw: string): string {
  return raw.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Failure drawer
// ─────────────────────────────────────────────────────────────────────────────

function AccountingSyncFailureDrawer({
  row, onClose, onOpenMappings,
}: { row: SyncLogRow | null; onClose: () => void; onOpenMappings: () => void }) {
  const retry = useRetryAccountingSync();
  if (!row) return null;

  const isFailed = row.state === "failed";
  const isSkippable = ["pending", "failed"].includes(row.state);

  return (
    <Sheet open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-base">
            {prettyEventType(row.event?.event_type ?? "")}
            {row.event?.amount_cents !== undefined && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {fmtMoney(row.event.amount_cents, row.event.currency)}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {row.state === "synced" ? "Synced successfully" : row.state === "failed" ? "Sync failed" : `Status: ${row.state}`}
            {row.synced_at && ` · ${new Date(row.synced_at).toLocaleString()}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <dl className="space-y-1 text-xs">
            <Row label="Provider" value={row.provider} />
            <Row label="Event ID" value={row.event?.id?.slice(0, 8) ?? "—"} />
            {row.event?.rental_id && <Row label="Rental" value={row.event.rental_id.slice(0, 8)} />}
            <Row label="Attempts" value={row.attempts.toString()} />
            {row.last_attempt_at && <Row label="Last attempted" value={new Date(row.last_attempt_at).toLocaleString()} />}
            {row.next_attempt_at && <Row label="Next attempt" value={new Date(row.next_attempt_at).toLocaleString()} />}
            {row.external_invoice_id && <Row label="Invoice in provider" value={row.external_invoice_id.slice(0, 16)} />}
            {row.external_payment_id && <Row label="Payment in provider" value={row.external_payment_id.slice(0, 16)} />}
            {row.external_credit_note_id && <Row label="Credit note in provider" value={row.external_credit_note_id.slice(0, 16)} />}
          </dl>

          {isFailed && row.last_error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs">
              <div className="mb-1 font-medium text-red-900">Error</div>
              <p className="text-red-800">{row.last_error}</p>
              {row.last_error_code && <p className="mt-1 text-[11px] text-red-700">code: {row.last_error_code}</p>}
            </div>
          )}

          {isFailed && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
              <div className="mb-1 font-medium text-amber-900">Likely fix</div>
              <p className="text-amber-800">{likelyFixForError(row.last_error_code, row.last_error)}</p>
              {(row.last_error_code === "NO_MAPPING" || row.last_error_code === "NO_PAYMENT_ACCOUNT" || row.last_error_code === "VALIDATION") && (
                <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={onOpenMappings}>
                  Open mappings <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {isFailed && (
              <Button
                size="sm"
                onClick={async () => { await retry.mutateAsync({ syncStateId: row.id }); onClose(); }}
                disabled={retry.isPending}
                className="bg-[#0f172a] text-xs text-white hover:bg-[#0f172a]/90"
              >
                Retry now
              </Button>
            )}
            {isSkippable && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => { await retry.mutateAsync({ syncStateId: row.id, skip: true }); onClose(); }}
                disabled={retry.isPending}
                className="text-xs"
              >
                Mark skipped
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function likelyFixForError(code: string | null, message: string | null): string {
  if (!code && !message) return "No specific guidance — try retrying. If it keeps failing, check the connection isn't expired.";
  if (code === "NO_MAPPING") return "Open Configure mappings and pick an active account for this event type.";
  if (code === "NO_PAYMENT_ACCOUNT") return "Open Configure mappings and pick a bank/clearing account in the Payment account section.";
  if (code === "AUTH" || code === "NO_ACTIVE_CONNECTION") return "Your provider connection has expired. Reconnect from the Accounting tab.";
  if (code === "RATE_LIMIT") return "Provider rate limit hit. We back off automatically — no action needed.";
  if (code === "DUPLICATE") return "This event was already synced. Mark as skipped or refresh.";
  if (code === "WAITING_FOR_INVOICE") return "Waiting for the source invoice to sync first. Will retry automatically.";
  if (code === "VALIDATION") return "Provider rejected the data. Check your mapping (account code may be inactive in the provider).";
  return "Try retrying. If it keeps failing, mark as skipped or contact support.";
}
