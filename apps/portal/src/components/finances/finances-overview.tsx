"use client";

/**
 * The Finances hero row: one simple graph, and one card beside it — the same
 * row the Rentals, Customers and Vehicles tabs draw (`HeroRow` + `HeroChart`
 * from components/shared/hero-chart-v2.tsx), so the tabs read alike.
 *
 * THE GRAPH is Collected: money that came in and stayed, on the day each
 * payment was made, with what came in before refunds as the lighter second
 * line and the previous period dotted behind — and "Payments collected" (the
 * count) in the metric picker, the way Rentals offers value and count. The
 * headline is the design's Collected exactly (§3: payment_type 'Payment',
 * money received, not a placeholder link; net of refunds), summed over the
 * graph's own period, which the picker beside it chooses — as on every hero
 * tab.
 *
 * THE CARD is what is owed: Outstanding with its ageing (not yet late /
 * 1–30 / 31–60 / over 60 days late), Overdue, and — where payment plans exist
 * — what is due in the next 7 days. Outstanding, Overdue and Upcoming are the
 * model's own numbers (`FinanceStats`), never recomputed here, and so is the
 * ageing (`FinanceSeries.ageing`, lib/finances/series.ts: the same lines, the
 * same "due before today" rule). It is drawn only when it adds back up to the
 * figures exactly; otherwise the card shows the numbers and no breakdown,
 * because a bar that does not sum to the figure above it would be a second
 * definition of that figure.
 *
 * THE GRAPH FOLLOWS THE VIEW. On the Fines view (for someone who may see
 * fines) the picker also offers "Fines issued" (value, and a count), and
 * "Fines paid", and the graph opens on "Fines issued"; every other view opens
 * on "Collected". The fine metrics are built from the Fines list's own rows
 * (lib/finances/fines.ts), so a figure in the graph is always the rows under
 * it. They join the picker on the Fines view only because that is where those
 * rows are read — the page reads no fine until its view is opened. This row
 * replaces the Payment analytics and Fine analytics links the header used to
 * carry, as the overview graph replaced them on Customers, Vehicles and
 * Rentals; both routes still answer by URL.
 *
 * Neither the graph nor the card is a filter: no hero row filters its list
 * from the graph. The rows behind each figure are one click away in the filter
 * panel on the back of this card ("Show").
 *
 * Everything here is read from the rows the page already holds; this file
 * runs no query. Single stable root, no fixed height: the overview flip
 * measures this face.
 */

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { HERO_CHART_HEIGHT, HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { FEATURED_SHELL_CLASS } from "@/components/shared/featured-deck-view-v2";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { formatMoney, plural } from "@/lib/payment-plans-ui/format";
import { finesIssued, finesPaid, type FineRowLike } from "@/lib/finances/fines";
import type { AgeingBucket, AgeingKey, FinanceStats, OutstandingAgeing, ReceiptRow } from "@/lib/finances/types";

/* ── the graph ───────────────────────────────────────────────────────────── */

/** The graph's two metrics, from the collected receipts (the model's `isCollectedRow`). */
export function collectedMetrics(collected: readonly ReceiptRow[], currency: string): HeroMetric[] {
  const at = (r: ReceiptRow) => parseLocalDate(r.date);
  return [
    {
      key: "collected",
      label: "Collected",
      kind: "flow",
      description:
        "Money that came in and stayed: payments received (a link still waiting to be paid is not money), less what was refunded, on the day each was paid.",
      format: (v) => formatCurrency(v, currency),
      events: collected.map((r) => ({ at: at(r), amount: r.netCents / 100 })),
      secondary: { label: "Before refunds", events: collected.map((r) => ({ at: at(r), amount: r.amountCents / 100 })) },
    },
    {
      key: "payments",
      label: "Payments collected",
      kind: "flow",
      description: "How many payments came in, each counted on the day it was paid.",
      format: (v) => v.toLocaleString(),
      events: collected.map((r) => ({ at: at(r), amount: 1 })),
    },
  ];
}

/** The metric keys, so the page can say which one a view opens on. */
export const FINANCE_METRIC = {
  collected: "collected",
  payments: "payments",
  finesIssued: "fines_issued",
  finesIssuedCount: "fines_issued_count",
  finesPaid: "fines_paid",
} as const;

/**
 * The fine metrics, from the Fines list's own rows: every fine on its issue
 * day (value, and a count), and the paid ones on the day they were paid.
 */
export function fineMetrics(fines: readonly FineRowLike[], currency: string, timeZone: string | null | undefined): HeroMetric[] {
  const issued = finesIssued(fines);
  const paid = finesPaid(fines, timeZone);
  const money = (v: number) => formatCurrency(v, currency);
  return [
    {
      key: FINANCE_METRIC.finesIssued,
      label: "Fines issued",
      kind: "flow",
      description: "The value of the fines on the list, each on the day it was issued.",
      format: money,
      events: issued.map((e) => ({ at: parseLocalDate(e.day), amount: e.cents / 100 })),
    },
    {
      key: FINANCE_METRIC.finesIssuedCount,
      label: "Fines issued (count)",
      kind: "flow",
      description: "How many fines were issued, each counted on the day it was issued.",
      format: (v) => v.toLocaleString(),
      events: issued.map((e) => ({ at: parseLocalDate(e.day), amount: 1 })),
    },
    {
      key: FINANCE_METRIC.finesPaid,
      label: "Fines paid",
      kind: "flow",
      description: "The value of the fines on the list that are paid, each on the day it was paid.",
      format: money,
      events: paid.map((e) => ({ at: parseLocalDate(e.day), amount: e.cents / 100 })),
    },
  ];
}

/* ── the card: what is owed, and how late ────────────────────────────────── */

/**
 * The model's ageing, if — and only if — it adds back up to Outstanding and
 * Overdue exactly. Null means "draw the numbers, not the breakdown".
 */
export function ageingToDraw(
  ageing: OutstandingAgeing | undefined,
  stats: Pick<FinanceStats, "outstandingCents" | "overdueCents">,
): AgeingBucket[] | null {
  if (!ageing || ageing.buckets.length !== 4) return null;
  const total = ageing.buckets.reduce((s, b) => s + b.cents, 0);
  const late = ageing.buckets.filter((b) => b.key !== "current").reduce((s, b) => s + b.cents, 0);
  if (total !== stats.outstandingCents || late !== stats.overdueCents) return null;
  return ageing.buckets;
}

/** Each group's colour: the brand tint while it is not late, warmer the later it is. */
const AGEING_BAR: Record<AgeingKey, string> = {
  current: "bg-primary/35 dark:bg-[hsl(var(--chart-1)/0.5)]",
  d1_30: "bg-amber-400 dark:bg-amber-500",
  d31_60: "bg-orange-500",
  d60_plus: "bg-red-500",
};

function OwedCard({
  stats,
  ageing,
  currency,
  showUpcoming,
}: {
  stats: FinanceStats;
  ageing: AgeingBucket[] | null;
  currency: string;
  showUpcoming: boolean;
}) {
  const $ = (c: number) => formatMoney(c, currency);
  const total = stats.outstandingCents;
  return (
    <section
      data-finances-owed=""
      aria-label="What you are owed"
      className={cn(FEATURED_SHELL_CLASS, "lg:min-h-0 justify-between gap-3 p-4 hover:border-primary/20")}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outstanding</p>
        <p className="mt-1 truncate font-heading text-2xl leading-none tracking-tight tabular-nums" data-owed-outstanding="">
          {$(total)}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {total === 0 ? "Nobody owes anything" : `Owed by ${plural(stats.outstandingCustomers, "customer")}`}
        </p>
      </div>

      {ageing && total > 0 && (
        <div data-owed-ageing="" className="space-y-1.5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
            {ageing.map((b) =>
              b.cents > 0 ? (
                <div key={b.key} className={AGEING_BAR[b.key]} style={{ width: `${(b.cents / total) * 100}%` }} />
              ) : null,
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            {ageing.map((b) => (
              <div key={b.key} className="flex min-w-0 items-center justify-between gap-2" data-ageing={b.key}>
                <dt className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  <span className={cn("size-1.5 shrink-0 rounded-full", AGEING_BAR[b.key])} aria-hidden />
                  <span className="truncate">{b.label}</span>
                </dt>
                <dd className="tabular-nums text-foreground">{$(b.cents)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <dl className="space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2" data-owed-overdue="">
          <dt className="text-muted-foreground">Overdue{stats.overdueRentals ? ` · ${plural(stats.overdueRentals, "rental")}` : ""}</dt>
          <dd className={cn("font-semibold tabular-nums", stats.overdueCents > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
            {$(stats.overdueCents)}
          </dd>
        </div>
        {showUpcoming && (
          <div className="flex items-center justify-between gap-2" data-owed-upcoming="">
            <dt className="truncate text-muted-foreground">
              Due next 7 days
              {stats.upcomingCount ? ` · ${stats.upcomingAuto} by card, ${stats.upcomingLinks} by link` : ""}
            </dt>
            <dd className="font-semibold tabular-nums text-foreground">{$(stats.upcomingCents)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ── loading and failure: the vehicles row's placeholder, for money ─────── */

function ChartPlaceholder({ failed, onRetry, label = "Collected" }: { failed: boolean; onRetry: () => void; label?: string }) {
  const blank = failed ? "inline-block" : "inline-block animate-pulse rounded-md bg-muted";
  const nbsp = " ";
  return (
    <section className="flex flex-col gap-3" aria-label={label} aria-busy={!failed} data-finances-chart-placeholder="">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
            Last 30 days
            <ChevronDown className="size-3.5" aria-hidden />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-hidden>
          <span className={`w-28 font-heading text-3xl leading-none tracking-tight tabular-nums ${blank}`}>{failed ? "—" : nbsp}</span>
          <span className={`h-6 w-12 text-xs ${blank}`}>{nbsp}</span>
        </div>
      </div>
      {failed ? (
        <div className={`flex ${HERO_CHART_HEIGHT} w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 text-sm text-muted-foreground`}>
          <span>Couldn&apos;t load the money for this graph.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className={`${HERO_CHART_HEIGHT} w-full animate-pulse rounded-xl bg-muted/60`} aria-hidden />
      )}
    </section>
  );
}

function CardPlaceholder({ failed }: { failed: boolean }) {
  return (
    <section
      data-finances-owed=""
      aria-label="What you are owed"
      aria-busy={!failed}
      className={cn(FEATURED_SHELL_CLASS, "lg:min-h-0 justify-between gap-3 p-4 hover:border-primary/20")}
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outstanding</p>
        {failed ? (
          <>
            <p className="mt-1 font-heading text-2xl leading-none text-muted-foreground">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Couldn&apos;t be worked out</p>
          </>
        ) : (
          <>
            <span className="mt-1 block h-6 w-28 animate-pulse rounded-md bg-muted" />
            <span className="mt-2 block h-3 w-24 animate-pulse rounded-md bg-muted" />
          </>
        )}
      </div>
      {!failed && <span className="block h-2 w-full animate-pulse rounded-full bg-muted" aria-hidden />}
    </section>
  );
}

/* ── the row ─────────────────────────────────────────────────────────────── */

export function FinancesOverview({
  stats,
  collected,
  ageing,
  today,
  currency,
  loading,
  failed,
  filtered,
  showUpcoming,
  showChart,
  showCard,
  onRetry,
  fines,
  finesLoading = false,
  finesFailed = false,
  finesCapped = false,
  onFinesRetry,
  timeZone = null,
  defaultMetric,
}: {
  stats: FinanceStats | undefined;
  /** The collected receipts, narrowed by the filter bar but NOT by its period (the graph has its own). */
  collected: readonly ReceiptRow[];
  /**
   * The Fines list's rows, when the Fines view is on screen and the viewer may
   * see fines: they add "Fines issued" and "Fines paid" to the picker.
   * Undefined leaves them out.
   */
  fines?: readonly FineRowLike[];
  /** The Fines list is still reading: the graph waits rather than draw no fines. */
  finesLoading?: boolean;
  /** The Fines list's read failed: dashes and a retry, never a zero. */
  finesFailed?: boolean;
  /** The Fines list hit its 1,000-row cap, so the fine metrics cover the newest 1,000. */
  finesCapped?: boolean;
  onFinesRetry?: () => void;
  /** `tenants.timezone`, for the day a fine was paid. */
  timeZone?: string | null;
  /** The metric the graph opens on (the view it follows). */
  defaultMetric?: string;
  /** The model's Outstanding ageing (`FinanceSeries.ageing`). */
  ageing: OutstandingAgeing | undefined;
  /** The tenant's today, 'YYYY-MM-DD'. */
  today: string;
  currency: string;
  loading: boolean;
  /** The read failed: dashes and a retry, never a zero. */
  failed: boolean;
  filtered: boolean;
  /** Payment plans exist for this tenant, and the viewer may see them. */
  showUpcoming: boolean;
  /** The viewer may see what came in (the graph is Received's numbers). */
  showChart: boolean;
  /** The viewer may see what is billed (the owed card is Billed's numbers). */
  showCard: boolean;
  onRetry: () => void;
}) {
  const withFines = !!fines;
  const metrics = useMemo(
    () => [
      ...(showChart ? collectedMetrics(collected, currency) : []),
      ...(fines ? fineMetrics(fines, currency, timeZone) : []),
    ],
    [showChart, collected, currency, fines, timeZone],
  );
  const buckets = useMemo(() => (stats ? ageingToDraw(ageing, stats) : null), [ageing, stats]);
  const todayDate = useMemo(() => parseLocalDate(today), [today]);
  const ready = !loading && !failed && !!stats;
  // The graph opens on the view's own metric; waiting on the fines rows only
  // when that metric is a fine one.
  const opensOnFines = withFines && !!defaultMetric && defaultMetric.startsWith("fines_");
  const finesReady = !withFines || (!finesLoading && !finesFailed);
  const chartReady = ready && (finesReady || !opensOnFines);
  const chartFailed = failed || (opensOnFines && finesFailed);
  const chartNote = filtered ? "Filtered" : withFines && finesCapped ? "Newest 1,000 fines" : undefined;

  const hasChart = showChart || withFines;
  const chart = chartReady ? (
    <HeroChart
      // Remounted when the metric it opens on changes, so the graph follows
      // the view (HeroChart keeps its own choice after that).
      key={defaultMetric ?? "collected"}
      metrics={metrics}
      defaultMetric={defaultMetric && metrics.some((m) => m.key === defaultMetric) ? defaultMetric : undefined}
      anchor="finances-chart"
      note={chartNote}
      today={todayDate}
    />
  ) : (
    <ChartPlaceholder
      failed={chartFailed}
      onRetry={failed ? onRetry : (onFinesRetry ?? onRetry)}
      label={opensOnFines ? "Fines issued" : "Collected"}
    />
  );
  const card = ready ? (
    <OwedCard stats={stats!} ageing={buckets} currency={currency} showUpcoming={showUpcoming} />
  ) : (
    <CardPlaceholder failed={failed} />
  );

  return (
    <div data-finances-overview="">
      {/* A viewer without the Received grant has no graph to see; the owed
          card then takes the row, rather than leaving a hole. */}
      <HeroRow chart={hasChart ? chart : card} card={hasChart && showCard ? card : undefined} />
    </div>
  );
}
