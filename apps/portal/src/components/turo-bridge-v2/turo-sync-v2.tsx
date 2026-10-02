"use client";

/**
 * Turo Sync — the v2 screen (Ghulam, Oct 2 2026: "make the UI of it good and
 * minimal, just like the rest of the application").
 *
 * The same page as the rentals list in shape: a title with ONE primary action
 * on the right, a single row of quiet figures, one attention strip only when a
 * decision is waiting, and one table. Everything else the old five-tab screen
 * held — matching a Turo car, the import plan, possible cancellations and the
 * sync log — opens in a dialog, using the EXISTING screens from
 * `components/turo-bridge/` untouched. So nothing the operator could do before
 * is gone; it is just no longer all on the page at once.
 *
 * Reads exactly what the old screen read (`useTuroStagedReservations`, one
 * shared query, RLS-scoped and tenant-filtered) and writes nothing itself:
 * every write still happens inside the reused screens, confirmed there.
 *
 * `/turo-bridge` is canary-only (V2_AREAS.turo), so this screen reaches
 * northwind and nobody else.
 */

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, DownloadCloud, History, RefreshCw } from "lucide-react";
import { CoupeIcon } from "@/components/icons/coupe-icon";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Card, CardContent } from "@/components/ui-v2/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui-v2/table";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { useTenant } from "@/contexts/TenantContext";
import { describeSyncFreshness, useTuroStagedReservations, type TuroBridgeRow } from "@/hooks/use-turo-bridge";
import { useTuroVehicleMapQueue } from "@/hooks/use-turo-vehicle-map";
import { MatchCarsV2 } from "@/components/turo-bridge-v2/match-cars-v2";
import { PromotionReviewScreen } from "@/components/turo-bridge/promotion-review";
import { CancellationScreen } from "@/components/turo-bridge/cancellation-candidates";
import { SyncHistoryScreen } from "@/components/turo-bridge/sync-history";

type Panel = "match" | "import" | "cancel" | "history" | null;
type Filter = "all" | "ready" | "car" | "past";

/** `5 Oct`, or `5 Oct 2027` outside this year — the rentals list's own format. */
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function fmtMoney(n: number | null | undefined, currency: string): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(n));
  } catch {
    return `${Number(n).toFixed(2)} ${currency}`;
  }
}

/** One word per row, coloured text only (the design system's status rule). */
function rowStatus(r: TuroBridgeRow, now: number): { label: string; tone: string } {
  const state = (r as { sync_state?: string }).sync_state;
  const presence = (r as { presence_state?: string }).presence_state;
  if (presence === "MISSING" || state === "cancellation_candidate") return { label: "Missing on Turo", tone: "text-destructive" };
  if (state === "promoted") return { label: "Imported", tone: "text-success" };
  if (state === "ignored") return { label: "Ignored", tone: "text-muted-foreground" };
  if (state === "conflict") return { label: "Needs a look", tone: "text-warning" };
  if (state === "pending_match") return { label: "Needs a car", tone: "text-warning" };
  const ended = r.ends_at ? new Date(r.ends_at).getTime() < now : false;
  if (ended) return { label: "Finished", tone: "text-muted-foreground" };
  return { label: "Ready to import", tone: "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" };
}

