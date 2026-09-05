/**
 * Turo Bridge — shared presentation primitives.
 *
 * Everything here is pure: props in, pixels out. No queries, no mutations, no
 * side effects. The data layer lives in the three hooks
 * (`use-turo-bridge.ts`, `use-turo-sync-jobs.ts`, `use-turo-vehicle-map.ts`)
 * and this file deliberately re-derives nothing they already decided —
 * `completeness`, `is_authoritative` and `progress_denominator` are
 * GENERATED ALWAYS columns, and a component that recomputed "looks complete to
 * me" would be manufacturing exactly the authority the schema withholds.
 *
 * House design system (CLAUDE.md → Portal Design System):
 *   flat cards, 1px #f1f5f9 borders, no shadows, indigo #6366f1 accent,
 *   indigo table headers (#eef2ff), colored TEXT for status rather than pills.
 */
"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Database, Info, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TURO_FOUNDATION_MISSING_DETAIL,
  TURO_SYNC_STATE_LABEL,
  type SyncStateReading,
  type TuroSyncState,
} from "@/hooks/use-turo-bridge";
import {
  describeHeartbeat,
  describeJobProgress,
  type TuroSyncJob,
} from "@/hooks/use-turo-sync-jobs";

/* ---------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------ */

/**
 * The house stat card. Copied from (dashboard)/vehicle-owners/page.tsx:197-211,
 * which is itself duplicated byte-for-byte in owner-payouts/page.tsx:184-197 —
 * so this really is the shared shape rather than one page's invention.
 */
