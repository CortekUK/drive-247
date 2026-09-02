/**
 * Turo Bridge — the payoff screen.
 *
 * Shows what the Drive247 Turo Bridge Chrome extension has read out of the
 * operator's own logged-in Turo session, and walks them through the only two
 * decisions the system will not make for them: which car a Turo listing is,
 * and whether a trip that stopped appearing is really cancelled.
 *
 * This page is a shell. It owns the header, the fleet-level counters, the
 * warnings that apply everywhere, and the tab routing. Each of the five screens
 * lives in components/turo-bridge/ and reads its own data through the shared
 * hooks, so the same facts render the same way wherever they appear.
 *
 * READ-ONLY BY DEFAULT. Reservations, runs and mappings are written by
 * service_role edge functions on behalf of the extension; the portal has SELECT
 * and nothing else. The three places this page can cause a write — confirming a
 * vehicle mapping, importing bookings, deciding on a cancellation — are all
 * explicit, all confirmed, and all re-proved server-side.
 *
 * Structure follows the house data-page sequence documented in CLAUDE.md and
 * modelled on (dashboard)/vehicle-owners/page.tsx:
 *   header + action → stat cards → notices → section title → filter bar → table
 */
"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CalendarDays,
  CarFront,
  DownloadCloud,
  Puzzle,
  RefreshCw,
  ShieldQuestion,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/contexts/TenantContext";
import { useTuroStagedReservations } from "@/hooks/use-turo-bridge";
import { useTuroSyncHealth } from "@/hooks/use-turo-sync-jobs";
import { useTuroVehicleMapQueue } from "@/hooks/use-turo-vehicle-map";
import { EmptyState, LoadFailed, Notice, StatCard } from "@/components/turo-bridge/shared";
import { ReservationsScreen } from "@/components/turo-bridge/reservations-table";
import { VehicleMappingScreen } from "@/components/turo-bridge/vehicle-mapping-queue";
import { PromotionReviewScreen } from "@/components/turo-bridge/promotion-review";
import { CancellationScreen } from "@/components/turo-bridge/cancellation-candidates";
import { SyncHistoryScreen } from "@/components/turo-bridge/sync-history";

type TabKey = "reservations" | "vehicles" | "review" | "cancellations" | "history";

