'use client';

/**
 * Insights — the KPI row.
 *
 * Four numbers, and a fifth sitting under them that is deliberately NOT one of
 * the four: fleet investment. Capital spend has to be visible — an operator who
 * bought three cars this quarter needs to see that — but it is reported beside
 * profit rather than inside it. See `_money-model.ts` for why that distinction
 * is the whole point of this screen.
 */

import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import type { InsightsData } from './_data';

/** A percentage, or an em dash when the figure genuinely cannot be computed. */
function pct(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}

function Tile({
  label,
  value,
  hint,
  loading,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  return (
    <Card size="sm" className="h-full">
      <CardContent className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-9 w-28" />
        ) : (
          <p
            className={cn(
              'font-heading text-3xl font-semibold tracking-tight tabular-nums',
              tone === 'positive' && 'text-success',
              tone === 'negative' && 'text-destructive',
            )}
          >
            {value}
          </p>
        )}
        {/*
          The hint slot is always rendered, even when empty, so the four tiles
          keep the same height and the row does not shuffle as data lands.
        */}
        <p className="min-h-[1.25rem] text-xs text-muted-foreground">{loading ? '' : (hint ?? '')}</p>
      </CardContent>
    </Card>
  );
}

export function KpiRow({
  data,
  loading,
  currency,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
}) {
  const money = (n: number) => formatCurrency(n, currency, { maximumFractionDigits: 0 });

  const netProfit = data?.totals.netProfit ?? 0;
  const margin = data?.margin ?? null;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Operating revenue"
          value={money(data?.totals.operatingRevenue ?? 0)}
          hint={
            data && data.totals.passThrough > 0
              ? `${money(data.totals.passThrough)} tax & deposits excluded`
              : 'Excludes tax and deposits'
          }
          loading={loading}
        />

        <Tile
          label="Net profit"
          value={money(netProfit)}
          // The margin is the second half of this number's meaning: $40k of
          // profit on $50k of revenue and on $2M of revenue are different
          // businesses, and only one of them is worth celebrating.
          hint={margin == null ? 'No revenue in this period' : `${pct(margin)} margin`}
          loading={loading}
          tone={!data || netProfit === 0 ? 'neutral' : netProfit > 0 ? 'positive' : 'negative'}
        />

        <Tile
          label="Fleet utilisation"
          value={pct(data?.utilisation ?? null)}
          hint={
            data == null
              ? undefined
              : data.fleetSize === 0
                ? 'No vehicles on the fleet yet'
                : `${data.fleetSize} vehicle${data.fleetSize === 1 ? '' : 's'} in the fleet`
          }
          loading={loading}
        />

        <Tile
          label="Money owed"
          value={money(data?.aging.total ?? 0)}
          hint={
            data && data.aging.bucket_90_plus > 0
              ? `${money(data.aging.bucket_90_plus)} over 90 days`
              : 'Outstanding across all invoices'
          }
          loading={loading}
        />
      </div>

      {/*
        Fleet investment, stated plainly and OUTSIDE the four tiles.

        Only shown when there is any: a tenant who has not booked a vehicle
        purchase does not need a row telling them it was zero. When it is there
        it carries its own sentence, because the single most common way to
        misread this page would be to assume profit already accounts for it.
      */}
      {!loading && data && data.totals.fleetInvestment > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-3xl bg-muted/40 px-4 py-2.5 text-sm">
          {data.totals.netProfit >= 0 ? (
            <TrendingUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <TrendingDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium tabular-nums">{money(data.totals.fleetInvestment)}</span>
          <span className="text-muted-foreground">
            spent buying and selling vehicles in this period — capital, so it is not counted
            against profit above.
          </span>
        </div>
      ) : null}
    </div>
  );
}
