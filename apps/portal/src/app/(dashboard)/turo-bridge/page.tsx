/**
 * Turo Bridge — the payoff screen.
 *
 * Shows reservations pulled off the operator's own logged-in Turo session by
 * the Drive247 Turo Bridge Chrome extension. Read-only: every row here is
 * written by the `turo-bridge-ingest` edge function, never by the portal.
 *
 * Structure follows the house data-page sequence documented in CLAUDE.md and
 * modelled on (dashboard)/vehicle-owners/page.tsx:
 *   header + action → stat cards → filter bar → indigo-header table
 * with the local StatCard helper copied verbatim from that file (:197-211).
 */
"use client";

import { useMemo, useState } from "react";
import { format, formatDistanceToNow, differenceInCalendarDays } from "date-fns";
import {
  Car,
  CalendarDays,
  DownloadCloud,
  RefreshCw,
  Search,
  Puzzle,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTenant } from "@/contexts/TenantContext";
import {
  useTuroBridgeReservations,
  turoTripStatus,
  type TuroBridgeReservation,
} from "@/hooks/use-turo-bridge";
import { formatCurrency } from "@/lib/format-utils";

const COLUMN_COUNT = 7;

export default function TuroBridgePage() {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const [search, setSearch] = useState("");

  const {
    data: reservations = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useTuroBridgeReservations();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reservations;
    return reservations.filter(
      (r) =>
        r.reservation_id.toLowerCase().includes(q) ||
        (r.guest_name ?? "").toLowerCase().includes(q) ||
        (r.vehicle_label ?? "").toLowerCase().includes(q) ||
        (turoTripStatus(r) ?? "").toLowerCase().includes(q),
    );
  }, [reservations, search]);

  const now = Date.now();
  const upcoming = reservations.filter(
    (r) => r.starts_at && new Date(r.starts_at).getTime() > now,
  ).length;
  const lastSync = reservations[0]?.synced_at ?? null;
  const anyDemoRows = reservations.some((r) => r.source === "fixture");

  return (
    <div className="container mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium text-foreground">Turo Bridge</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reservations pulled from your Turo host account by the Drive247 browser
            extension.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<DownloadCloud className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Reservations Synced"
          value={String(reservations.length)}
        />
        <StatCard
          icon={<CalendarDays className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Upcoming Trips"
          value={String(upcoming)}
        />
        <StatCard
          icon={<RefreshCw className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
          label="Last Sync"
          value={lastSync ? formatDistanceToNow(new Date(lastSync), { addSuffix: true }) : "—"}
        />
      </div>

      {/*
        Demo-data notice. The extension falls back to a bundled sample whenever
        it cannot reach a live Turo session, and that fallback is recorded on the
        row rather than inferred. Saying so once at the top, and again per row,
        is what stops a sample reservation being read as a real booking.
      */}
      {anyDemoRows && (
        <div className="flex items-start gap-3 rounded-md border border-[#e0e7ff] bg-[#eef2ff] px-4 py-3 dark:border-indigo-900 dark:bg-indigo-950/30">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <p className="text-sm text-[#404040] dark:text-muted-foreground">
            Some rows below are marked{" "}
            <span className="font-medium text-foreground">Demo</span>. Those came from
            the extension&apos;s bundled sample, not from Turo — the extension uses them
            when it can&apos;t reach a signed-in Turo host session in your browser.
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by trip ID, guest, vehicle or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">Couldn&apos;t load imported trips</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4 text-sm">
              {(error as Error)?.message || "The request to Supabase failed."}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !isLoading && reservations.length === 0 ? (
        <EmptyState onRefresh={() => refetch()} isFetching={isFetching} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                  <TableHead>Trip</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Trip Status</TableHead>
                  <TableHead>Synced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={COLUMN_COUNT}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={COLUMN_COUNT}
                      className="text-center py-12 text-muted-foreground"
                    >
                      No trips match your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => <ReservationRow key={r.id} row={r} currency={currency} />)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReservationRow({
  row,
  currency,
}: {
  row: TuroBridgeReservation;
  currency: string;
}) {
  const tripStatus = turoTripStatus(row);
  const start = row.starts_at ? new Date(row.starts_at) : null;
  const end = row.ends_at ? new Date(row.ends_at) : null;
  const nights = start && end ? differenceInCalendarDays(end, start) : null;
  const amount = row.total_amount == null ? null : Number(row.total_amount);

  return (
    <TableRow>
      <TableCell className="font-medium">{row.reservation_id}</TableCell>

      <TableCell>
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">
            {row.vehicle_label ?? <span className="text-muted-foreground">—</span>}
          </span>
        </div>
      </TableCell>

      <TableCell className="text-sm text-foreground/80">
        {row.guest_name ?? <span className="text-muted-foreground">—</span>}
      </TableCell>

      <TableCell className="text-sm">
        {start && end ? (
          <>
            <div>
              {format(start, "d MMM yyyy")}
              <span className="text-muted-foreground"> → </span>
              {format(end, "d MMM yyyy")}
            </div>
            {nights !== null && nights > 0 && (
              <div className="text-xs text-muted-foreground">
                {nights} {nights === 1 ? "day" : "days"}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="text-right tabular-nums">
        {amount != null && Number.isFinite(amount) ? (
          formatCurrency(amount, row.currency || currency)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/*
        Turo's OWN trip status, read out of `raw`. Deliberately not the `status`
        column, which is our sync state — conflating the two is how a screen ends
        up calling a cancelled trip active.
      */}
      <TableCell>
        {tripStatus ? (
          <Badge variant="outline" className={tripStatusColor(tripStatus)}>
            {tripStatus.toLowerCase()}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        )}
      </TableCell>

      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span>{format(new Date(row.synced_at), "d MMM, HH:mm")}</span>
          {row.source === "fixture" ? (
            <span
              title="Bundled sample data — the extension could not reach a live Turo session"
              className="inline-flex items-center rounded border border-[#e0e7ff] bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-medium text-[#4338ca] dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              DEMO
            </span>
          ) : (
            <span
              title="Read from your live, signed-in Turo session"
              className="inline-flex items-center rounded border border-green-300 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-800 dark:text-green-400"
            >
              LIVE
            </span>
          )}
        </div>
        {row.status === "failed" && (
          <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">sync failed</div>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Points the operator at the thing that fills this page. */
function EmptyState({
  onRefresh,
  isFetching,
}: {
  onRefresh: () => void;
  isFetching: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="h-12 w-12 rounded-md bg-[#eef2ff] dark:bg-muted flex items-center justify-center mb-4">
          <Puzzle className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Nothing imported yet</h3>
        <p className="text-muted-foreground text-center max-w-md text-sm">
          Install the Drive247 Turo Bridge extension in Chrome, then click{" "}
          <span className="font-medium text-foreground">Sync one reservation</span>. Your
          upcoming Turo trips land here.
        </p>

        <ol className="mt-6 mb-6 w-full max-w-md space-y-3 text-sm">
          <Step n={1}>
            Sign in to <span className="font-medium text-foreground">turo.com</span> in this
            browser as a host.
          </Step>
          <Step n={2}>
            Open the Turo Bridge extension and paste your pairing token (ask your Drive247
            admin for one).
          </Step>
          <Step n={3}>
            Click <span className="font-medium text-foreground">Sync</span>. The trip appears
            on this page within a few seconds.
          </Step>
        </ol>

        <p className="text-xs text-muted-foreground text-center max-w-md mb-4">
          The extension reads the Turo session already open in your browser. It never asks
          for your Turo password, and nothing is ever written back to Turo.
        </p>

        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Check again
        </Button>
      </CardContent>
    </Card>
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

/** Turo's trip vocabulary, mapped to the house border+text badge colours. */
function tripStatusColor(status: string) {
  switch (status.toUpperCase()) {
    case "BOOKED":
    case "CONFIRMED":
    case "ACTIVE":
      return "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400";
    case "CANCELLED":
    case "CANCELED":
    case "DECLINED":
      return "border-gray-300 text-muted-foreground dark:border-gray-700";
    case "PENDING":
    case "UNFULFILLED":
      return "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400";
    default:
      return "border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-400";
  }
}

// Verbatim from (dashboard)/vehicle-owners/page.tsx:197-211 — duplicated
// byte-for-byte in owner-payouts/page.tsx:184-197, so this really is the house
// stat card rather than a one-off.
function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-medium text-foreground mt-1">{value}</p>
          </div>
          <div className="h-10 w-10 rounded-md bg-[#eef2ff] dark:bg-muted flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