export default function TuroBridgePage() {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const [tab, setTab] = useState<TabKey>("reservations");

  // One shared query underneath: `useTuroStagedReservations` and the mapping
  // queue both read `useTuroBridgeReservations`, so this is one request, not
  // three, and every screen is looking at the same rows.
  const reservations = useTuroStagedReservations();
  const health = useTuroSyncHealth("trips");
  const mapQueue = useTuroVehicleMapQueue();

  const counts = reservations.counts;
  const lastSync = reservations.allRows[0]?.synced_at ?? null;
  const anyDemoRows = counts.fixtures > 0;

  const now = Date.now();
  const upcoming = reservations.allRows.filter(
    (r) => r.starts_at && new Date(r.starts_at).getTime() > now,
  ).length;

  const refreshAll = () => {
    reservations.refetch();
  };

  if (reservations.isError) {
    return (
      <div className="container mx-auto space-y-6 p-6">
        <PageHeader onRefresh={refreshAll} isFetching={reservations.isFetching} />
        <LoadFailed what="Turo Bridge" error={reservations.error} onRetry={refreshAll} />
      </div>
    );
  }

  const nothingSyncedYet = !reservations.isLoading && counts.total === 0;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <PageHeader onRefresh={refreshAll} isFetching={reservations.isFetching} />

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard
          icon={<DownloadCloud className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Trips synced"
          value={String(counts.total)}
          hint={
            lastSync
              ? `last ${formatDistanceToNow(new Date(lastSync), { addSuffix: true })}`
              : undefined
          }
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Upcoming trips"
          value={String(upcoming)}
        />
        <StatCard
          icon={<CarFront className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Vehicles to map"
          value={String(mapQueue.counts.awaiting)}
          tone={mapQueue.counts.awaiting > 0 ? "warn" : "default"}
          hint={
            mapQueue.counts.reservationsBlocked > 0
              ? `${mapQueue.counts.reservationsBlocked} trips blocked behind them`
              : undefined
          }
        />
        <StatCard
          icon={<ShieldQuestion className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Awaiting your decision"
          value={String(counts.byState.cancellation_candidate)}
          tone={counts.byState.cancellation_candidate > 0 ? "warn" : "default"}
          hint={
            counts.byState.cancellation_candidate > 0
              ? "cars stay blocked meanwhile"
              : undefined
          }
        />
        {/*
          Deliberately NOT "sync health" or a percentage. The only honest
          summary of a read is whether the last one got all the way through, and
          `useTuroSyncHealth` refuses to say "up to date" for exactly the reason
          this feature exists — a degraded feed and a quiet week look identical.
        */}
        <StatCard
          icon={<Timer className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Last read"
          value={
            health.schemaMissing
              ? "unknown"
              : health.running
                ? "running"
                : health.authoritative
                  ? "complete"
                  : health.latest
                    ? "partial"
                    : "never"
          }
          tone={health.authoritative || health.running ? "default" : "warn"}
          hint={
            health.latest?.finished_at
              ? formatDistanceToNow(new Date(health.latest.finished_at), { addSuffix: true })
              : undefined
          }
        />
      </div>

      {/*
        One line at the top of the page saying what the last read actually
        proved. `health.headline` never claims "in sync" or "up to date",
        because no read can support that.
      */}
      {!nothingSyncedYet && (
        <Notice tone={health.warning ? "warn" : "info"}>
          <span className="font-medium text-foreground">{health.headline}</span>
          {health.warning && <> {health.warning}</>}
        </Notice>
      )}

      {/*
        An unapplied migration makes four of the five screens structurally
        unable to answer, and the worst possible response to that is a set of
        clean empty states. Say it once, at the top, plainly.
      */}
      {!reservations.foundationApplied && counts.total > 0 && (
        <Notice tone="warn">
          <span className="font-medium text-foreground">
            Turo Bridge is only partly set up.{" "}
          </span>
          Trips can be read and listed, but they cannot be matched to vehicles, imported, or
          released until the reconciliation schema is installed — and this page will not pretend
          otherwise by showing you empty queues.
        </Notice>
      )}

      {/*
        Demo-data notice. The extension falls back to a bundled sample whenever
        it cannot reach a live Turo session, and that fallback is recorded on
        the row rather than inferred. Saying so once at the top, and again per
        row, is what stops a sample reservation being read as a real booking.
      */}
      {anyDemoRows && (
        <Notice tone="info">
          {counts.fixtures} {counts.fixtures === 1 ? "row is" : "rows are"} marked{" "}
          <span className="font-medium text-foreground">Demo</span>. Those came from the
          extension&apos;s bundled sample, not from Turo — it uses them when it can&apos;t reach a
          signed-in Turo host session in your browser. They can never create a booking or block a
          car.
        </Notice>
      )}

      {nothingSyncedYet ? (
        <GettingStarted onRefresh={refreshAll} isFetching={reservations.isFetching} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="reservations">Reservations</TabsTrigger>
            <TabsTrigger value="vehicles">
              Vehicles
              {mapQueue.counts.awaiting > 0 && (
                <TabBadge count={mapQueue.counts.awaiting} tone="warn" />
              )}
            </TabsTrigger>
            <TabsTrigger value="review">
              Import
              {counts.byState.staged > 0 && (
                <TabBadge count={counts.byState.staged} tone="accent" />
              )}
            </TabsTrigger>
            <TabsTrigger value="cancellations">
              Possibly cancelled
              {counts.byState.cancellation_candidate > 0 && (
                <TabBadge count={counts.byState.cancellation_candidate} tone="warn" />
              )}
            </TabsTrigger>
            <TabsTrigger value="history">Sync history</TabsTrigger>
          </TabsList>

          <TabsContent value="reservations" className="mt-6">
            <ReservationsScreen
              currency={currency}
              onGoToMapping={() => setTab("vehicles")}
            />
          </TabsContent>

          <TabsContent value="vehicles" className="mt-6">
            <VehicleMappingScreen />
          </TabsContent>

          <TabsContent value="review" className="mt-6">
            <PromotionReviewScreen
              stagedCount={counts.byState.staged}
              needsVehicleCount={mapQueue.counts.awaiting}
              onGoToMapping={() => setTab("vehicles")}
            />
          </TabsContent>

          <TabsContent value="cancellations" className="mt-6">
            <CancellationScreen />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <SyncHistoryScreen />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function PageHeader({
  onRefresh,
  isFetching,
}: {
  onRefresh: () => void;
  isFetching: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-medium text-foreground">Turo Bridge</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trips read from your Turo host account by the Drive247 browser extension, and the steps
          to turn them into real bookings here.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isFetching}
        className="shrink-0"
      >
        <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );
}

function TabBadge({ count, tone }: { count: number; tone: "warn" | "accent" }) {
  return (
    <span
      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
        tone === "warn"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          : "bg-[#e0e7ff] text-[#4338ca] dark:bg-indigo-950/50 dark:text-indigo-300"
      }`}
    >
      {count}
    </span>
  );
}

/** Points the operator at the thing that fills this page. */
function GettingStarted({
  onRefresh,
  isFetching,
}: {
  onRefresh: () => void;
  isFetching: boolean;
}) {
  return (
    <EmptyState
      icon={<Puzzle className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
      title="Nothing imported yet"
      body={
        <>
          <p>
            Install the Drive247 Turo Bridge extension in Chrome, then run a sync. Your upcoming
            Turo trips land here.
          </p>

          <ol className="mt-6 mb-6 w-full space-y-3 text-left">
            <Step n={1}>
              Sign in to <span className="font-medium text-foreground">turo.com</span> in this
              browser as a host.
            </Step>
            <Step n={2}>
              Open the Turo Bridge extension and paste your pairing token (ask your Drive247
              admin for one).
            </Step>
            <Step n={3}>
              Click <span className="font-medium text-foreground">Sync</span>. Trips appear on
              this page within a few seconds.
            </Step>
            <Step n={4}>
              Match each Turo vehicle to one of your cars, then review and import the trips you
              want as bookings.
            </Step>
          </ol>

          <p className="text-xs">
            The extension reads the Turo session already open in your browser. It never asks for
            your Turo password, and nothing is ever written back to Turo.
          </p>
        </>
      }
      action={
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Check again
        </Button>
      }
    />
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef2ff] text-[11px] font-medium text-[#4338ca] dark:bg-muted dark:text-indigo-300">
        {n}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}
