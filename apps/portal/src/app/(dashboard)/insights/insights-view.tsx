'use client';

/**
 * Insights — the screen.
 *
 * A receipt, with a "what if" calculator beside it, in descending order of how
 * often an operator needs them. There is deliberately nothing else on it.
 * /reports and /pl-dashboard between them offer dozens of controls and still
 * cannot answer "am I making money", which is the only question most operators
 * open them to ask.
 *
 * The receipt is the page. Every figure on it opens the rows it was summed
 * from, so "where did that number come from" is a click and never an email.
 * The period selector lives on the receipt for the same reason — it is what the
 * operator is looking at when they think to change it — and still governs the
 * calculator, because they all read one query.
 *
 * This is a Client Component because it holds the period state and the query.
 * The gate lives one file up in `page.tsx`, on the server — see the docblock
 * there and V2_PLAN.md §3.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { useInsights, type InsightsData, type PeriodMonths } from './_data';
import { usePageSearch } from '@/components/shared/layout/page-search-slot';
import { OverviewFlip } from '@/components/shared/layout/overview-flip';
import { DEFAULT_MONTHS, InsightsFilterPanel, SearchResults, useInsightsSearch } from './_search';
import { ViewSwitch, useInsightsView } from './_view-switch';
import { AnalyticsGallery } from './_analytics-gallery';
import { PnlTable } from './_pnl-table';
import { ReportsView } from './_reports';
import { TraxSummaryView } from './_trax-summary';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { skeletonRows } from '@/lib/skeleton-data';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { MoneyReceipt } from './_receipt';
import { ProfitCalculator } from './_calculator';

/**
 * Placeholder figures for the skeleton. The receipt and calculator render these
 * through their real layouts, so the bones have the loaded page's shape; the
 * values are never seen.
 */
const SKELETON_INSIGHTS: InsightsData = {
  totals: { operatingRevenue: 48210, operatingCost: 19340, netProfit: 28870, fleetInvestment: 0, passThrough: 3120 },
  receipt: { tookIn: 52480, gaveBack: 1150, neverYours: 3120, spent: 19340, kept: 28870, carPurchases: 0 },
  margin: 59,
  utilisation: 72,
  fleetSize: 12,
  monthly: skeletonRows(12, (f, i) => {
    const revenue = f.money(2000, 6000);
    const cost = f.money(800, 2000);
    return { key: `m${i}`, label: 'Xxx', revenue, cost, profit: revenue - cost };
  }),
  vehicleProfits: [],
  bestVehicles: skeletonRows(5, (f) => ({ vehicleId: f.id, label: f.text(2, 3), profit: f.money(500, 5000) })),
  worstVehicles: skeletonRows(5, (f) => ({ vehicleId: f.id, label: f.text(2, 3), profit: f.money(-800, 400) })),
  mix: skeletonRows(4, (f) => ({ category: f.text(1, 2), amount: f.money(2000, 20000), share: 0.25 })),
  aging: { bucket_0_30: 1840, bucket_31_60: 620, bucket_61_90: 310, bucket_90_plus: 150, total: 2920 },
  ledger: [],
  refunds: [],
  receivables: [],
  rentals: [],
  paymentsIn: [],
  customerNames: new Map(),
  vehicleLabels: new Map(),
  adjustedCount: 0,
  rules: new Map(),
  categories: [],
  truncated: false,
  hasLedger: true,
};

