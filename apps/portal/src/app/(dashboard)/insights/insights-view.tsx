'use client';

/**
 * Insights — the screen.
 *
 * One period selector and six things to read: four numbers, then four charts in
 * descending order of how often an operator needs them. There is deliberately
 * nothing else on it. /reports and /pl-dashboard between them offer dozens of
 * controls and still cannot answer "am I making money", which is the only
 * question most operators open them to ask.
 *
 * This is a Client Component because it holds the period state and the query.
 * The gate lives one file up in `page.tsx`, on the server — see the docblock
 * there and V2_PLAN.md §3.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui-v2/select';
import { PERIOD_OPTIONS, useInsights, type PeriodMonths } from './_data';
import { KpiRow } from './_kpis';
import { MoneyOwedByAge, ProfitByVehicle, RevenueMix, RevenueVsCosts } from './_charts';

export function InsightsView() {
  // 12 months by default: a rental business is seasonal, and three months of a
  // seasonal business is a mood rather than a trend.
  const [months, setMonths] = useState<PeriodMonths>(12);

  const { tenant } = useTenant();
  // Never a hardcoded '$'. Three components under /reports do exactly that, and
  // they are wrong for every tenant not billing in dollars.
  const currency = tenant?.currency_code || 'USD';

  const { data, isLoading, isError, error } = useInsights(months);

  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-8 px-2 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Insights</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            What the business earned, what it cost to run, and what is still owed.
          </p>
        </div>

        <Select
          value={String(months)}
          onValueChange={(v) => setMonths(Number(v) as PeriodMonths)}
        >
          <SelectTrigger className="w-[170px]" aria-label="Reporting period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

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

      <KpiRow data={data} loading={isLoading} currency={currency} />

      <RevenueVsCosts data={data} loading={isLoading} currency={currency} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ProfitByVehicle data={data} loading={isLoading} currency={currency} />
        <RevenueMix data={data} loading={isLoading} currency={currency} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MoneyOwedByAge data={data} loading={isLoading} currency={currency} />

        {/*
          The method note, on the page rather than in a tooltip.

          Every figure above deliberately differs from what /reports and
          /pl-dashboard show for the same tenant, and an operator who notices
          that deserves to be told why on the spot rather than emailing to ask
          whether one of the two screens is broken.
        */}
        <div className="rounded-4xl bg-muted/40 p-6 text-sm text-muted-foreground ring-1 ring-foreground/5">
          <h2 className="font-heading text-base font-medium text-foreground">
            How these numbers are worked out
          </h2>
          <ul className="mt-3 space-y-2.5">
            <li>
              <span className="font-medium text-foreground">Operating revenue</span> is what you
              earned. Sales tax and refundable security deposits are taken out — that money is
              collected on someone else&apos;s behalf and was never yours.
            </li>
            <li>
              <span className="font-medium text-foreground">Net profit</span> is operating revenue
              minus what it cost to run the operation: servicing, expenses, and the rest of the
              day-to-day.
            </li>
            <li>
              <span className="font-medium text-foreground">Buying and selling vehicles is not in
              profit.</span>{' '}
              It is capital — you swapped cash for a car you still own. Counting it as a cost makes
              a good month spent growing the fleet look like a disaster.
            </li>
            <li>
              <span className="font-medium text-foreground">Fleet utilisation</span> is the share of
              available vehicle-days that were actually rented. Pending and cancelled bookings do
              not count; the car never left.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
