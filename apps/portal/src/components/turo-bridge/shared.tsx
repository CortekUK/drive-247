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
 * ── DESIGN SYSTEM: Northwind v2 (NORTHWIND_UI_GUIDE.md), SCOPED ─────────────
 *
 * Cards, buttons and dialogs sit at 26px (`rounded-4xl`); inputs and badges at
 * 22px (`rounded-3xl`). Surfaces are separated by a translucent RING plus a
 * soft shadow — never a 1px grey line. One saturated colour, a deep
 * violet-indigo, reserved for primary actions and active state. Focus is 3px.
 *
 * NOTHING HERE HARD-CODES A COLOUR. Every value is a token consumed through
 * Tailwind as `hsl(var(--token))`, and `.dark .northwind` redefines all of them
 * — where, per the guide, primary gets DARKER rather than lighter. That is why
 * the hand-picked `dark:text-indigo-400` companions that used to sit beside
 * these classes are gone: they inverted the one rule the palette is most
 * particular about.
 *
 * The scope is a single class, `.northwind`, on the page wrapper. The portal
 * around this screen is a different system entirely (gold on cream, Playfair
 * Display) and is deliberately untouched — which is why the card and pill
 * recipes are built here rather than by restyling `@/components/ui/*`, shared
 * with ~50 screens this brief does not cover.
 */
"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Database, Info, XCircle } from "lucide-react";
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
 * The recipes (§6)
 * ------------------------------------------------------------------------ */

/**
 * §6.2. 26px, ringed, softly shadowed, and padded from a LOCAL variable so a
 * caller changes one number rather than three paddings.
 */
export function NwCard({
  className = "",
  size = "default",
  children,
}: {
  className?: string;
  size?: "default" | "sm";
  children: ReactNode;
}) {
  return (
    <div
      data-size={size}
      className={
        "flex flex-col overflow-hidden rounded-4xl bg-card text-card-foreground " +
        "shadow-[var(--shadow-card)] ring-1 ring-foreground/5 dark:ring-foreground/10 " +
        "[--card-spacing:1.5rem] data-[size=sm]:[--card-spacing:1rem] " +
        className
      }
    >
      {children}
    </div>
  );
}

/** Card body. Reads `--card-spacing`, so padding stays in one place. */
export function NwCardBody({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`p-[var(--card-spacing)] ${className}`}>{children}</div>;
}

/**
 * §6.6 status pill — the one badge shape this design uses for health and
 * integration state. Tinted background, matching border and text, and a dot
 * unless the caller supplies a more specific icon.
 */
