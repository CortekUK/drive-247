'use client';

/**
 * Insights — the "what if" calculator.
 *
 * Not a keypad. It answers the questions an operator actually does on the back
 * of an envelope — "what if I added two cars", "what if I charged $10 more a
 * day", "how many days does a car have to be out just to pay for itself" — and
 * it starts from THEIR numbers, worked out from the same query as the receipt,
 * so the first thing it shows is today, not a blank form.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 *
 *     kept / month = cars × rented days × price × (1 − refund rate)
 *                  − cars × running cost per car
 *
 * Every input is derived so that, untouched, the model lands exactly on the
 * receipt's "Money you kept" divided into months:
 *
 *     price          = operating revenue ÷ rented days in the period
 *     rented days    = utilisation × fleet × period days
 *     refund rate    = gave back ÷ operating revenue
 *     cost per car   = spent ÷ fleet ÷ months in the period
 *
 * ⇒ baseline = (operating revenue − gave back − spent) ÷ months ≡ kept ÷ months.
 * Tax and deposits are left out on purpose — they were never the operator's,
 * on the receipt or here.
 */

import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui-v2/slider';
import { Input } from '@/components/ui-v2/input';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { periodRange, type InsightsData, type PeriodMonths } from './_data';

/** Average days in a month. A 30-day month undercounts a year by five days. */
const DAYS_PER_MONTH = 365.25 / 12;

const MINUS = '−';

type Inputs = {
  cars: number;
  days: number;
  price: number;
  cost: number;
};

/** The operator's own numbers, as one month. */
function baselineFrom(data: InsightsData | undefined, months: PeriodMonths) {
  const periodDays = periodRange(months).days;
  const periodMonths = periodDays / DAYS_PER_MONTH;
  const fleet = data?.fleetSize ?? 0;
  const utilisation = (data?.utilisation ?? 0) / 100;
  const revenue = data?.totals.operatingRevenue ?? 0;
  const spent = data?.receipt.spent ?? 0;
  const gaveBack = data?.receipt.gaveBack ?? 0;

  const rentedDays = utilisation * fleet * periodDays;

  const inputs: Inputs = {
    cars: fleet,
    days: utilisation * DAYS_PER_MONTH,
    price: rentedDays > 0 ? revenue / rentedDays : 0,
    cost: fleet > 0 && periodMonths > 0 ? spent / fleet / periodMonths : 0,
  };

  return {
    inputs,
    refundRate: revenue > 0 ? Math.min(1, gaveBack / revenue) : 0,
  };
}

function keptPerMonth({ cars, days, price, cost }: Inputs, refundRate: number) {
  return cars * days * price * (1 - refundRate) - cars * cost;
}

export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency })
        .formatToParts(0)
        .find((p) => p.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

export function ProfitCalculator({
  data,
  months,
  currency,
}: {
  data: InsightsData | undefined;
  months: PeriodMonths;
  currency: string;
}) {
  const baseline = useMemo(() => baselineFrom(data, months), [data, months]);
  const [inputs, setInputs] = useState<Inputs>(baseline.inputs);

  const money = (amount: number) =>
    formatCurrency(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const signed = (amount: number) => (amount < 0 ? `${MINUS} ${money(-amount)}` : money(amount));

  const now = keptPerMonth(baseline.inputs, baseline.refundRate);
  const projected = keptPerMonth(inputs, baseline.refundRate);
  const delta = projected - now;
  const changed = (Object.keys(inputs) as (keyof Inputs)[]).some(
    (k) => Math.abs(inputs[k] - baseline.inputs[k]) > 0.005,
  );

  // Days a car must be out each month to cover what it costs to run. Above a
  // month means the price cannot carry the car, which is worth saying plainly.
  const netPerDay = inputs.price * (1 - baseline.refundRate);
  const breakEven = netPerDay > 0 ? inputs.cost / netPerDay : null;

  const set = (key: keyof Inputs) => (value: number) =>
    setInputs((prev) => ({ ...prev, [key]: Number.isFinite(value) ? Math.max(0, value) : 0 }));

  const symbol = currencySymbol(currency);
  const carsMax = Math.max(20, Math.ceil(baseline.inputs.cars * 2), inputs.cars);

  return (
    <section className="rounded-4xl bg-muted/40 p-6 ring-1 ring-foreground/5 xl:flex xl:h-full xl:flex-col [@media(max-height:860px)]:p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-medium tracking-tight">What if…</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Starts from your own numbers. Move them to see what a month would look like.
          </p>
        </div>
        {changed ? (
          <button
            type="button"
            onClick={() => setInputs(baseline.inputs)}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            My numbers
          </button>
        ) : null}
      </header>

      <div className="mt-6 space-y-6 xl:flex xl:flex-1 xl:flex-col xl:justify-evenly xl:space-y-0 [@media(max-height:860px)]:mt-4 [@media(max-height:860px)]:space-y-4 [@media(max-height:860px)]:xl:space-y-0">
        <SliderField
          label="Cars on the fleet"
          value={inputs.cars}
          display={`${Math.round(inputs.cars)}`}
          min={0}
          max={carsMax}
          step={1}
          onChange={set('cars')}
        />
        <SliderField
          label="Days each car is rented a month"
          value={inputs.days}
          display={`${inputs.days.toFixed(0)} of 30`}
          min={0}
          max={31}
          step={1}
          onChange={set('days')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Price per rental day"
            symbol={symbol}
            value={inputs.price}
            onChange={set('price')}
          />
          <MoneyField
            label="Running cost per car a month"
            symbol={symbol}
            value={inputs.cost}
            onChange={set('cost')}
          />
        </div>
      </div>

      <div className="mt-6 border-t border-foreground/10 pt-5 [@media(max-height:860px)]:mt-4 [@media(max-height:860px)]:pt-4">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          You would keep a month
        </p>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p
            className={cn(
              'font-heading text-4xl leading-none font-semibold tracking-tight tabular-nums',
              projected < 0 && 'text-destructive',
            )}
          >
            {signed(projected)}
          </p>
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {changed && Math.abs(delta) >= 0.5 ? (
              <>
                <span className="font-medium text-foreground">
                  {delta > 0 ? '+' : MINUS} {money(Math.abs(delta))}
                </span>{' '}
                vs. {signed(now)} today
              </>
            ) : (
              'about what you keep today'
            )}
          </p>
        </div>

        <p className="mt-4 text-[13px] text-muted-foreground">
          {breakEven == null ? (
            'Set a price to see how many days a car needs to pay for itself.'
          ) : breakEven > 31 ? (
            <>
              At this price a car can&apos;t cover its running cost, even rented every day.
            </>
          ) : (
            <>
              Each car pays for itself after{' '}
              <span className="font-medium tabular-nums text-foreground">
                {Math.ceil(breakEven)} {Math.ceil(breakEven) === 1 ? 'day' : 'days'}
              </span>{' '}
              rented a month. Every day after that is money you keep.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

function SliderField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{display}</span>
      </div>
      <Slider
        value={[Math.min(value, max)]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
      />
    </div>
  );
}

function MoneyField({
  label,
  symbol,
  value,
  onChange,
}: {
  label: string;
  symbol: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="relative mt-2 block">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
          {symbol}
        </span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step="1"
          value={Number.isFinite(value) ? Math.round(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className={cn('bg-background tabular-nums', symbol.length > 1 ? 'pl-12' : 'pl-7')}
        />
      </span>
    </label>
  );
}
