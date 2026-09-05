/**
 * Turo Sync — the payoff screen.
 *
 * Shows what the Drive247 Turo Bridge Chrome extension has read out of the
 * operator's own logged-in Turo session, and walks them through the only two
 * decisions the system will not make for them: which car a Turo listing is,
 * and whether a trip that stopped appearing is really cancelled.
 *
 * NAME SPLIT, DELIBERATE. The operator-facing name is "Turo Sync" — the words
 * they used — so that is what the sidebar entry, this page's heading and the
 * settings toggle all say. Everything internal stays `turo_bridge_*`: the route
 * (/turo-bridge), the tables, the column, the hooks and this directory. Renaming
 * the route would have meant moving ROUTE_TO_TAB and breaking every bookmark;
 * renaming the column would have meant a second migration and a second anon
 * grant. The split is cheap and it is written down here and in the sidebar so
 * the next person meets it as a decision rather than as a mystery.
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
 *
 * ── WHAT IS MISSING FROM THIS DATABASE, AND WHAT THAT COSTS ─────────────────
 *
 * `turo_sync_jobs` and the rest of turo-bridge-poc/sql/03-foundation-schema.sql
 * are NOT applied. Four consequences are handled explicitly below rather than
 * left to render as clean empty states:
 *
 *   1. There is no job-derived freshness at all, so the "Last sync" card and the
 *      staleness banner are derived from MAX(synced_at) instead — a narrower
 *      fact, labelled as such (see `describeSyncFreshness`).
 *   2. Two of the five stat cards render "—" rather than 0, because 0 in those
 *      slots is indistinguishable from "nothing to do".
 *   3. The schema-missing condition is stated ONCE, as a foundation notice, not
 *      twice — the job-health Notice is suppressed while it would only be
 *      repeating it in a warning tone.
 *   4. An empty page is not presented as evidence of an empty Turo calendar,
 *      because without sync history we genuinely cannot tell those apart.
 */
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  CalendarDays,
  CarFront,
  DownloadCloud,
  Puzzle,
  RefreshCw,
  Settings,
  ShieldQuestion,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/contexts/TenantContext";
import {
  TURO_FOUNDATION_MISSING_DETAIL,
  describeSyncFreshness,
  useTuroStagedReservations,
  type TuroFreshness,
} from "@/hooks/use-turo-bridge";
import { useTuroSyncHealth } from "@/hooks/use-turo-sync-jobs";
import { useTuroVehicleMapQueue } from "@/hooks/use-turo-vehicle-map";
import {
  EmptyState,
  LoadFailed,
  Notice,
  StatCard,
  fmtDateTime,
} from "@/components/turo-bridge/shared";
import { ReservationsScreen } from "@/components/turo-bridge/reservations-table";
import { VehicleMappingScreen } from "@/components/turo-bridge/vehicle-mapping-queue";
import { PromotionReviewScreen } from "@/components/turo-bridge/promotion-review";
import { CancellationScreen } from "@/components/turo-bridge/cancellation-candidates";
import { SyncHistoryScreen } from "@/components/turo-bridge/sync-history";

type TabKey = "reservations" | "vehicles" | "review" | "cancellations" | "history";

/* ---------------------------------------------------------------------------
 * THE FEATURE GATE
 * ------------------------------------------------------------------------ */

/**
 * `tenants.turo_bridge_enabled`, enforced at the route.
 *
 * Hiding the sidebar entry protects nothing — /turo-bridge still resolves for
 * anyone who types it, follows a stale bookmark, or clicks the summary
 * notification `turo-bridge-promote` writes. So the same flag is checked here.
 *
 * ⚠ THIS IS A VISIBILITY GATE, NOT A SECURITY BOUNDARY, and it must never be
 * sold as one. The real boundaries are unchanged and live elsewhere: RLS on
 * `turo_bridge_reservations` (`turo_bridge_reservations_select_own_tenant`,
 * FOR SELECT TO authenticated, `tenant_id = get_user_tenant_id() OR
 * is_super_admin()`) scopes the rows, and ROUTE_TO_TAB['/turo-bridge'] scopes
 * managers. The flag answers a different question — "does this operator use the
 * feature" — so when the answer is no it explains itself instead of redirecting.
 * A bounce to the dashboard would read as a broken build and would state
 * something false ("you may not") about what is only a preference.
 *
 * The gate lives in the DEFAULT EXPORT, wrapping the screen, rather than as an
 * early return inside it. That is deliberate: the screen calls `useState` plus
 * three query hooks before its first return, so an inline guard would either
 * break hook order the moment the flag flipped, or fire three RLS-scoped
 * queries for a tenant who has the feature switched off. As a wrapper, those
 * hooks simply never mount.
 */
