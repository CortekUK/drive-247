"use client";

/**
 * Agreements v2: the hero row (D15). One graph across three quarters, one card
 * in the last, as on the Rentals, Customers and Vehicles tabs.
 *
 * THE GRAPH answers "is paperwork getting signed?": agreements sent per week
 * over the last 8 weeks, each week's bar split into Signed, Pending signature
 * and Failed. Above it the headline counts (Total · Signed · Failed, with
 * Pending signature beside them as the bar's third colour), and beside it the
 * two short lists the team lead asked for: the latest signed and the latest
 * failed, three each, customer and time.
 *
 * EVERY NUMBER IS THE LIST'S. It is worked out from the rows the page already
 * holds, the same filtered rows the table below shows, so it says "Filtered"
 * when the search or a filter narrows them. This file runs no query.
 *
 * Weeks are whole 7-day windows ending today (the last bar is the last 7
 * days), the way lib/hero-series.ts sizes its weekly points, so no week is cut
 * short and the chart never depends on which day a week starts on. A row is
 * placed on the operator's own calendar day, as the Sent column prints it.
 *
 * THE CARD is "Create your template" (`CreateTemplateCardV2`, D5/D15), passed
 * to HeroRow directly so the row's card slot lays out as every hero tab's does.
 *
 * Colour follows insights/_charts.tsx: every mark reads `var(--color-<key>)`
 * from the ChartConfig, never a literal on the SVG. The values are the v2
 * theme's status tokens, which it steps for dark mode itself.
 */

import { useMemo } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { HERO_CHART_HEIGHT, HeroRow } from "@/components/shared/hero-chart-v2";
import { CreateTemplateCardV2 } from "@/components/agreements-v2/create-template-card-v2";
import { formatAgreementSentAtV2 } from "@/components/agreements-v2/agreements-table-v2";
import { sentAtMs } from "@/lib/agreements-v2/list-filters";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";
import { cn } from "@/lib/utils";

export const OVERVIEW_WEEKS_V2 = 8;
export const OVERVIEW_LIST_LENGTH_V2 = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgreementWeekV2 {
  /** "Sep 15": the first day of the week, the axis label. */
  label: string;
  /** "Sep 15 – Sep 21": the tooltip's heading. */
  range: string;
  signed: number;
  pending: number;
  failed: number;
  total: number;
}

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addLocalDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The last `weeks` 7-day windows, oldest first, the last one ending on
 * `today`. Each row counts once, in the window holding the day it was sent,
 * under its own status. Rows with no sent time, or sent after today, are not
 * placed.
 */
export function agreementWeeksV2(
  rows: readonly Pick<AgreementRowV2, "sentAt" | "status">[],
  today: Date,
  weeks: number = OVERVIEW_WEEKS_V2,
): AgreementWeekV2[] {
  const lastDay = startOfLocalDay(today);
  const firstDay = addLocalDays(lastDay, -(weeks * 7 - 1));
  const buckets: AgreementWeekV2[] = Array.from({ length: weeks }, (_, i) => {
    const start = addLocalDays(firstDay, i * 7);
    const end = addLocalDays(start, 6);
    return {
      label: shortDay(start),
      range: `${shortDay(start)} – ${shortDay(end)}`,
      signed: 0,
      pending: 0,
      failed: 0,
      total: 0,
    };
  });
  const windowStart = firstDay.getTime();
  const windowEnd = addLocalDays(lastDay, 1).getTime();
  for (const row of rows) {
    const ms = sentAtMs(row);
    if (ms === null || ms < windowStart || ms >= windowEnd) continue;
    // Whole local days from the first day, so a DST change inside the window
    // (a 23- or 25-hour day) cannot push a row into the next week.
    const sentDay = startOfLocalDay(new Date(ms));
    const dayIndex = Math.round((sentDay.getTime() - windowStart) / DAY_MS);
    const bucket = buckets[Math.min(weeks - 1, Math.max(0, Math.floor(dayIndex / 7)))];
    bucket[row.status] += 1;
    bucket.total += 1;
  }
  return buckets;
}

/** Total · Signed · Pending signature · Failed across the rows given. */
export function agreementHeadlineV2(rows: readonly Pick<AgreementRowV2, "status">[]) {
  const counts = { total: rows.length, signed: 0, pending: 0, failed: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** When a signed row was signed: its signed time, else when it was sent. */
const signedMs = (row: Pick<AgreementRowV2, "signedAt" | "sentAt">): number | null => {
  const at = row.signedAt ? Date.parse(row.signedAt) : NaN;
  return Number.isNaN(at) ? sentAtMs(row) : at;
};

const newestBy = <T,>(rows: T[], key: (row: T) => number | null) =>
  [...rows].sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));

/** The latest signed rows, newest signature first. */
export function recentlySignedV2<T extends AgreementRowV2>(rows: readonly T[], limit = OVERVIEW_LIST_LENGTH_V2): T[] {
  return newestBy<T>(
    rows.filter((r) => r.status === "signed"),
    signedMs,
  ).slice(0, limit);
}

/** The latest failed rows, newest send first. */
export function recentlyFailedV2<T extends AgreementRowV2>(rows: readonly T[], limit = OVERVIEW_LIST_LENGTH_V2): T[] {
  return newestBy<T>(
    rows.filter((r) => r.status === "failed"),
    sentAtMs,
  ).slice(0, limit);
}

/* ── the chart ─────────────────────────────────────────────────────────── */

const chartConfig: ChartConfig = {
  signed: { label: "Signed", theme: { light: "hsl(var(--success))", dark: "hsl(var(--success))" } },
  pending: { label: "Pending signature", theme: { light: "hsl(var(--warning))", dark: "hsl(var(--warning))" } },
  failed: { label: "Failed", theme: { light: "hsl(var(--destructive))", dark: "hsl(var(--destructive))" } },
};