export function TuroSyncV2({ resolving = false }: { resolving?: boolean }) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const reservations = useTuroStagedReservations();
  const mapQueue = useTuroVehicleMapQueue();
  const [panel, setPanel] = useState<Panel>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const rows = reservations.allRows;
  const counts = reservations.counts;
  const [now] = useState(() => Date.now());

  const freshness = useMemo(() => describeSyncFreshness(rows), [rows]);
  const upcoming = useMemo(() => rows.filter((r) => r.starts_at && new Date(r.starts_at).getTime() > now).length, [rows, now]);
  // Ready = staged AND still to come: a finished Turo trip is history, not a booking to import.
  const readyCount = useMemo(() => rows.filter((r) => rowStatus(r, now).label === "Ready to import").length, [rows, now]);
  const needCar = counts.byState.pending_match ?? 0;
  const missing = counts.byState.cancellation_candidate ?? 0;
  const carsToMatch = mapQueue.counts.awaiting;

  const visible = useMemo(() => {
    // Still to come first (soonest first), then finished trips (latest first).
    const end = (r: TuroBridgeRow) => (r.ends_at ? new Date(r.ends_at).getTime() : 0);
    const sorted = [...rows].sort((a, b) => {
      const aDone = end(a) < now;
      const bDone = end(b) < now;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return aDone ? (b.starts_at ?? "").localeCompare(a.starts_at ?? "") : (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
    });
    return sorted.filter((r) => {
      const st = rowStatus(r, now).label;
      if (filter === "ready") return st === "Ready to import";
      if (filter === "car") return st === "Needs a car";
      if (filter === "past") return st === "Finished";
      return true;
    });
  }, [rows, filter, now]);

  // One simple graph (the hero pattern): what Turo trips were worth, by the
  // day they started — trips still to come are not history yet, so they land
  // on the graph the day they begin. Counted from the rows on this page.
  const metrics = useMemo<HeroMetric[]>(() => {
    const started = rows.filter((r) => r.starts_at && new Date(r.starts_at).getTime() <= now);
    return [
      {
        key: "turo-earnings",
        label: "Turo trip value",
        kind: "flow",
        description: "What your Turo trips were booked for, on the day each one started. Turo's totals, not money paid out to you.",
        format: (v) => fmtMoney(v, currency),
        events: started.map((r) => ({ at: new Date(r.starts_at as string), amount: Number(r.total_amount) || 0 })),
      },
      {
        key: "turo-trips",
        label: "Turo trips",
        kind: "flow",
        description: "Turo trips, on the day each one started.",
        format: (v) => v.toLocaleString(),
        events: started.map((r) => ({ at: new Date(r.starts_at as string), amount: 1 })),
      },
    ];
  }, [rows, now, currency]);

  const isLoading = useSkeletonLoading(resolving || reservations.isLoading);
  const lastSync = freshness.lastSyncedAt
    ? `Synced ${formatDistanceToNow(new Date(freshness.lastSyncedAt), { addSuffix: true })}`
    : "Not synced yet";

  const FILTERS: [Filter, string, number][] = [
    ["all", "All", rows.length],
    ["ready", "Ready", readyCount],
    ["car", "Needs a car", needCar],
    ["past", "Finished", rows.filter((r) => rowStatus(r, now).label === "Finished").length],
  ];

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      {/* Header — the rentals list's: title left, one cluster right. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">Turo Sync</h1>
          <p className="text-sm text-muted-foreground sm:text-base">Your Turo trips, read by the Turo Bridge extension.</p>
        </div>
        <div className={cn("flex shrink-0 items-center gap-2", HEADER_ACTIONS_V2)}>
          <span className="hidden text-xs text-muted-foreground md:inline">{lastSync}</span>
          <HeaderIconButton label="Refresh" onClick={() => reservations.refetch()}>
            <RefreshCw className={cn("size-4", reservations.isFetching && "animate-spin")} />
          </HeaderIconButton>
          <HeaderIconButton label="Sync history" onClick={() => setPanel("history")}>
            <History className="size-4" />
          </HeaderIconButton>
          <Button
            onClick={() => setPanel("import")}
            disabled={readyCount === 0}
            className={cn("bg-gradient-primary text-white shadow-md transition-all duration-200 hover:opacity-90 hover:shadow-lg", HEADER_PRIMARY_V2)}
          >
            <DownloadCloud className="h-4 w-4" />
            {readyCount ? `Import ${readyCount} trip${readyCount === 1 ? "" : "s"}` : "Nothing to import"}
          </Button>
        </div>
      </div>

      <AutoSkeleton loading={isLoading} className="space-y-6">
        {/* The hero row — the Rentals / Vehicles / Customers pattern: one
            simple graph over three quarters of the row, one card beside it. */}
        <HeroRow
          chart={<HeroChart metrics={metrics} anchor="turo-chart" />}
          card={
            <div className="flex min-h-[180px] flex-col justify-between rounded-2xl border border-primary/15 bg-gradient-to-b from-primary/[0.07] to-primary/[0.02] p-5 dark:border-[hsl(var(--v2-link,var(--primary))_/_0.2)]">
              <div className="space-y-1.5">
                <p className="text-lg font-medium leading-snug text-foreground">
                  {carsToMatch
                    ? `${carsToMatch} Turo car${carsToMatch === 1 ? "" : "s"} to match`
                    : missing
                      ? `${missing} trip${missing === 1 ? "" : "s"} gone from Turo`
                      : readyCount
                        ? `${readyCount} trip${readyCount === 1 ? "" : "s"} ready`
                        : "All caught up"}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {carsToMatch
                    ? `${needCar} trip${needCar === 1 ? " is" : "s are"} waiting until you say which of your cars ${carsToMatch === 1 ? "it is" : "they are"}.`
                    : missing
                      ? "Check whether they were cancelled before their dates are released."
                      : readyCount
                        ? "Import them and they become ordinary Drive247 rentals."
                        : `${upcoming} upcoming Turo trip${upcoming === 1 ? "" : "s"}, all in hand.`}
                </p>
              </div>
              {(carsToMatch > 0 || missing > 0 || readyCount > 0) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-fit rounded-full"
                  onClick={() => setPanel(carsToMatch ? "match" : missing ? "cancel" : "import")}
                >
                  {carsToMatch ? "Match cars" : missing ? "Review" : "Import"}
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
            </div>
          }
        />

        {/* Filters — small chips, counts beside them. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors duration-200 motion-reduce:transition-none",
                filter === key
                  ? "border-primary/40 bg-primary/10 font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {label} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>

        {/* The trips — the rentals table's shape. */}
        <Card>
          <CardContent className="p-0 [&>[data-slot=table-container]]:overflow-visible">
            <Table className="min-w-[720px] table-fixed">
              <TableHeader className="bg-card/95">
                <TableRow className="border-b hover:bg-transparent">
                  {[
                    ["Guest", "w-[24%]"],
                    ["Car", "w-[26%]"],
                    ["Dates", "w-[22%]"],
                    ["Total", "w-[12%] text-right"],
                    ["Status", "w-[16%]"],
                  ].map(([h, w]) => (
                    <TableHead key={h} className={cn("h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", w)}>
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const st = rowStatus(r, now);
                  const plate = (r as { vehicle_plate?: string | null }).vehicle_plate;
                  const nights =
                    r.starts_at && r.ends_at
                      ? Math.max(1, Math.round((new Date(r.ends_at).getTime() - new Date(r.starts_at).getTime()) / 86_400_000))
                      : null;
                  return (
                    <TableRow key={r.id} className={st.label === "Needs a car" ? "cursor-pointer" : undefined} onClick={st.label === "Needs a car" ? () => setPanel("match") : undefined}>
                      <TableCell className="py-3">
                        <span className="block truncate font-medium text-foreground">{r.guest_name || "Turo guest"}</span>
                        <span className="block truncate text-[11px] tabular-nums text-muted-foreground">{r.reservation_id}</span>
                      </TableCell>
                      <TableCell className="py-3">
                        <span className="block truncate text-foreground">{r.vehicle_label || "Turo car"}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">{plate || "Not matched"}</span>
                      </TableCell>
                      <TableCell className="py-3 tabular-nums">
                        <span className="text-foreground">
                          {fmtDay(r.starts_at)} → {fmtDay(r.ends_at)}
                        </span>
                        {nights && <span className="block text-[11px] text-muted-foreground">{nights} day{nights === 1 ? "" : "s"}</span>}
                      </TableCell>
                      <TableCell className="py-3 text-right tabular-nums text-foreground">{fmtMoney(r.total_amount == null ? null : Number(r.total_amount), r.currency || currency)}</TableCell>
                      <TableCell className={cn("py-3 text-sm font-medium", st.tone)}>{st.label}</TableCell>
                    </TableRow>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      {rows.length === 0 ? "No Turo trips yet — run a sync from the extension." : "Nothing here."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="px-1 text-sm text-muted-foreground">
          A Turo trip is only knowledge until you import it — then it becomes an ordinary Drive247 rental.
        </p>
      </AutoSkeleton>

      {/* Each decision in its own dialog — the existing screens, untouched. */}
      <Dialog open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className={cn("no-scrollbar max-h-[88vh] overflow-y-auto p-6", panel === "match" ? "sm:max-w-2xl" : "sm:max-w-5xl")}>
          <DialogHeader>
            <DialogTitle>
              {panel === "match" ? "Match your Turo cars" : panel === "import" ? "Import trips" : panel === "cancel" ? "Possibly cancelled" : "Sync history"}
            </DialogTitle>
            <DialogDescription>
              {panel === "match"
                ? "Tell me which of your cars each Turo listing is, once — every trip on it then flows through."
                : panel === "import"
                  ? "Build the plan to see exactly what will be created. Nothing is written until you approve it."
                  : panel === "cancel"
                    ? "Trips that stopped showing on Turo. Nothing is released until you decide."
                    : "Every time the extension read your Turo account."}
            </DialogDescription>
          </DialogHeader>
          {panel === "match" && <MatchCarsV2 />}
          {panel === "import" && (
            <PromotionReviewScreen stagedCount={readyCount} needsVehicleCount={carsToMatch} onGoToMapping={() => setPanel("match")} />
          )}
          {panel === "cancel" && <CancellationScreen />}
          {panel === "history" && <SyncHistoryScreen />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