export default function TuroBridgePage() {
  // `loading` is load-bearing, not a nicety. `=== true` against a tenant that
  // has not resolved yet is false, so without this branch a hard refresh
  // straight onto this URL would show "turned off" to an operator who has it
  // switched ON — briefly on a fast connection, permanently if the tenant fetch
  // fails. That is the demo-day failure the old ungated sidebar comment feared,
  // moved one layer down; it is closed here rather than reintroduced.
  const { tenant, loading } = useTenant();
  const enabled =
    (tenant as { turo_bridge_enabled?: boolean } | null)?.turo_bridge_enabled === true;

  if (loading) return <TuroSyncResolving />;
  if (!enabled) return <TuroSyncOff />;
  return <TuroSyncScreen />;
}

/** Decides nothing while the tenant row is still in flight. */
function TuroSyncResolving() {
  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="h-9 w-48 animate-pulse rounded bg-[#f1f5f9] dark:bg-muted" />
      <div className="h-4 w-full max-w-xl animate-pulse rounded bg-[#f1f5f9] dark:bg-muted" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[92px] animate-pulse rounded-lg border border-[#f1f5f9] bg-white dark:border-border dark:bg-card"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The off-state. Names the switch, names where it is, says plainly that nothing
 * was deleted — and, crucially, does NOT claim the sync has stopped.
 *
 * The earlier copy here opened with "Nothing is being read from Turo for this
 * account". That was false and false in the expensive direction: the flag is a
 * portal VISIBILITY preference, and the Chrome extension keeps writing into
 * `turo_bridge_reservations` on its own schedule whether or not this switch is
 * on. An operator who flipped it off in order to stop the sync would have been
 * handed a screen confirming a stop that never happened. The only thing that
 * actually stops the reading is removing or unpairing the extension, so that is
 * what the third paragraph says.
 */
function TuroSyncOff() {
  const router = useRouter();
  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-medium text-foreground">Turo Sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hidden for this account.
        </p>
      </div>
      <EmptyState
        icon={<Puzzle className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
        title="Turo Sync is turned off"
        body={
          <>
            <p>
              Someone has switched Turo Sync off for this account, so this page is hidden.
            </p>
            <p className="mt-3">
              A head admin or admin can switch it back on in{" "}
              <span className="font-medium text-foreground">
                Settings → General → Features
              </span>
              . It reappears in your Fleet &amp; Bookings sidebar straight away.
            </p>
            <p className="mt-3 text-xs">
              Nothing has been deleted. Trips already synced are still stored, and any bookings
              already imported are untouched — both come back the moment this is switched on.
            </p>
            <p className="mt-3 text-xs">
              This switch only hides the page. If the Drive247 Turo Bridge extension is still
              installed and paired in someone&apos;s Chrome, it carries on reading your Turo trips
              in the background. To stop that, remove the extension from Chrome.
            </p>
          </>
        }
        action={
          // The settings page enforces its own permissions, so this is safe to
          // offer to anyone: a manager without the `settings.general` grant
          // lands on a read-only view rather than a dead end.
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/settings?tab=general")}
          >
            <Settings className="mr-2 h-4 w-4" />
            Open settings
          </Button>
        }
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * THE SCREEN
 * ------------------------------------------------------------------------ */

function TuroSyncScreen() {
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
  const anyDemoRows = counts.fixtures > 0;
  const foundationApplied = reservations.foundationApplied;

  /**
   * Freshness, derived from row timestamps rather than from sync jobs — see the
   * caveat carried on the returned object and repeated in the copy below. This
   * is the ONLY liveness fact this database can currently answer.
   */
  const freshness = useMemo(
    () => describeSyncFreshness(reservations.allRows),
    [reservations.allRows],
  );

  /**
   * Trip-window counters. Computed here rather than in the hook because they are
   * a presentation split of one list, and they must all be taken against a
   * SINGLE `now` — reading `Date.now()` three times would let a trip be counted
   * as both upcoming and on-trip across a millisecond boundary.
   */
  const windows = useMemo(() => {
    const now = Date.now();
    let upcoming = 0;
    let onTripNow = 0;
    let finished = 0;
    for (const row of reservations.allRows) {
      const s = row.starts_at ? new Date(row.starts_at).getTime() : NaN;
      const e = row.ends_at ? new Date(row.ends_at).getTime() : NaN;
      if (Number.isFinite(s) && s > now) upcoming += 1;
      else if (Number.isFinite(s) && Number.isFinite(e) && s <= now && now < e) onTripNow += 1;
      else if (Number.isFinite(e) && e <= now) finished += 1;
      // Rows with no usable dates fall through into none of the three buckets.
      // They are still counted in "Trips synced" and still listed; they are just
      // not claimed to be in a window we cannot read.
    }
    return { upcoming, onTripNow, finished };
  }, [reservations.allRows]);

  const refreshAll = () => {
    reservations.refetch();
  };

  if (reservations.isError) {
    return (
      <div className="container mx-auto space-y-6 p-6">
        <PageHeader onRefresh={refreshAll} isFetching={reservations.isFetching} />
        <LoadFailed what="Turo Sync" error={reservations.error} onRetry={refreshAll} />
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
            counts.fixtures > 0
              ? `${counts.total - counts.fixtures} from Turo · ${counts.fixtures} demo`
              : "read from your Turo host account"
          }
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Upcoming trips"
          value={String(windows.upcoming)}
          hint={`${windows.onTripNow} on trip now · ${windows.finished} finished`}
        />
        {/*
          Cards 3 and 4 render "—", never 0, when the reconciliation schema is
          absent. A 0 here is indistinguishable from "nothing to do", and an
          operator who reads "0 vehicles to match" goes on to trust a page that
          has not matched anything. "—" says we cannot answer; 0 would say there
          is nothing to answer.
        */}
        <StatCard
          icon={<CarFront className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Vehicles to match"
          value={foundationApplied ? String(mapQueue.counts.awaiting) : "—"}
          tone={foundationApplied && mapQueue.counts.awaiting > 0 ? "warn" : "default"}
          hint={
            !foundationApplied
              ? "not available until setup is finished"
              : mapQueue.counts.awaiting > 0
                ? `${mapQueue.counts.reservationsBlocked} trips waiting on them`
                : "every Turo listing is matched to one of your cars"
          }
        />
        <StatCard
          icon={<ShieldQuestion className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Needs your decision"
          value={foundationApplied ? String(counts.byState.cancellation_candidate) : "—"}
          tone={
            foundationApplied && counts.byState.cancellation_candidate > 0 ? "warn" : "default"
          }
          hint={
            !foundationApplied
              ? "not available until setup is finished"
              : counts.byState.cancellation_candidate > 0
                ? "these cars stay blocked until you decide"
                : "nothing waiting on you"
          }
        />
        {/*
          "Last sync" replaces the old job-derived "Last read", which could only
          ever render "unknown" on this database. The caveat sits on the wrapper
          as a title rather than in the hint, because the hint is truncated and
          this sentence must survive intact.
        */}
        <div title={freshness.caveat}>
          <StatCard
            icon={<Timer className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
            label="Last sync"
            value={
              freshness.lastSyncedAt
                ? formatDistanceToNow(new Date(freshness.lastSyncedAt), { addSuffix: true })
                : "never"
            }
            tone={
              freshness.tier === "never" || freshness.tier === "very_stale"
                ? "danger"
                : freshness.tier === "stale"
                  ? "warn"
                  : "default"
            }
            hint={
              freshness.lastSyncedAt
                ? fmtDateTime(freshness.lastSyncedAt)
                : "run a sync from the browser extension"
            }
          />
        </div>
      </div>

      {/*
        THE STALENESS BANNER — the first thing under the numbers, above every
        other notice, and the only place on this page that talks about how old
        the list is. The empty state owns the zero-row case, so this renders
        only when there is something to be stale.
      */}
      {counts.total > 0 && <StalenessBanner freshness={freshness} />}

      {/*
        One line saying what the last sync JOB proved — suppressed entirely while
        the jobs table is missing. It would otherwise fire on every healthy page
        with a warn-toned "Sync history is not available on this database yet",
        which the foundation notice immediately below already says once. Stating
        the same fact twice, one of them as a warning, trains the operator to
        ignore the banner that will later carry real warnings.
      */}
      {!nothingSyncedYet && !health.schemaMissing && (
        <Notice tone={health.warning ? "warn" : "info"}>
          <span className="font-medium text-foreground">{health.headline}</span>
          {health.warning && <> {health.warning}</>}
        </Notice>
      )}

      {/*
        An unapplied migration makes four of the five screens structurally
        unable to answer, and the worst possible response to that is a set of
        clean empty states. Say it once, at the top, plainly — and name what
        specifically is unavailable, so "partly set up" is not left abstract.
      */}
      {(!foundationApplied || health.schemaMissing) && counts.total > 0 && (
        <Notice tone="warn">
          {/*
            File names live in hover text, not in body copy — see
            TURO_FOUNDATION_MISSING_DETAIL. A plain inline span, NOT
            `display: contents`, which generates no box and so would never fire
            the tooltip.
          */}
          <span title={TURO_FOUNDATION_MISSING_DETAIL}>
            <span className="font-medium text-foreground">
              Turo Sync is only partly set up on this account.{" "}
            </span>
            Your trips are being read and listed, and they are safe. What is not working yet:
            matching Turo listings to your cars, importing trips as bookings, and sync history —
            those three tabs will tell you the same thing rather than show you an empty queue
            that looks like &ldquo;nothing to do&rdquo;. Contact Drive247 support to have the
            setup finished.
          </span>
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
        <GettingStarted
          onRefresh={refreshAll}
          isFetching={reservations.isFetching}
          historyUnavailable={health.schemaMissing}
        />
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
            {/*
              The Sync history tab STAYS in the list while its table is missing,
              carrying a muted marker. Hiding it would be indistinguishable from
              a broken build, and letting it render an empty history would read
              as "no syncs have run" — which is precisely the thing we cannot
              currently know. SyncHistoryScreen says so itself when opened.
            */}
            <TabsTrigger value="history">
              Sync history
              {health.schemaMissing && (
                <span
                  className="ml-2 text-[10px] font-normal text-muted-foreground"
                  title="Sync history is not available until Drive247 finishes setting up Turo Sync on this account. Contact support to have it completed."
                >
                  unavailable
                </span>
              )}
            </TabsTrigger>
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

/* ---------------------------------------------------------------------------
 * Page furniture
 * ------------------------------------------------------------------------ */

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
        <h1 className="text-3xl font-medium text-foreground">Turo Sync</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trips read from your Turo host account by the Drive247 Turo Bridge extension in Chrome,
          and the steps to turn them into real bookings here.
        </p>
      </div>
      {/*
        Refresh re-reads OUR database. It is the right button on this page —
        the operator physically leaves this tab to click Sync in the extension
        and comes back — but it is never offered as a fix for staleness, because
        it cannot reach Turo. The staleness banner points at Chrome instead.
      */}
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isFetching}
        className="shrink-0"
        title="Re-reads trips already stored in Drive247. It does not contact Turo — only the Drive247 Turo Bridge extension in Chrome can do that."
      >
        <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );
}

/**
 * How old this list is, in the operator's terms.
 *
 * Three bands, and none of them may say "up to date", "in sync" or "current" —
 * no read this page can perform supports any of those words. Even the healthy
 * band states what is NOT here, because a Turo calendar changes without asking
 * us and the gap since the last write is real regardless of how small it is.
 */
function StalenessBanner({ freshness }: { freshness: TuroFreshness }) {
  if (!freshness.lastSyncedAt) {
    return (
      <Notice tone="warn">
        <span className="font-medium text-foreground">
          No Turo trip has ever reached this account.{" "}
        </span>
        Trips appear here only after the Drive247 Turo Bridge extension has run a sync in Chrome.
      </Notice>
    );
  }

  const relative = formatDistanceToNow(new Date(freshness.lastSyncedAt), { addSuffix: true });
  const exact = fmtDateTime(freshness.lastSyncedAt);

  if (freshness.tier === "fresh") {
    return (
      <Notice tone="info">
        Last sync {relative}. Anything booked or cancelled on Turo since then is not on this page
        yet. <span className="text-muted-foreground">{freshness.caveat}</span>
      </Notice>
    );
  }

  if (freshness.tier === "stale") {
    return (
      <Notice tone="warn">
        <span className="font-medium text-foreground">No Turo sync for {relative}. </span>
        The last trip we received arrived {exact}. Trips booked or cancelled on Turo since then
        are missing here — open the Drive247 Turo Bridge extension in Chrome and run a sync
        before you rely on this list.{" "}
        <span className="text-muted-foreground">{freshness.caveat}</span>
      </Notice>
    );
  }

  const days = freshness.ageDays ?? 0;
  return (
    <Notice tone="warn">
      <span className="font-medium text-[#dc2626] dark:text-red-400">
        No Turo sync for {days} {days === 1 ? "day" : "days"}.{" "}
      </span>
      This is a stale copy of your Turo calendar, not your Turo calendar. Do not use it to decide
      whether a car is free — run a sync first. The last trip we received arrived {exact}.{" "}
      <span className="text-muted-foreground">{freshness.caveat}</span>
    </Notice>
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
  historyUnavailable,
}: {
  onRefresh: () => void;
  isFetching: boolean;
  /** True while `turo_sync_jobs` is missing — see the honesty line below. */
  historyUnavailable: boolean;
}) {
  return (
    <EmptyState
      icon={<Puzzle className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
      title="No Turo trips yet"
      body={
        <>
          <p>
            Install the Drive247 Turo Bridge extension in Chrome, then run a sync. Your upcoming
            Turo trips land here. (&ldquo;Drive247 Turo Bridge&rdquo; is the name the extension
            has in Chrome — it is what fills this Turo Sync page.)
          </p>

          <ol className="mt-6 mb-6 w-full space-y-3 text-left">
            <Step n={1}>
              Sign in to <span className="font-medium text-foreground">turo.com</span> in this
              browser as a host.
            </Step>
            <Step n={2}>
              Load the Drive247 Turo Bridge extension in Chrome — ask your Drive247 admin for the
              folder, then <span className="font-medium text-foreground">chrome://extensions</span>{" "}
              → Developer mode → Load unpacked. It is not on the Chrome Web Store yet.
            </Step>
            <Step n={3}>
              Open the extension and paste your pairing code. Your Drive247 admin creates it for
              you — ask them for one.
            </Step>
            <Step n={4}>
              Click <span className="font-medium text-foreground">Sync</span>. Trips appear on
              this page within a few seconds — it refreshes itself when you come back to this tab.
            </Step>
            <Step n={5}>
              Match each Turo vehicle to one of your cars, then review and import the trips you
              want as Drive247 bookings.
            </Step>
          </ol>

          <p className="text-xs">
            The extension reads the Turo session already open in your browser. It never asks for
            your Turo password, and nothing is ever written back to Turo.
          </p>

          {/*
            Without sync history we cannot distinguish "the sync failed" from
            "your Turo calendar is genuinely empty". Saying so is the only
            honest thing available: an operator who has already clicked Sync and
            is staring at an empty page must not read that emptiness as an
            answer.
          */}
          {historyUnavailable && (
            <p className="mt-4 text-xs" title={TURO_FOUNDATION_MISSING_DETAIL}>
              If you have already run a sync and this page is still empty, we cannot yet tell you
              whether the sync failed or your Turo calendar is genuinely empty — the sync history
              that would answer that is part of the setup Drive247 has not finished on this
              account. Until it is, an empty page is not evidence of an empty calendar. If you
              expected trips here, contact Drive247 support rather than assuming there are none.
            </p>
          )}
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