export function InsightsView() {
  // 12 months by default: a rental business is seasonal, and three months of a
  // seasonal business is a mood rather than a trend.
  const [months, setMonths] = useState<PeriodMonths>(DEFAULT_MONTHS);
  const [view, setView] = useInsightsView();
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { tenant } = useTenant();
  // Never a hardcoded '$'. Three components under /reports do exactly that, and
  // they are wrong for every tenant not billing in dollars.
  const currency = tenant?.currency_code || 'USD';

  const { data: loadedData, isLoading: insightsLoading, isError, error } = useInsights(months);
  // While the figures load, placeholder figures render through the real
  // receipt and calculator (told they are loaded, so they draw their real shapes)
  // and <AutoSkeleton> lays the bones over them.
  const isLoading = useSkeletonLoading(insightsLoading);
  const data = isLoading ? SKELETON_INSIGHTS : loadedData;

  // The top bar's field and filter button, lent by this page while it is open.
  const hits = useInsightsSearch(loadedData, search);
  const searching = search.trim() !== '';
  usePageSearch({
    placeholder: 'Search entries, cars, customers, amounts…',
    scopeLabel: 'Insights',
    value: search,
    onChange: setSearch,
    resultCount: loadedData ? hits.length : undefined,
    filters: {
      open: filtersOpen,
      onOpenChange: setFiltersOpen,
      activeCount: months === DEFAULT_MONTHS ? 0 : 1,
    },
  });

  return (
    /* Switch row alignment: at md+ the h1 (text-3xl leading-tight, a 37.5px
       line box) is centred on the sidebar's Portal / Website switch at y=92.
       main's content box starts at 50px there: 50 + 23.25 + 18.75 = 92. It sat
       at 50, under the 64px top bar. Below md there is still no top padding. */
    /* md+: exactly one screen tall, no page scroll. 100svh − 66px is the
       portal's full-height page (main's bounds; see (dashboard)/layout.tsx).
       Below md the page scrolls as usual — a phone cannot hold it all. */
    <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-6 px-2 pb-8 md:h-[calc(100svh-66px)] md:overflow-hidden md:pt-[23.25px] md:pb-4 [@media(max-height:860px)]:gap-4">
      {/*
        One row: the title on the left, the four views on the same line to its
        right (lg+). The title block gives way — its line wraps — so the views
        never drop below it. The period is not here: it is a filter, and like
        every v2 page's filters it lives behind the top bar's search field
        (see `_search.tsx`).
      */}
      <div className="shrink-0">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="min-w-0 lg:flex-1">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Insights</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            What the business earned, what it cost to run, and what is still owed.
          </p>
        </div>
        <div className="shrink-0">
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </header>

      {/*
        Filters come in with the app's own card flip — the same component,
        timing and Escape-to-close as Vehicles, Rentals and Customers. The
        flip's front is empty (Insights has no overview card to turn over),
        so the panel turns into place under the header and turns away again,
        taking no space while it is shut.
      */}
      <div className={cn('transition-[margin] duration-200 ease-out motion-reduce:transition-none', filtersOpen ? 'mt-6' : 'mt-0')}>
        <OverviewFlip
          flipped={filtersOpen}
          onFlipBack={() => setFiltersOpen(false)}
          front={<div aria-hidden className="h-px" />}
          back={<InsightsFilterPanel months={months} onMonthsChange={setMonths} onClose={() => setFiltersOpen(false)} />}
        />
      </div>
      </div>

      {/*
        A failed read is stated, not swallowed. A page of zeroes is
        indistinguishable from a tenant with no business, and the two must never
        look the same on a screen about money.
      */}
      {isError ? (
        <div className="flex items-start gap-3 rounded-3xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">These figures could not be loaded.</p>
            <p className="text-destructive/80">
              {error instanceof Error ? error.message : 'Please refresh and try again.'}
            </p>
          </div>
        </div>
      ) : null}

      {/* Only shown if a read genuinely hit the row ceiling — see `MAX_ROWS`. */}
      {data?.truncated ? (
        <div className="flex items-start gap-3 rounded-3xl bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-muted-foreground">
            This period holds more records than this screen loads at once, so the figures below
            cover part of it. Choose a shorter period for an exact answer.
          </p>
        </div>
      ) : null}


      <AutoSkeleton loading={isLoading} outerClassName="md:min-h-0 md:flex-1" className="md:h-full">
        {searching ? (
          <div className="md:h-full md:overflow-y-auto">
            <SearchResults hits={hits} term={search} currency={currency} />
          </div>
        ) : view === 'numbers' ? (
          /* The receipt says what happened; the calculator beside it lets the
             operator push the same numbers around. The calculator is keyed on
             the period and the loading flag so it re-seeds from real figures
             once they land and never keeps the skeleton's placeholders.

             The page itself never scrolls at md+. Side by side (xl), each
             column may scroll on its own only as a last resort on a very short
             window; stacked (md–xl), the pair scrolls inside the frame. */
          <div className="grid items-start gap-8 md:h-full md:overflow-y-auto xl:grid-cols-[minmax(0,1fr)_420px] xl:items-stretch xl:gap-12 xl:overflow-visible [&>*]:xl:h-full [&>*]:xl:overflow-y-auto">
            <MoneyReceipt data={data} loading={false} currency={currency} />
            <ProfitCalculator
              key={`${months}-${isLoading ? 'skeleton' : 'loaded'}`}
              data={data}
              months={months}
              currency={currency}
            />
          </div>
        ) : view === 'pnl' ? (
          /* One table, one row per car — scrolls inside its own frame. */
          <div className="md:h-full">
            <PnlTable data={loadedData} months={months} currency={currency} />
          </div>
        ) : view === 'analytics' ? (
          <div className="md:h-full md:overflow-y-auto xl:overflow-visible">
            <AnalyticsGallery data={data} months={months} currency={currency} />
          </div>
        ) : view === 'reports' ? (
          <div className="md:h-full md:overflow-y-auto">
            <ReportsView data={loadedData} months={months} currency={currency} />
          </div>
        ) : (
          /* The real figures only — never the skeleton's placeholders, which
             would otherwise be sent to Trax as if they were the business. */
          <div className="md:h-full md:overflow-y-auto xl:overflow-visible">
            <TraxSummaryView data={loadedData} months={months} currency={currency} />
          </div>
        )}
      </AutoSkeleton>
    </div>
  );
}
