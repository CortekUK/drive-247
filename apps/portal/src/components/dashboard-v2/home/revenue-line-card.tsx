'use client';

/**
 * Revenue, drawn as a RUNNING TOTAL — the wide card on the left of "On your
 * desk", beside the feature card.
 *
 * Rental money arrives in lumps (a weekly charge, a deposit, a long booking
 * paid up front), so a per-day line is mostly flat with the odd spike. A running
 * total climbs instead: big days read as steep steps, and the last point on the
 * line IS the headline figure.
 *
 * On top of that line:
 *  - the previous range as a faint dashed ghost, so "ahead of last time" is a
 *    shape rather than a percentage;
 *  - on the daily ranges, a dotted forecast from today: charges already on the
 *    ledger falling due in the next 7 days;
 *  - a small hover card beside the pointer (TrendCard): collected so far,
 *    that day's takings, and the trend against the range before — which
 *    replaced both the headline scrubbing and the "↑ n%" pill (Sep 29 2026);
 *  - no y-axis and no grid — only the latest point is labelled, with a pulse.
 *
 * Sep 26 2026: the range tabs, the Payments link, the stats row and the legend
 * came off at Ghulam's request. The card is the headline and the line.
 *
 * No card around it (Sep 26 2026): it sits straight on the page wash, flush
 * with the band title, so the line reads as part of the page rather than a box.
 *
 * Colour comes from `currentColor` set to the v2 accent on the wrapper, so it
 * follows the tokens in light and dark without a hex in the SVG.
 *
 * Data: `useDashboardRevenueSeries`, tenant-scoped in the hook. Nothing here
 * queries or writes on its own.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTenant } from '@/contexts/TenantContext';
import {
  useDashboardRevenueSeries,
  type RevenuePoint,
  type RevenueRange,
  type RevenueSeries,
} from '@/hooks/use-dashboard-revenue-series';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { Info, MoreVertical } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CarMascot } from './car-mascot';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { skeletonFaker } from '@/lib/skeleton-data';

/**
 * Placeholder 30-day series for the skeleton: a climbing running total with a
 * ghost line, so the headline and chart have their loaded shape. Never seen.
 */
const SKELETON_SERIES: RevenueSeries = (() => {
  const f = skeletonFaker(0);
  let total = 0;
  const points: RevenuePoint[] = Array.from({ length: 30 }, (_, i) => {
    total += f.money(50, 600);
    return { date: f.date(29 - i).slice(0, 10), total, previous: total * 0.85 };
  });
  return {
    points,
    bucket: 'day',
    total,
    previousTotal: total * 0.85,
    paymentCount: 30,
    averagePerDay: total / 30,
    bestDay: null,
    scheduled: 0,
  };
})();

const RANGE_WORDS: Record<RevenueRange, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '12m': 'last 12 months',
};

/**
 * Counts up to `target` over `ms`, once per change of target. Jumps straight
 * there under prefers-reduced-motion.
 */
