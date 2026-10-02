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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, RotateCcw } from 'lucide-react';
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

  const LIMITS: Record<keyof Inputs, number> = { cars: 999, days: 31, price: 99_999, cost: 99_999 };
  const set = (key: keyof Inputs) => (value: number) =>
    setInputs((prev) => ({
      ...prev,
      [key]: Number.isFinite(value) ? Math.min(LIMITS[key], Math.max(0, value)) : 0,
    }));
  const nudge = (key: keyof Inputs, by: number) => set(key)(Math.round(inputs[key]) + by);

  const symbol = currencySymbol(currency);
  // Each knob's full turn. Generous enough to ask "what if double?", and never
  // smaller than the value already on the key.
  const carsMax = Math.max(20, Math.ceil(baseline.inputs.cars * 2), Math.ceil(inputs.cars));
  const priceMax = Math.max(300, Math.ceil(baseline.inputs.price * 2 / 50) * 50, Math.ceil(inputs.price));
  const costMax = Math.max(500, Math.ceil(baseline.inputs.cost * 3 / 50) * 50, Math.ceil(inputs.cost));
  const days = Math.round(inputs.days);
  // The two halves of the answer, a month, after refunds — so the three
  // figures on the display add up to the big one.
  const moneyInMonth = inputs.cars * inputs.days * inputs.price * (1 - baseline.refundRate);

  /*
   * The calculator's "function keys": the questions operators actually ask.
   * Each one is applied to what is on the keys now, so they stack — +1 car
   * then +10% price is the answer to both at once.
   */
  const FUNCTIONS: { label: string; apply: () => void }[] = [
    { label: '+1 car', apply: () => nudge('cars', 1) },
    { label: '+2 days', apply: () => nudge('days', 2) },
    { label: '+10% price', apply: () => set('price')(Math.round(inputs.price * 1.1)) },
    { label: '−10% costs', apply: () => set('cost')(Math.round(inputs.cost * 0.9)) },
  ];

  return (
    /* A calculator in one clearly defined card — a firmer ring and a soft
       lift (the ui-v2 Card's own shadow family; Ghulam asked for "more
       defined"); dark mode keeps the ring only. The accent display on top, then the four keys and
       the strip. Inside the card the parts stay unboxed and spaced; at xl the
       card fills the column and the parts spread through it. */
    <section className="flex flex-col gap-5 overflow-hidden rounded-4xl bg-card p-3.5 xl:!overflow-hidden [@media(max-height:860px)]:gap-3 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_12px_32px_-16px_rgb(0_0_0/0.18)] dark:ring-foreground/15 dark:shadow-none xl:h-full xl:justify-between [&>*:not(:first-child)]:px-1">
      {/* ── Display ─────────────────────────────────────────────────────── */}
      <div className="relative shrink-0 overflow-hidden rounded-3xl bg-primary px-6 pt-5 pb-5 text-primary-foreground [@media(max-height:860px)]:px-5 [@media(max-height:860px)]:pt-4 [@media(max-height:860px)]:pb-4">
        {/* Quiet decoration: faint concentric rings off the top-right corner,
            in the on-accent ink, so the display is never a flat slab. */}
        <svg aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 opacity-[0.14]" viewBox="0 0 200 200">
          {[30, 52, 74, 96].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
          ))}
        </svg>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs font-medium opacity-80">
            <Calculator className="size-3.5" aria-hidden /> What if…
          </span>
          {changed ? (
            /* The AC key: back to the operator's own numbers. */
            <button
              type="button"
              onClick={() => setInputs(baseline.inputs)}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 text-xs font-medium transition-colors duration-200 hover:bg-primary-foreground/25 focus-visible:ring-2 focus-visible:ring-primary-foreground/60 focus-visible:outline-none motion-reduce:transition-none"
            >
              <RotateCcw className="size-3" aria-hidden /> My numbers
            </button>
          ) : null}
        </div>

        {/* The answer. Its share of what comes in is said in the line under
            it, as words — no chip, no bar. */}
        <div className="mt-5 flex items-center gap-3 [@media(max-height:860px)]:mt-3">
          <p
            className="font-heading text-5xl leading-none font-semibold tracking-tight tabular-nums [@media(max-height:860px)]:text-4xl"
            aria-live="polite"
          >
            {signed(projected)}
          </p>
        </div>
        <p className="mt-3 text-[13px] tabular-nums opacity-80">
          {changed && Math.abs(delta) >= 0.5 ? (
            <>
              <span className="font-semibold">
                {delta > 0 ? '+' : MINUS} {money(Math.abs(delta))}
              </span>{' '}
              vs. {signed(now)} today · a month
            </>
          ) : (
            'what you keep a month today'
          )}
          {moneyInMonth > 0 && projected > 0
            ? ` · ${Math.round((projected / moneyInMonth) * 100)}% of what comes in`
            : null}
        </p>

      </div>

      {/* ── Keys ────────────────────────────────────────────────────────── */}
      {/* Rows are never forced into the space left: a squeezed row overlaps
          the one below it. They take their own height and grow when there is
          more. */}
      <div className="grid grid-cols-2 gap-3">
        <Key label="Cars" hint="on the fleet" value={inputs.cars} max={carsMax} onChange={set('cars')} />
        <Key
          label="Days rented"
          hint="per car, a month"
          value={inputs.days}
          suffix="/ 30"
          max={30}
          onChange={set('days')}
        />
        <Key
          label="Price"
          hint="per rental day"
          value={inputs.price}
          prefix={symbol}
          max={priceMax}
          step={5}
          onChange={set('price')}
        />
        <Key
          label="Running cost"
          hint="per car, a month"
          value={inputs.cost}
          prefix={symbol}
          max={costMax}
          step={5}
          onChange={set('cost')}
        />
      </div>

      {/* ── Function keys ───────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap gap-2 px-1">
        {FUNCTIONS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={f.apply}
            className="h-8 cursor-pointer rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-primary transition-colors duration-200 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Break-even strip ────────────────────────────────────────────── */}
      <BreakEven breakEven={breakEven} days={days} />
    </section>
  );
}