export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const valueTone =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-2xl font-medium mt-1 ${valueTone}`}>{value}</p>
            {hint && <p className="text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
          </div>
          <div className="h-10 w-10 shrink-0 rounded-md bg-[#eef2ff] dark:bg-muted flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Section heading + optional right-hand action. 24px medium per the system. */
export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-2xl font-medium text-foreground">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Generic empty state inside a flat card. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="h-12 w-12 rounded-md bg-[#eef2ff] dark:bg-muted flex items-center justify-center mb-4">
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-2 text-center">{title}</h3>
        <div className="text-muted-foreground text-center max-w-md text-sm">{body}</div>
        {action && <div className="mt-6">{action}</div>}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * The absence-vs-error distinction, rendered
 * ------------------------------------------------------------------------ */

/**
 * What to show when a table is not installed.
 *
 * The hooks already separate "the relation does not exist" (`schemaMissing`)
 * from a genuine failure, because those two mean opposite things and an empty
 * list renders identically for both. A screen that showed "You're all caught
 * up" because the migration was never applied would be lying in exactly the
 * direction that costs a double-booking, so this component exists to make that
 * impossible by having somewhere else to go.
 */
export function SchemaMissing({
  what,
  message,
}: {
  what: string;
  message: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="h-12 w-12 rounded-md bg-[#eef2ff] dark:bg-muted flex items-center justify-center mb-4">
          <Database className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2 text-center">{what} is not set up yet</h3>
        {/*
          `message` is operator copy and stays free of file paths. The engineering
          detail rides along as hover text so a support call can still get the
          exact outstanding step out of the screen without it being shouted at
          somebody who cannot act on it.
        */}
        <p
          className="text-muted-foreground text-center max-w-lg text-sm"
          title={TURO_FOUNDATION_MISSING_DETAIL}
        >
          {message}
        </p>
        <p className="text-xs text-muted-foreground text-center max-w-lg mt-3">
          This is not the same as having nothing to do. Until setup is finished, this screen
          cannot tell you whether there is work waiting here — so it will not pretend there is
          none.
        </p>
      </CardContent>
    </Card>
  );
}

/** A read that failed for a reason that is not an unapplied migration. */
export function LoadFailed({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    (error as { message?: string } | null)?.message || "The request to the database failed.";
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="h-12 w-12 rounded-md bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-4">
          <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2 text-center">{what} could not be loaded</h3>
        <p className="text-muted-foreground text-center max-w-lg text-sm">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-6" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** A one-line banner for a degraded-but-usable condition. */
export function Notice({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "warn" | "danger";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const styles =
    tone === "danger"
      ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
        : "border-[#e0e7ff] bg-[#eef2ff] dark:border-indigo-900 dark:bg-indigo-950/30";

  const defaultIcon =
    tone === "danger" ? (
      <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
    ) : tone === "warn" ? (
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
    ) : (
      <Info className="h-4 w-4 mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
    );

  return (
    <div className={`flex items-start gap-3 rounded-md border px-4 py-3 ${styles}`}>
      {icon ?? defaultIcon}
      <div className="text-sm text-[#404040] dark:text-muted-foreground">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Badges — colored text, per the design system, not background pills
 * ------------------------------------------------------------------------ */

const SYNC_STATE_TONE: Record<TuroSyncState, string> = {
  pending_match: "text-amber-600 dark:text-amber-400",
  staged: "text-[#2563eb] dark:text-blue-400",
  promoted: "text-[#16a34a] dark:text-green-400",
  cancellation_candidate: "text-[#d97706] dark:text-orange-400",
  conflict: "text-[#dc2626] dark:text-red-400",
  ignored: "text-muted-foreground",
};

/**
 * The reconciliation state as colored text.
 *
 * Takes the hook's `SyncStateReading` rather than a bare string, so the three
 * answers stay three answers:
 *   `column`        — a real state, rendered normally.
 *   `absent`        — the column is not there. Rendered as "Not classified",
 *                     never as a default state: telling an operator a row is
 *                     "Ready to promote" when nothing has staged it would offer
 *                     them a promotion that does not exist.
 *   `unrecognised`  — the column holds a value this build does not know. Shown
 *                     verbatim, because that is how a schema change reaches a
 *                     human instead of being swallowed.
 */
export function SyncStateText({ reading }: { reading: SyncStateReading }) {
  if (reading.source === "unrecognised") {
    return (
      <span
        className="text-sm font-medium text-[#dc2626] dark:text-red-400"
        title="This build does not recognise this state. It is shown exactly as the database holds it."
      >
        {reading.rawValue}
      </span>
    );
  }
  if (!reading.state) {
    return (
      <span
        className="text-sm text-muted-foreground italic"
        title="Drive247 has not classified this trip yet — that part of Turo Sync is not set up on this account."
      >
        Not classified
      </span>
    );
  }
  return (
    <span className={`text-sm font-medium ${SYNC_STATE_TONE[reading.state]}`}>
      {TURO_SYNC_STATE_LABEL[reading.state]}
    </span>
  );
}

/**
 * LIVE vs DEMO.
 *
 * The extension falls back to a bundled sample whenever it cannot reach a real
 * Turo session, and that fallback is recorded on the row rather than inferred.
 * The badge is repeated on every row on purpose: a demo reservation mistaken
 * for a real booking is how a real car gets taken off sale for nothing.
 */
export function SourceBadge({ source }: { source: string }) {
  if (source === "fixture") {
    return (
      <span
        title="Bundled sample data — the extension could not reach a live Turo session. This row can never create a booking or a block."
        className="inline-flex items-center rounded border border-[#e0e7ff] bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-medium text-[#4338ca] dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
      >
        DEMO
      </span>
    );
  }
  return (
    <span
      title="Read from your live, signed-in Turo session"
      className="inline-flex items-center rounded border border-green-300 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:border-green-800 dark:text-green-400"
    >
      LIVE
    </span>
  );
}

/** A value we do not have. Never blank, never zero — always visibly absent. */
export function Unknown({ why }: { why?: string }) {
  return (
    <span className="text-muted-foreground" title={why ?? "Not provided by Turo"}>
      —
    </span>
  );
}

/** Monospace short id, full value on hover. */
export function MonoId({ value, chars = 8 }: { value: string; chars?: number }) {
  return (
    <span className="font-mono text-xs text-muted-foreground" title={value}>
      {value.length > chars ? `${value.slice(0, chars)}…` : value}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * THE COVERAGE READOUT — the anti-"8/8 green" component
 * ------------------------------------------------------------------------ */

/**
 * How much of Turo a run actually read, stated honestly.
 *
 * Every number and every sentence comes from `describeJobProgress()`, which
 * takes its denominator from `progress_denominator` — a GENERATED ALWAYS column
 * Postgres sets to NULL unless the run finished clean — and from nowhere else.
 * `feed_reported_total` is never consulted for coverage: it arrives in the same
 * response as the records it claims to count, so a bot filter answering
 * "total: 8" with three trips would otherwise render a confident 8/8 on a read
 * that saw almost nothing.
 *
 * The visual rule that follows: a filled green bar exists only when
 * `coverageProven` is true. Everything else is an amber bar that is
 * deliberately not full, next to the words "there may be more".
 */
export function CoverageReadout({
  job,
  compact = false,
}: {
  job: TuroSyncJob;
  compact?: boolean;
}) {
  const progress = describeJobProgress(job);
  const heartbeat = describeHeartbeat(job);
  const running = job.state === "running";

  if (running) {
    return (
      <div className={compact ? "" : "space-y-1.5"}>
        <div className="flex items-center gap-2">
          <CircleDashed className="h-3.5 w-3.5 shrink-0 animate-spin text-[#2563eb] dark:text-blue-400" />
          <span className="text-sm text-[#2563eb] dark:text-blue-400">{progress.display}</span>
        </div>
        {!compact && (
          <>
            {/* No bar while running: there is no honest denominator yet. */}
            <p className="text-xs text-muted-foreground">{progress.caveat}</p>
            {heartbeat.note && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{heartbeat.note}</p>
            )}
          </>
        )}
      </div>
    );
  }

  if (progress.coverageProven) {
    return (
      <div className={compact ? "" : "space-y-1.5"}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#16a34a] dark:text-green-400" />
          <span className="text-sm text-[#16a34a] dark:text-green-400">{progress.display}</span>
        </div>
        {!compact && (
          <div className="h-1.5 w-full rounded-full bg-[#f1f5f9] dark:bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-[#16a34a]"
              style={{ width: `${progress.percent ?? 100}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // PARTIAL. Everything below must read as unfinished at a glance.
  return (
    <div className={compact ? "" : "space-y-1.5"}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-sm text-amber-700 dark:text-amber-400">{progress.display}</span>
      </div>
      {!compact && (
        <>
          {/*
            A deliberately partial bar with no width derived from data: two
            thirds, always, because the true fraction is unknowable. It signals
            "unfinished" without inventing a figure.
          */}
          <div className="h-1.5 w-full rounded-full bg-[#f1f5f9] dark:bg-muted overflow-hidden">
            <div className="h-full w-2/3 rounded-full bg-amber-500" />
          </div>
          {progress.caveat && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{progress.caveat}</p>
          )}
          {job.feed_reported_total !== null && (
            <p className="text-xs text-muted-foreground">
              Turo claimed {job.feed_reported_total} in total. That figure came from the same
              response as the trips, so it is not treated as a target.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Small formatting helpers
 * ------------------------------------------------------------------------ */

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A trip window, times included.
 *
 * Times are shown because `blocked_dates` is DATE-only with an inclusive end
 * while Turo trips are timestamps — a trip handed back at 10:00 and one
 * collected at 16:00 on the same date is a legitimate same-day turnaround, and
 * the operator can only see that if the hours are on screen.
 */
export function TripWindow({
  startsAt,
  endsAt,
}: {
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
}) {
  if (!startsAt || !endsAt) {
    return (
      <Unknown why="Turo did not give usable dates for this trip, so it cannot be imported." />
    );
  }
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const days = Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000));
  return (
    <div className="text-sm">
      <div className="whitespace-nowrap">
        {fmtDateTime(startsAt)}
        <span className="text-muted-foreground"> → </span>
        {fmtDateTime(endsAt)}
      </div>
      {days > 0 && (
        <div className="text-xs text-muted-foreground">
          {days} {days === 1 ? "day" : "days"}
        </div>
      )}
    </div>
  );
}