function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(origin + (target - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

const VIEW_KEY = 'dashboard-v2:revenue-view';


/**
 * The (i) beside the title: hover (or focus) to read how the chart is made.
 * Not a "?" and no help cursor — just a quiet info mark that opens a small
 * explainer card below it.
 */
function HowItWorks({ rangeWords, bucket }: { rangeWords: string; bucket: RevenueSeries['bucket'] }) {
  const step = bucket === 'month' ? 'month' : bucket === 'week' ? 'week' : 'day';
  return (
    <HoverCard openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="How this chart works"
          className="flex size-4 cursor-default items-center justify-center rounded-full text-[var(--pv-ink-3)] transition-colors hover:text-[var(--pv-accent-ink)] focus-visible:text-[var(--pv-accent-ink)] focus-visible:outline-none"
        >
          <Info className="size-3.5" strokeWidth={2.25} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" sideOffset={8} className="pv w-[320px] rounded-xl border-[var(--pv-line)] p-4 shadow-none">
        <p className="text-[13px] font-semibold text-[var(--pv-ink)]">How this chart works</p>
        <ul className="mt-2.5 space-y-2.5 text-[12px] leading-relaxed text-[var(--pv-ink-2)]">
          <li>
            <span className="font-semibold text-[var(--pv-ink)]">The big number</span> is money actually collected in the {rangeWords}.
          </li>
          <li>
            <span className="font-semibold text-[var(--pv-ink)]">What counts:</span> payments whose money has arrived: applied,
            completed, partial and credit payments. Pending, reversed and refunded payments are left out, and a partial refund
            is taken off the {step} it happened.
          </li>
          <li>
            <span className="font-semibold text-[var(--pv-ink)]">The solid line</span> is a running total: each {step} adds what came in
            that {step}, so it climbs to the big number. A steep step is a big {step}.
          </li>
          <li>
            <span className="font-semibold text-[var(--pv-ink)]">The dashed line</span> is the period before, drawn the same way, so you can
            see at a glance whether you are ahead or behind at any point.
          </li>
          {bucket === 'day' && (
            <li>
              <span className="font-semibold text-[var(--pv-ink)]">The dotted line</span> after today is money expected in the next 7 days:
              charges already on the ledger that fall due.
            </li>
          )}
          <li>Hover anywhere on the chart for the figures at that point. Change the period from the ⋮ menu.</li>
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The ⋯ menu at the chart's top right: the range, and what the chart draws. */
function ChartMenu({
  range,
  onRange,
  showPrevious,
  onShowPrevious,
  showForecast,
  onShowForecast,
}: {
  range: RevenueRange;
  onRange: (r: RevenueRange) => void;
  showPrevious: boolean;
  onShowPrevious: (v: boolean) => void;
  showForecast: boolean;
  onShowForecast: (v: boolean) => void;
}) {
  const daily = range === '7d' || range === '30d';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Chart options"
          className="-mr-1.5 flex size-7 translate-y-[6px] items-center justify-center rounded-lg text-[var(--pv-ink-3)] transition-colors hover:text-[var(--pv-accent-ink)] data-[state=open]:text-[var(--pv-accent-ink)]"
        >
          <MoreVertical className="size-4" strokeWidth={2.25} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="pv w-60 rounded-xl border-[var(--pv-line)] p-1.5 shadow-none">
        {/* Filters only (Sep 29 2026): the period, and what the line shows. */}
        <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--pv-ink-3)]">
          Period
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={range} onValueChange={(v) => onRange(v as RevenueRange)}>
          {(Object.keys(RANGE_WORDS) as RevenueRange[]).map((r) => (
            <DropdownMenuRadioItem key={r} value={r} className="rounded-lg text-[13px]">
              {RANGE_WORDS[r].replace(/^last/, 'Last')}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="my-1.5 bg-[var(--pv-line)]" />
        <DropdownMenuLabel className="px-2 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--pv-ink-3)]">
          Show on the chart
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={showPrevious} onCheckedChange={(v) => onShowPrevious(!!v)} className="rounded-lg text-[13px]">
          The period before
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showForecast && daily}
          disabled={!daily}
          onCheckedChange={(v) => onShowForecast(!!v)}
          className="rounded-lg text-[13px]"
        >
          Money expected next 7 days
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The hover card (Sep 29 2026, in place of the "↑ 155%" pill): at the point
 * under the pointer — collected so far, what came in that day, and how that
 * compares with the range before at the same point. On the dotted forecast
 * part, what is expected by then. Flat and small: a hairline border, no
 * shadow, the page's own tokens.
 */
function TrendCard({
  point,
  before,
  label,
  money,
  bucket,
}: {
  point: RevenuePoint;
  before?: RevenuePoint;
  label: string;
  money: (n: number) => string;
  bucket: RevenueSeries['bucket'];
}) {
  const unit = bucket === 'month' ? 'month' : bucket === 'week' ? 'week' : 'day';
  const Shell = ({ children }: { children: ReactNode }) => (
    <div className="min-w-[190px] rounded-xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-3.5 py-3 text-[12px] animate-in fade-in-0 zoom-in-95 duration-150">
      <p className="text-[11px] font-medium text-[var(--pv-ink-3)]">{label}</p>
      {children}
    </div>
  );

  if (point.total === undefined && point.forecast !== undefined) {
    return (
      <Shell>
        <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--pv-ink)]">{money(point.forecast)}</p>
        <p className="text-[11.5px] text-[var(--pv-ink-3)]">expected by then</p>
        <p className="mt-2 border-t border-[var(--pv-line)] pt-2 text-[11.5px] text-[var(--pv-ink-2)]">Charges already on the ledger, falling due.</p>
      </Shell>
    );
  }
  if (point.total === undefined) return null;

  const came = before?.total !== undefined ? point.total - before.total : point.total;
  const prev = point.previous;
  const vs = prev !== undefined && prev > 0 ? Math.round(((point.total - prev) / prev) * 100) : null;
  const periodWord = bucket === 'month' ? 'last year' : 'last month';

  return (
    <Shell>
      <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--pv-ink)]">{money(point.total)}</p>
      <p className="text-[11.5px] text-[var(--pv-ink-3)]">collected so far</p>
      <div className="mt-2 space-y-1 border-t border-[var(--pv-line)] pt-2 text-[11.5px]">
        <p className="flex items-center justify-between gap-4 text-[var(--pv-ink-2)]">
          <span>That {unit}</span>
          <span className="font-semibold tabular-nums text-[var(--pv-ink)]">{came > 0 ? `+${money(came)}` : `Quiet ${unit}`}</span>
        </p>
        {vs !== null && (
          <p className="flex items-center justify-between gap-4 text-[var(--pv-ink-2)]">
            <span>Against {periodWord}</span>
            <span className={cn('font-semibold tabular-nums', vs >= 0 ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-late)]')}>
              {vs >= 0 ? '↑' : '↓'} {Math.abs(vs)}% {vs >= 0 ? 'ahead' : 'behind'}
            </span>
          </p>
        )}
      </div>
    </Shell>
  );
}

export function RevenueLineCard({ className }: { className?: string }) {
  const { tenant } = useTenant();
  // The range and what the chart draws, chosen from the ⋯ menu (Sep 29 2026)
  // and remembered in this browser — a convenience, never required.
  const [range, setRangeRaw] = useState<RevenueRange>('30d');
  const [showPrevious, setShowPreviousRaw] = useState(true);
  const [showForecast, setShowForecastRaw] = useState(true);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      if (saved.range && saved.range in RANGE_WORDS) setRangeRaw(saved.range);
      if (typeof saved.showPrevious === 'boolean') setShowPreviousRaw(saved.showPrevious);
      if (typeof saved.showForecast === 'boolean') setShowForecastRaw(saved.showForecast);
    } catch {
      /* storage unavailable — defaults */
    }
  }, []);
  const persist = (patch: Record<string, unknown>) => {
    try {
      const cur = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
      localStorage.setItem(VIEW_KEY, JSON.stringify({ ...cur, ...patch }));
    } catch {
      /* ignore */
    }
  };
  const setRange = (r: RevenueRange) => {
    setRangeRaw(r);
    persist({ range: r });
  };
  const setShowPrevious = (v: boolean) => {
    setShowPreviousRaw(v);
    persist({ showPrevious: v });
  };
  const setShowForecast = (v: boolean) => {
    setShowForecastRaw(v);
    persist({ showForecast: v });
  };
  const [hover, setHover] = useState<RevenuePoint | null>(null);
  const { data: loadedData, isLoading: seriesLoading, isError } = useDashboardRevenueSeries(range);
  const isLoading = useSkeletonLoading(seriesLoading);
  const data = isLoading ? SKELETON_SERIES : loadedData;
  const uid = useId().replace(/:/g, '');

  const currency = tenant?.currency_code || 'USD';
  const money = (n: number) =>
    formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Held at 0 while the placeholder shows, so the real figure counts up from
  // zero on reveal rather than from the placeholder's total.
  const counted = useCountUp(isLoading ? 0 : data?.total ?? 0);

  const empty = !!data && data.total === 0 && data.scheduled === 0;
  // Index of today — the last point with a real total, before the forecast days.
  let lastActual = -1;
  data?.points.forEach((p, i) => {
    if (p.total !== undefined) lastActual = i;
  });

  // Everything the other chart styles draw, derived from the one series:
  // what came in at each point, a 7-point average of that, and the gap to
  // the period before (split into above/below so each gets its own colour).
  const chartPoints = (data?.points ?? []).map((p, i, arr) => {
    const prevTotal = i > 0 ? arr[i - 1].total ?? 0 : 0;
    const daily = p.total !== undefined ? Math.max(0, p.total - prevTotal) : undefined;
    const gap = p.total !== undefined && p.previous !== undefined ? p.total - p.previous : undefined;
    return { ...p, daily, gap, gapUp: gap !== undefined && gap >= 0 ? gap : undefined, gapDown: gap !== undefined && gap < 0 ? gap : undefined };
  });
  chartPoints.forEach((p, i) => {
    const window = chartPoints.slice(Math.max(0, i - 6), i + 1).map((x) => x.daily).filter((x): x is number => x !== undefined);
    (p as { avg?: number }).avg = p.daily !== undefined && window.length ? window.reduce((a, b) => a + b, 0) / window.length : undefined;
  });

  const pointLabel = (d: string) => {
    const date = parseISO(d);
    if (data?.bucket === 'month') return format(date, 'MMM yyyy');
    if (data?.bucket === 'week') return `week of ${format(date, 'd MMM')}`;
    return format(date, 'EEE d MMM');
  };

  // The headline is always the range total (Sep 29 2026): the hover card
  // beside the pointer carries the point-by-point story instead.
  const headline = money(isLoading ? data?.total ?? 0 : counted);
  const caption = RANGE_WORDS[range];

  return (
    /* A grid of one stretched cell: AutoSkeleton wraps its content in a plain
       block, and a stretched grid item gives it the card's full height so the
       chart's flex-1 still has something to fill. */
    <div
      className={cn(
        'grid h-[240px] min-w-0 grid-rows-[minmax(0,1fr)]',
        className
      )}
    >
      <AutoSkeleton loading={isLoading} className="flex h-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 pt-1" data-skeleton-keep>
        {/* No "Revenue" title (Sep 29 2026): the figure says what it is. The
            header keeps only the ⋮ menu, at the right. */}
        <span aria-hidden="true" />
        <ChartMenu
          range={range}
          onRange={setRange}
          showPrevious={showPrevious}
          onShowPrevious={setShowPrevious}
          showForecast={showForecast}
          onShowForecast={setShowForecast}
        />
      </header>

      <div className="pt-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[32px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--pv-ink)]">
            {data ? headline : '—'}
          </span>
        </div>
        {/* The period, on its own line under the total, with the (i) beside it. */}
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--pv-ink-3)]">
          {caption}
          <HowItWorks rangeWords={RANGE_WORDS[range]} bucket={data?.bucket ?? 'day'} />
        </p>
      </div>

      <div
        className={cn(
          'relative min-h-0 flex-1 pt-1 text-[var(--pv-accent-ink)]',
          // A soft glow under the main line only — depth without a card shadow.
          '[&_.dash-rev-main_.recharts-area-curve]:[filter:drop-shadow(0_6px_10px_hsl(var(--primary)/0.35))]'
        )}
        onMouseLeave={() => setHover(null)}
      >
        {isError && (
          <p className="flex h-full items-center justify-center text-[13px] text-[var(--pv-ink-3)]">
            I couldn’t load your revenue just now.
          </p>
        )}

        {data && (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartPoints}
                margin={{ top: 14, right: 8, bottom: 0, left: 0 }}
                onMouseMove={(s) => {
                  const i = s?.activeTooltipIndex;
                  setHover(typeof i === 'number' && data.points[i] ? data.points[i] : null);
                }}
                onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="currentColor" stopOpacity={0.28} />
                    <stop offset="70%" stopColor="currentColor" stopOpacity={0.06} />
                    <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id={`${uid}-up`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--pv-clear)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--pv-clear)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id={`${uid}-down`} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="var(--pv-late)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--pv-late)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickMargin={6}
                  tick={{ fontSize: 10.5, fill: 'var(--pv-ink-3)' }}
                  tickFormatter={(d: string) =>
                    format(parseISO(d), data.bucket === 'month' ? 'MMM' : 'd MMM')
                  }
                />
                <YAxis
                  hide
                  domain={[0, (max: number) => Math.max(1, max * 1.08)]}
                />
                {/* The pointer line, and a small card beside it with the trend
                    at that point (TrendCard). */}
                <Tooltip
                  cursor={{ stroke: 'var(--pv-ink-3)', strokeWidth: 1, strokeDasharray: '2 3' }}
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as RevenuePoint | undefined) : undefined;
                    if (!point || isLoading) return null;
                    if (point.total === undefined && !showForecast) return null;
                    const i = data.points.findIndex((x) => x.date === point.date);
                    const before = i > 0 ? data.points[i - 1] : undefined;
                    return (
                      <TrendCard
                        point={showPrevious ? point : { ...point, previous: undefined }}
                        before={before}
                        label={pointLabel(point.date)}
                        money={money}
                        bucket={data.bucket}
                      />
                    );
                  }}
                  wrapperStyle={{ outline: 'none', zIndex: 20 }}
                  offset={14}
                  isAnimationActive={false}
                />
                {showPrevious && <Line
                  dataKey="previous"
                  type="monotone"
                  stroke="var(--pv-ink-3)"
                  strokeOpacity={0.45}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  connectNulls
                  isAnimationActive={false}
                />}
                {showForecast && <Line
                  dataKey="forecast"
                  type="monotone"
                  stroke="currentColor"
                  strokeOpacity={0.7}
                  strokeWidth={2}
                  strokeDasharray="1 5"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--pv-paper)', fill: 'currentColor' }}
                  isAnimationActive={false}
                />}
                {<Area
                  className="dash-rev-main"
                  dataKey="total"
                  type="monotone"
                  stroke="currentColor"
                  strokeWidth={2.25}
                  fill={`url(#${uid}-fill)`}
                  activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--pv-paper)', fill: 'currentColor' }}
                  dot={(p: { cx?: number; cy?: number; index?: number; key?: string }) => {
                    if (p.index !== lastActual || p.cx == null || p.cy == null) {
                      return <g key={p.key} />;
                    }
                    // Today: a pulse, and the only label on the chart.
                    return (
                      <g key={p.key}>
                        <circle
                          cx={p.cx}
                          cy={p.cy}
                          r={7}
                          fill="currentColor"
                          fillOpacity={0.25}
                          className="motion-safe:animate-ping [transform-box:fill-box] [transform-origin:center]"
                        />
                        <circle cx={p.cx} cy={p.cy} r={4} fill="currentColor" stroke="var(--pv-paper)" strokeWidth={2} />
                        {!hover && (
                          <text
                            x={p.cx - 10}
                            y={p.cy - 12}
                            textAnchor="end"
                            fontSize={11}
                            fontWeight={600}
                            fill="var(--pv-ink-2)"
                            className="tabular-nums"
                          >
                            {money(data.total)}
                          </text>
                        )}
                      </g>
                    );
                  }}
                  animationDuration={800}
                  animationEasing="ease-out"
                />}
              </ComposedChart>
            </ResponsiveContainer>

            {empty && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
                <CarMascot mood="waiting" className="w-[104px]" />
                <p className="text-[13px] text-[var(--pv-ink-3)]">
                  No payments collected in the {RANGE_WORDS[range]}.
                </p>
              </div>
            )}
          </>
        )}
      </div>
      </AutoSkeleton>
    </div>
  );
}