/**
 * One calculator key: the number on the left (type it), a knob on the right
 * (turn it). The knob is the control; the number is its readout.
 */
function Key({
  label,
  hint,
  value,
  prefix,
  suffix,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  prefix?: string;
  suffix?: string;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-3xl bg-muted/40 p-3 [@media(max-height:860px)]:py-2">
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 self-stretch">
        <div className="leading-tight">
          <p className="truncate text-[13px] font-medium whitespace-nowrap">{label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <label className="flex items-baseline gap-1">
          {prefix ? <span className="text-base text-muted-foreground">{prefix}</span> : null}
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={Number.isFinite(value) ? Math.round(value) : ''}
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
            aria-label={`${label} ${hint}`}
            className="w-full min-w-0 bg-transparent font-heading text-2xl leading-none font-semibold tracking-tight tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
        </label>
      </div>
      <Knob label={`${label} ${hint}`} value={value} max={max} step={step} onChange={onChange} />
    </div>
  );
}

/* ── The knob ─────────────────────────────────────────────────────────────
 * A rotary dial over a 270° sweep (7:30 to 4:30, like a hi-fi volume knob).
 * Turned by dragging up/down (the convention every audio app uses — a
 * rotational drag is hard to aim at this size), by the mouse wheel, or by the
 * arrow keys / Page Up / Page Down / Home / End, because it is a real
 * `role="slider"`. Track in the muted ink, the value arc in the accent, a
 * white cap with an accent pointer. */
const SWEEP = 270;
const START = 135; // degrees, measured clockwise from 3 o'clock

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function Knob({
  label,
  value,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ y: number; start: number } | null>(null);
  const [active, setActive] = useState(false);

  const clamp = (v: number) => Math.min(max, Math.max(0, Math.round(v / step) * step));
  const t = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const angle = START + t * SWEEP;

  // 160px of drag is a full turn, whatever the range.
  const perPx = max / 160;

  /*
   * The wheel turns the knob, not the page. React registers wheel listeners as
   * passive, where `preventDefault()` is ignored and the column would scroll
   * under the cursor as the value changes — so this one is attached by hand,
   * non-passive, reading the latest value through a ref.
   */
  const node = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onChange, clamp, step });
  latest.current = { value, onChange, clamp, step };
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = latest.current;
      l.onChange(l.clamp(l.value + (e.deltaY < 0 ? l.step : -l.step)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const S = 64;
  const c = S / 2;
  const [px, py] = polar(c, c, 13, angle);

  return (
    <div
      ref={node}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className={cn(
        'group relative size-14 shrink-0 cursor-ns-resize touch-none rounded-full select-none outline-none',
        active && 'cursor-grabbing',
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, start: value };
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onChange(clamp(drag.current.start + (drag.current.y - e.clientY) * perPx));
      }}
      onPointerUp={() => {
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onKeyDown={(e) => {
        const big = Math.max(step, Math.round(max / 10 / step) * step);
        const next =
          e.key === 'ArrowUp' || e.key === 'ArrowRight' ? value + step
          : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? value - step
          : e.key === 'PageUp' ? value + big
          : e.key === 'PageDown' ? value - big
          : e.key === 'Home' ? 0
          : e.key === 'End' ? max
          : null;
        if (next == null) return;
        e.preventDefault();
        onChange(clamp(next));
      }}
    >
      {/* Well defined (Ghulam, 2026-10-02): tick marks round the dial that
          light up as it turns, a track with the value arc in the accent, a
          raised cap with a rim, and a line pointer from the centre. */}
      <svg viewBox={`0 0 ${S} ${S}`} className="size-full" aria-hidden>
        {Array.from({ length: 11 }, (_, i) => {
          const a = START + (i / 10) * SWEEP;
          const [x1, y1] = polar(c, c, 30.5, a);
          const [x2, y2] = polar(c, c, 28, a);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={i / 10 <= t + 1e-6 ? 'stroke-primary' : 'stroke-foreground/25'}
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          );
        })}
        <path d={arc(c, c, 24, START, START + SWEEP)} className="fill-none stroke-foreground/10" strokeWidth={4} strokeLinecap="round" />
        {t > 0.001 ? (
          <path d={arc(c, c, 24, START, angle)} className="fill-none stroke-primary" strokeWidth={4} strokeLinecap="round" />
        ) : null}
        {/* The cap: a card-white disc with a rim (accent while turning or
            keyboard-focused), and a faintly shaded face inside it. */}
        <circle
          cx={c}
          cy={c}
          r={18}
          strokeWidth={1.2}
          className={cn(
            'fill-card transition-colors duration-200 motion-reduce:transition-none',
            active ? 'stroke-primary/60' : 'stroke-foreground/20 group-focus-visible:stroke-primary/60',
          )}
        />
        <circle cx={c} cy={c} r={15} className={cn('fill-foreground/[0.04]', active && 'fill-primary/10')} />
        <line x1={c} y1={c} x2={px} y2={py} className="stroke-primary" strokeWidth={3} strokeLinecap="round" />
        <circle cx={c} cy={c} r={2.4} className="fill-primary" />
      </svg>
    </div>
  );
}

/**
 * The month as 30 little days. The first few pay for the car (muted), the
 * rented days after that are money kept (accent), the rest sit idle. It says
 * in one glance what the sentence under it says in words.
 */
function BreakEven({ breakEven, days }: { breakEven: number | null; days: number }) {
  const cover = breakEven == null ? 0 : Math.min(30, Math.ceil(breakEven));
  return (
    <div className="shrink-0 px-1">
      <div className="flex gap-[3px]" aria-hidden>
        {Array.from({ length: 30 }, (_, i) => {
          const rented = i < days;
          const paysCar = i < cover;
          return (
            <span
              key={i}
              className={cn(
                'h-3 flex-1 rounded-[3px]',
                rented && !paysCar && 'bg-primary',
                rented && paysCar && 'bg-foreground/35',
                !rented && paysCar && 'bg-foreground/15',
                !rented && !paysCar && 'bg-foreground/[0.06]',
              )}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        {breakEven == null ? (
          'Set a price to see how many days a car needs to pay for itself.'
        ) : breakEven > 31 ? (
          "At this price a car can't cover its running cost, even rented every day."
        ) : (
          <>
            Each car pays for itself after{' '}
            <span className="font-medium tabular-nums text-foreground">
              {Math.ceil(breakEven)} {Math.ceil(breakEven) === 1 ? 'day' : 'days'}
            </span>
            {days > Math.ceil(breakEven) ? (
              <>
                {' '}— the{' '}
                <span className="font-medium tabular-nums text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                  {days - Math.ceil(breakEven)} after
                </span>{' '}
                are money you keep.
              </>
            ) : (
              '. Every rented day after that is money you keep.'
            )}
          </>
        )}
      </p>
    </div>
  );
}