export function StatusPill({
  tone,
  icon,
  title,
  children,
}: {
  tone: "connected" | "attention" | "danger" | "neutral";
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    connected: "border-success/30 bg-success/10 text-success",
    attention: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    neutral: "border-transparent text-muted-foreground",
  } as const;
  const dot = {
    connected: "bg-success",
    attention: "bg-warning",
    danger: "bg-destructive",
    neutral: "bg-muted-foreground/40",
  } as const;
  return (
    <span
      title={title}
      className={
        "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 " +
        "overflow-hidden rounded-3xl border px-2 py-0.5 text-xs font-medium " +
        `whitespace-nowrap [&>svg]:!size-3 ${tones[tone]}`
      }
    >
      {icon ?? <span className={`size-1.5 rounded-full ${dot[tone]}`} />}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Layout
 * ------------------------------------------------------------------------ */

/** The house stat card, on the Northwind card recipe. */
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
    tone === "danger" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground";

  return (
    <NwCard size="sm" className="transition-all hover:shadow-[var(--shadow-hover)]">
      <NwCardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* §7 section-label convention: the caption is the quiet part. */}
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className={`mt-2 text-2xl font-semibold leading-none tracking-tight ${valueTone}`}>
              {value}
            </p>
            {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
          </div>
          {/* The only tinted surface on the card, so the number stays the thing
              you read first. */}
          <div className="flex size-10 shrink-0 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </NwCardBody>
    </NwCard>
  );
}

/** Section heading + optional right-hand action. */
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Generic empty state. */
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
    <NwCard>
      <NwCardBody className="flex flex-col items-center justify-center py-14">
        <div className="mb-5 flex size-14 items-center justify-center rounded-4xl bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="mb-2 text-center text-base font-semibold tracking-tight">{title}</h3>
        <div className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">
          {body}
        </div>
        {action && <div className="mt-6">{action}</div>}
      </NwCardBody>
    </NwCard>
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
export function SchemaMissing({ what, message }: { what: string; message: string | null }) {
  return (
    <NwCard>
      <NwCardBody className="flex flex-col items-center justify-center py-14">
        <div className="mb-5 flex size-14 items-center justify-center rounded-4xl bg-primary/10 text-primary">
          <Database className="size-6" />
        </div>
        <h3 className="mb-2 text-center text-base font-semibold tracking-tight">
          {what} is not set up yet
        </h3>
        {/*
          `message` is operator copy and stays free of file paths. The engineering
          detail rides along as hover text so a support call can still get the
          exact outstanding step out of the screen without it being shouted at
          somebody who cannot act on it.
        */}
        <p
          className="max-w-lg text-center text-sm leading-relaxed text-muted-foreground"
          title={TURO_FOUNDATION_MISSING_DETAIL}
        >
          {message}
        </p>
        {/* §7 callout: a toned panel, so the caveat reads as a deliberate
            statement rather than a footnote in grey. */}
        <p className="mt-5 max-w-lg rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-center text-xs leading-relaxed text-warning">
          This is not the same as having nothing to do. Until setup is finished, this screen
          cannot tell you whether there is work waiting here — so it will not pretend there is
          none.
        </p>
      </NwCardBody>
    </NwCard>
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
    <NwCard>
      <NwCardBody className="flex flex-col items-center justify-center py-14">
        {/* Destructive surfaces are TINTED, never filled solid (§8). */}
        <div className="mb-5 flex size-14 items-center justify-center rounded-4xl bg-destructive/10 text-destructive">
          <XCircle className="size-6" />
        </div>
        <h3 className="mb-2 text-center text-base font-semibold tracking-tight">
          {what} could not be loaded
        </h3>
        <p className="max-w-lg text-center text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-6 rounded-4xl" onClick={onRetry}>
            Try again
          </Button>
        )}
      </NwCardBody>
    </NwCard>
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
  /* §7 callout tones: tinted, never solid, with a matching tinted border rather
     than a grey line. */
  const styles =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10"
      : tone === "warn"
        ? "border-warning/30 bg-warning/10"
        : "border-primary/20 bg-primary/10";

  const defaultIcon =
    tone === "danger" ? (
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
    ) : tone === "warn" ? (
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
    ) : (
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
    );

  return (
    <div className={`flex items-start gap-3 rounded-3xl border px-4 py-3 ${styles}`}>
      {icon ?? defaultIcon}
      <div className="text-sm leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * State as colour — text, not pills, so a dense table stays scannable
 * ------------------------------------------------------------------------ */

const SYNC_STATE_TONE: Record<TuroSyncState, string> = {
  pending_match: "text-warning",
  staged: "text-primary",
  promoted: "text-success",
  cancellation_candidate: "text-warning",
  conflict: "text-destructive",
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
        className="text-sm font-medium text-destructive"
        title="This build does not recognise this state. It is shown exactly as the database holds it."
      >
        {reading.rawValue}
      </span>
    );
  }
  if (!reading.state) {
    return (
      <span
        className="text-sm italic text-muted-foreground"
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
        className="inline-flex h-5 items-center rounded-3xl border border-primary/25 bg-primary/10 px-2 text-[10px] font-semibold tracking-wide text-primary"
      >
        DEMO
      </span>
    );
  }
  return (
    <span
      title="Read from your live, signed-in Turo session"
      className="inline-flex h-5 items-center rounded-3xl border border-success/30 bg-success/10 px-2 text-[10px] font-semibold tracking-wide text-success"
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
    <span className="font-mono text-[13px] text-muted-foreground" title={value}>
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
 * The visual rule that follows: a filled success bar exists only when
 * `coverageProven` is true. Everything else is a warning bar that is
 * deliberately not full, next to the words "there may be more".
 */
export function CoverageReadout({ job, compact = false }: { job: TuroSyncJob; compact?: boolean }) {
  const progress = describeJobProgress(job);
  const heartbeat = describeHeartbeat(job);
  const running = job.state === "running";

  if (running) {
    return (
      <div className={compact ? "" : "space-y-1.5"}>
        <div className="flex items-center gap-2">
          <CircleDashed className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-sm font-medium text-primary">{progress.display}</span>
        </div>
        {!compact && (
          <>
            {/* No bar while running: there is no honest denominator yet. */}
            <p className="text-xs leading-relaxed text-muted-foreground">{progress.caveat}</p>
            {heartbeat.note && (
              <p className="text-xs leading-relaxed text-warning">{heartbeat.note}</p>
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
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
          <span className="text-sm font-medium text-success">{progress.display}</span>
        </div>
        {!compact && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all duration-300"
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
        <AlertTriangle className="size-3.5 shrink-0 text-warning" />
        <span className="text-sm font-medium text-warning">{progress.display}</span>
      </div>
      {!compact && (
        <>
          {/*
            A deliberately partial bar with no width derived from data: two
            thirds, always, because the true fraction is unknowable. It signals
            "unfinished" without inventing a figure.
          */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 rounded-full bg-warning" />
          </div>
          {progress.caveat && (
            <p className="text-xs leading-relaxed text-warning">{progress.caveat}</p>
          )}
          {job.feed_reported_total !== null && (
            <p className="text-xs leading-relaxed text-muted-foreground">
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
