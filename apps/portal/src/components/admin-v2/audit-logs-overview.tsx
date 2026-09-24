"use client";

import { useMemo } from "react";
import { differenceInCalendarDays, format, startOfDay } from "date-fns";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { AUDIT_LOGS_V2_LIMIT, type AuditLog } from "@/hooks/use-audit-logs";
import type { HeroRange } from "@/lib/hero-series";

/**
 * The Audit Logs hero row: one simple graph, the front face of the overview
 * whose back is the filter panel.
 *
 * WHY A GRAPH AT ALL. Every other v2 list page answers "how busy has this
 * been?" above its table (Rentals, Customers, Vehicles), and an audit log is
 * the one list where the SHAPE is most of the value: a quiet week with a spike
 * in it is the thing you came to find, and no table of 25 rows at a time shows
 * that. The brief for these rows is one graph, "extremely simple, like
 * Stripe's", so this draws one metric and one companion line and nothing else.
 *
 * NO FEATURED CARD, so the graph takes the whole row. The deck
 * (components/shared/featured-deck-v2.tsx) offers a tab's own ACTIONS — invite
 * a customer, import a CSV, open the calendar — each gated in
 * lib/featured-cards.ts under the same permission as the header control it
 * mirrors. Audit Logs is read-only for everyone (`audit_logs` is `viewOnly` in
 * lib/permissions.ts) and its single action, Export CSV, is already a header
 * button, so a card here would either point somewhere else on the portal or
 * repeat a control two inches away. `HeroRow` gives the graph all four columns
 * when no card is passed, which is the right shape rather than an empty
 * quarter.
 *
 * EVERY NUMBER HERE IS REAL, and comes from the rows the table below is
 * showing — no query of its own, so it cannot say something the table does not.
 * The series math is lib/hero-series.ts, which has hand-worked tests.
 *
 * WHAT COUNTS.
 *   - LOG ENTRIES counts each loaded row once, on the calendar day (the
 *     viewer's local time, as the table prints it) it was written:
 *     `audit_logs.created_at`, a timestamptz.
 *   - VIEWS & WARNINGS counts the same rows on the same days, keeping only the
 *     entries that record a dialog or a confirmation warning being SHOWN rather
 *     than anything changing (`*_dialog_shown`, `*_warning_shown`). Those rows
 *     are a large and growing share of the log, and the gap between the two
 *     lines is therefore the real activity. It is drawn as the companion rather
 *     than inverted into a "changes" line because this set is the one that can
 *     be named exactly: `login_success` and `logout` change nothing either, and
 *     calling them changes would be wrong.
 *   - A row whose `created_at` is missing, or dated after today, is not placed.
 *
 * WHAT THIS CANNOT SEE — and says so rather than drawing over it. The fetch
 * stops at `AUDIT_LOGS_V2_LIMIT` rows (PostgREST's per-request maximum), so on
 * a busy tenant the page holds the most recent 1,000 entries and nothing
 * older. A 12-month line over that would slope to nothing in the past and
 * imply a quiet spring that we simply did not load. So when the fetch came
 * back full:
 *   - the caption under the graph names the oldest entry we hold and says
 *     plainly that earlier days are not counted; and
 *   - the period the graph OPENS on is stepped down to one the loaded rows
 *     cover (`auditDefaultRange`), so the first thing on screen is complete.
 * Widening the period from there still draws the truncated tail — the caption
 * is right there saying why, and hiding periods outright would leave an
 * operator with filters applied unable to look back at all.
 */

interface Props {
  /** The rows the table is showing (filters and the search applied). */
  logs: readonly AuditLog[];
  /** True when a filter or the search narrows the list. */
  filtered: boolean;
  /** True when the fetch came back full, so older entries exist that we do not hold. */
  capped: boolean;
  /** For tests. Defaults to now, and the chart rolls over at midnight. */
  today?: Date;
}

/**
 * An entry that only records that something was SHOWN — a dialog opened, a
 * confirmation warning displayed — rather than anything changing.
 *
 * The same two substrings `getActionColor` tests FIRST (which is what paints
 * these rows orange in v1 and gives them the "warning" tone in the v2 table),
 * so the line and the rows it counts can never mean different things.
 */
export function isViewOrWarningAction(action: string): boolean {
  return action.includes("dialog_shown") || action.includes("warning_shown");
}

/**
 * The period the graph opens on.
 *
 * 30 days, the same default as every other hero tab — except when the fetch was
 * capped AND the rows we hold do not reach back 30 days, in which case opening
 * on 30 days would draw three weeks of flat line that is an artefact of the
 * cap. `span` is the number of calendar days the loaded rows cover, oldest
 * through today inclusive.
 */
export function auditDefaultRange(capped: boolean, span: number | undefined): HeroRange {
  if (!capped || span === undefined) return "30d";
  return span >= 30 ? "30d" : "7d";
}

/** The start of the day of the oldest loaded entry, or undefined when there is none. */
export function oldestLoadedDay(logs: readonly AuditLog[]): Date | undefined {
  let oldest: number | undefined;
  for (const log of logs) {
    const at = log.created_at ? new Date(log.created_at).getTime() : NaN;
    if (Number.isNaN(at)) continue;
    if (oldest === undefined || at < oldest) oldest = at;
  }
  return oldest === undefined ? undefined : startOfDay(new Date(oldest));
}

export function AuditLogsOverview({ logs, filtered, capped, today }: Props) {
  const metrics = useMemo<HeroMetric[]>(() => {
    const dated = logs.filter((l): l is AuditLog & { created_at: string } => !!l.created_at);
    return [
      {
        key: "log-entries",
        label: "Log entries",
        kind: "flow",
        description:
          "Entries written to this tenant's audit log, each counted on the day it was written. Only the entries this page has loaded are counted.",
        format: (v) => v.toLocaleString(),
        events: dated.map((l) => ({ at: new Date(l.created_at), amount: 1 })),
        secondary: {
          label: "Views & warnings",
          events: dated
            .filter((l) => isViewOrWarningAction(l.action))
            .map((l) => ({ at: new Date(l.created_at), amount: 1 })),
        },
      },
    ];
  }, [logs]);

  // Only needed while the fetch is capped, and the caption names it.
  const oldest = useMemo(() => (capped ? oldestLoadedDay(logs) : undefined), [capped, logs]);
  const day = startOfDay(today ?? new Date());
  const span = oldest ? differenceInCalendarDays(day, oldest) + 1 : undefined;

  return (
    <HeroRow
      chart={
        <div className="flex flex-col gap-2">
          <HeroChart
            metrics={metrics}
            defaultRange={auditDefaultRange(capped, span)}
            note={filtered ? "Filtered" : undefined}
            today={today}
          />
          {capped && (
            <p className="text-xs text-muted-foreground">
              Only the most recent {AUDIT_LOGS_V2_LIMIT.toLocaleString()} entries are loaded
              {oldest ? `, back to ${format(oldest, "MMM d, yyyy")}` : ""} — earlier days are not
              counted here. Filter to look further back.
            </p>
          )}
        </div>
      }
    />
  );
}