/** The legend's swatches sit outside ChartContainer, so they carry the same tokens as classes. */
const SWATCH = {
  signed: "bg-[hsl(var(--success))]",
  pending: "bg-[hsl(var(--warning))]",
  failed: "bg-[hsl(var(--destructive))]",
} as const;

/** Recessive axis: no tick marks, no rule, small type (insights/_charts.tsx). */
const AXIS = { tickLine: false, axisLine: false, tickMargin: 6, fontSize: 11 } as const;

function WeekTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: AgreementWeekV2 }> }) {
  const week = payload?.[0]?.payload;
  if (!active || !week) return null;
  return (
    <div className="min-w-[180px] rounded-xl border bg-background px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-medium text-foreground">{week.range}</div>
      {(["signed", "pending", "failed"] as const).map((key) => (
        <div key={key} className="mt-1 flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-[2px]", SWATCH[key])} aria-hidden />
          <span className="text-muted-foreground">{chartConfig[key].label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{week[key]}</span>
        </div>
      ))}
    </div>
  );
}

function MiniList({
  title,
  rows,
  when,
  empty,
}: {
  title: string;
  rows: AgreementRowV2[];
  when: (row: AgreementRowV2) => string | null;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-foreground" title={row.customerName}>
                {row.customerName || row.customerEmail || "—"}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatAgreementSentAtV2(when(row))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgreementsActivityV2({
  rows,
  filtered,
  today,
}: {
  rows: readonly AgreementRowV2[];
  filtered: boolean;
  today: Date;
}) {
  const dayKey = startOfLocalDay(today).getTime();
  const weeks = useMemo(() => agreementWeeksV2(rows, new Date(dayKey)), [rows, dayKey]);
  const counts = useMemo(() => agreementHeadlineV2(rows), [rows]);
  const signed = useMemo(() => recentlySignedV2(rows), [rows]);
  const failed = useMemo(() => recentlyFailedV2(rows), [rows]);
  const sentInWindow = weeks.reduce((sum, w) => sum + w.total, 0);

  return (
    <section className="flex flex-col gap-3" aria-label={`Agreements sent per week, last ${OVERVIEW_WEEKS_V2} weeks`}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-foreground">Agreements sent</span>
        <div className="flex shrink-0 items-center gap-2">
          {filtered && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/80">
              Filtered
            </span>
          )}
          <span className="text-sm text-muted-foreground">Last {OVERVIEW_WEEKS_V2} weeks</span>
        </div>
      </div>

      {/* The headline: every agreement listed, and how many of them are
          signed and failed. Each count carries its bar colour, so the row is
          also the chart's legend. */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5" aria-hidden>
        <span className="flex items-baseline gap-1.5">
          <span className="font-heading text-3xl leading-none tracking-tight tabular-nums">
            {counts.total.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">total</span>
        </span>
        {(["signed", "pending", "failed"] as const).map((key) => (
          <span key={key} className="flex items-center gap-1.5 text-sm">
            <span className={cn("size-2 shrink-0 rounded-[2px]", SWATCH[key])} />
            <span className="text-muted-foreground">{chartConfig[key].label}</span>
            <span className="font-medium tabular-nums text-foreground">{counts[key].toLocaleString()}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_13rem]">
        <ChartContainer config={chartConfig} className={cn("aspect-auto w-full", HERO_CHART_HEIGHT)}>
          <BarChart data={weeks} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            {/* Never a zero-height scale: an empty stretch draws no bars, not a crash. */}
            <YAxis hide domain={[0, (dataMax: number) => Math.max(1, dataMax)]} allowDecimals={false} />
            <ChartTooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={<WeekTooltip />} />
            <Bar dataKey="signed" stackId="sent" fill="var(--color-signed)" maxBarSize={32} isAnimationActive={false} />
            <Bar dataKey="pending" stackId="sent" fill="var(--color-pending)" maxBarSize={32} isAnimationActive={false} />
            <Bar dataKey="failed" stackId="sent" fill="var(--color-failed)" maxBarSize={32} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>

        <div className="grid grid-cols-2 content-start gap-4 md:grid-cols-1">
          <MiniList
            title="Recently signed"
            rows={signed}
            when={(row) => row.signedAt ?? row.sentAt}
            empty="Nothing signed yet."
          />
          <MiniList title="Failed" rows={failed} when={(row) => row.sentAt} empty="Nothing has failed." />
        </div>
      </div>

      <p className="sr-only">
        {`Agreements listed: ${counts.total}. Signed: ${counts.signed}. Pending signature: ${counts.pending}. Failed: ${counts.failed}. Sent in the last ${OVERVIEW_WEEKS_V2} weeks: ${sentInWindow}.`}
      </p>
    </section>
  );
}

export function AgreementsOverviewV2({
  rows,
  filtered,
  onCreateTemplate,
  canCreateTemplate,
  today,
}: {
  /** The rows the table shows (filtered and searched), not a page of them. */
  rows: readonly AgreementRowV2[];
  /** True when the search or a filter narrows the list. */
  filtered: boolean;
  /** Opens the templates section's "create" (the page puts ?view=templates&new=1 in the URL). */
  onCreateTemplate: () => void;
  /** Template editing keeps its grant: canEditSettings('templates') (D19). */
  canCreateTemplate: boolean;
  /** For tests. Defaults to now. */
  today?: Date;
}) {
  return (
    <HeroRow
      chart={<AgreementsActivityV2 rows={rows} filtered={filtered} today={today ?? new Date()} />}
      card={<CreateTemplateCardV2 onCreate={onCreateTemplate} disabled={!canCreateTemplate} />}
    />
  );
}
