'use client';

/**
 * Insights — P&L, one table, one row per car.
 *
 * Read like a trading screen: every car is a ticker, with its own little line
 * of what it kept month by month, the period's figures, and how this month
 * moved against the last. Everything an operator wants about a car's money is
 * ON the row — nothing opens in a dialog or a page (Ghulam, 2026-10-02).
 *
 * Colour: the accent carries almost everything — lines, the margin bar, the
 * change on a car that is up. Red appears only where a figure is genuinely
 * below zero, and only on the text; no green anywhere. Status is text, never a
 * pill (design system).
 *
 * Built from the same `useInsights` read as every other view: the tenant's
 * category rules and single-entry corrections are in every number here, and
 * rentals give the days each car was out.
 */

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { toNumber } from './_money-model';
import { periodRange, type InsightsData, type PeriodMonths } from './_data';

type CarRow = {
  id: string;
  name: string;
  plate: string | null;
  series: number[]; // kept per month, oldest first
  moneyIn: number;
  spent: number;
  kept: number;
  margin: number | null; // kept ÷ money in, %
  change: number | null; // this month vs last, %
  daysOut: number;
  utilisation: number; // %
  perDay: number | null; // money in ÷ days out
  share: number; // of the fleet's money in, %
};

type SortKey = 'name' | 'moneyIn' | 'spent' | 'kept' | 'margin' | 'change' | 'utilisation' | 'perDay';

const MINUS = '−';

/* ────────────────────────────────────────────────────────────────────────────
 * Rows
 * ──────────────────────────────────────────────────────────────────────────── */

function buildRows(data: InsightsData, months: PeriodMonths): CarRow[] {
  const keys = data.monthly.map((m) => m.key);
  const index = new Map(keys.map((k, i) => [k, i]));
  const { from, to, days } = periodRange(months);

  const per = new Map<string, { inM: number[]; outM: number[] }>();
  const bucket = (vid: string) => {
    let t = per.get(vid);
    if (!t) {
      t = { inM: new Array(keys.length).fill(0), outM: new Array(keys.length).fill(0) };
      per.set(vid, t);
    }
    return t;
  };
  for (const r of data.ledger) {
    if (r.excluded || !r.vehicle_id) continue;
    const i = index.get((r.entry_date ?? '').slice(0, 7));
    if (i == null) continue;
    if (r.bucket === 'operating_revenue') bucket(r.vehicle_id).inM[i] += toNumber(r.amount);
    else if (r.bucket === 'operating_cost') bucket(r.vehicle_id).outM[i] += toNumber(r.amount);
  }

  // Days out per car, each rental clipped to the period, both ends counted.
  const out = new Map<string, number>();
  const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000;
  for (const r of data.rentals) {
    if (!r.vehicleId || !(r.status === 'Active' || r.status === 'Closed') || !r.start || !r.end) continue;
    const a = Math.max(dayNum(r.start), dayNum(from));
    const b = Math.min(dayNum(r.end), dayNum(to));
    if (b >= a) out.set(r.vehicleId, (out.get(r.vehicleId) ?? 0) + (b - a + 1));
  }

  // Every car on the fleet, plus any removed car the ledger still mentions.
  const ids = new Set([...data.vehicleLabels.keys(), ...per.keys()]);
  const fleetIn = [...per.values()].reduce((s, t) => s + t.inM.reduce((a, b) => a + b, 0), 0);

  return [...ids].map((id) => {
    const t = per.get(id) ?? { inM: new Array(keys.length).fill(0), outM: new Array(keys.length).fill(0) };
    const series = t.inM.map((v, i) => v - t.outM[i]);
    const moneyIn = t.inM.reduce((a, b) => a + b, 0);
    const spent = t.outM.reduce((a, b) => a + b, 0);
    const kept = moneyIn - spent;
    const last = series.at(-1) ?? 0;
    const prev = series.at(-2) ?? 0;
    const daysOut = Math.min(days, out.get(id) ?? 0);
    const label = data.vehicleLabels.get(id) ?? `Removed car (${id.slice(0, 8)})`;
    const [name, plate] = label.split(' · ');
    return {
      id,
      name,
      plate: plate ?? null,
      series,
      moneyIn,
      spent,
      kept,
      margin: moneyIn > 0 ? (kept / moneyIn) * 100 : null,
      change: Math.abs(prev) > 0.5 ? ((last - prev) / Math.abs(prev)) * 100 : null,
      daysOut,
      utilisation: days > 0 ? (daysOut / days) * 100 : 0,
      perDay: daysOut > 0 ? moneyIn / daysOut : null,
      share: fleetIn > 0 ? (moneyIn / fleetIn) * 100 : 0,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * The table
 * ──────────────────────────────────────────────────────────────────────────── */

export function PnlTable({
  data,
  months,
  currency,
}: {
  data: InsightsData | undefined;
  months: PeriodMonths;
  currency: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'kept', dir: -1 });
  const rows = useMemo(() => (data ? buildRows(data, months) : []), [data, months]);

  const sorted = useMemo(() => {
    const v = (r: CarRow) => (sort.key === 'name' ? r.name.toLowerCase() : (r[sort.key] ?? -Infinity));
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);

  const money = (n: number) => formatCurrency(n, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const signed = (n: number) => (n < 0 ? `${MINUS}${money(-n)}` : money(n));

  // Fleet line: the same columns, summed, plus the fleet's own sparkline.
  const fleet = useMemo(() => {
    if (rows.length === 0) return null;
    const len = rows[0].series.length;
    const series = Array.from({ length: len }, (_, i) => rows.reduce((s, r) => s + r.series[i], 0));
    const moneyIn = rows.reduce((s, r) => s + r.moneyIn, 0);
    const spent = rows.reduce((s, r) => s + r.spent, 0);
    const kept = moneyIn - spent;
    const daysOut = rows.reduce((s, r) => s + r.daysOut, 0);
    const last = series.at(-1) ?? 0;
    const prev = series.at(-2) ?? 0;
    return {
      series,
      moneyIn,
      spent,
      kept,
      margin: moneyIn > 0 ? (kept / moneyIn) * 100 : null,
      change: Math.abs(prev) > 0.5 ? ((last - prev) / Math.abs(prev)) * 100 : null,
      utilisation: rows.length ? rows.reduce((s, r) => s + r.utilisation, 0) / rows.length : 0,
      daysOut,
      perDay: daysOut > 0 ? moneyIn / daysOut : null,
    };
  }, [rows]);

  const head = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key;
    return (
      <th className={cn('px-4 py-3 font-medium whitespace-nowrap', align === 'right' ? 'text-right' : 'text-left')}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded-md transition-colors duration-200 hover:text-foreground motion-reduce:transition-none',
            active && 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]',
          )}
        >
          {label}
          {active ? (
            sort.dir === -1 ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
          )}
        </button>
      </th>
    );
  };

  if (data && rows.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Once your cars start earning, I'll lay out each one's profit and loss here.
        </p>
      </div>
    );
  }

  const monthLabels = data?.monthly.map((m) => m.label) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-4xl ring-1 ring-foreground/5">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-[color-mix(in_srgb,hsl(var(--primary))_7%,hsl(var(--background)))] text-xs text-muted-foreground">
            <tr>
              {head('name', 'Car', 'left')}
              <th className="px-4 py-3 text-left font-medium whitespace-nowrap">
                Kept, month by month
                <span className="ml-1.5 font-normal opacity-70 tabular-nums">
                  {monthLabels[0]} – {monthLabels.at(-1)}
                </span>
              </th>
              {head('moneyIn', 'Money in')}
              {head('spent', 'Spent')}
              {head('kept', 'Kept')}
              {head('change', 'vs last month')}
              {head('margin', 'Margin')}
              {head('utilisation', 'Out')}
              {head('perDay', 'Per day out')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Line key={r.id} row={r} money={money} signed={signed} />
            ))}
          </tbody>
          {fleet ? (
            /* The fleet line is the answer the rows add up to, so it stands
               out — but as a soft accent wash with an accent rule above it,
               not the solid accent (too bright across a full-width row). Size
               and weight carry the rest. Pinned to the bottom of the table. */
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-[color-mix(in_srgb,hsl(var(--primary))_11%,hsl(var(--background)))] [&>td]:border-t-2 [&>td]:border-primary/30 [&>td]:py-4">
                <td className="px-4">
                  <p className="font-heading text-base font-semibold">Whole fleet</p>
                  <p className="text-xs text-muted-foreground">{rows.length} cars</p>
                </td>
                <td className="px-4">
                  <Spark values={fleet.series} strong />
                </td>
                <Num className="text-[15px] font-medium">{money(fleet.moneyIn)}</Num>
                <Num className="text-[15px] text-muted-foreground">{money(fleet.spent)}</Num>
                <Num
                  className={cn(
                    'font-heading text-lg font-semibold',
                    fleet.kept < 0 ? 'text-destructive' : 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]',
                  )}
                >
                  {signed(fleet.kept)}
                </Num>
                <Num>
                  <Change value={fleet.change} />
                </Num>
                <Num>
                  <Margin value={fleet.margin} />
                </Num>
                <Num className="font-medium">{fleet.utilisation.toFixed(0)}%</Num>
                <Num className="font-medium">{fleet.perDay == null ? '—' : money(fleet.perDay)}</Num>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 text-right whitespace-nowrap tabular-nums', className)}>{children}</td>;
}

/** One car — a ticker row. */
function Line({ row: r, money, signed }: { row: CarRow; money: (n: number) => string; signed: (n: number) => string }) {
  return (
    <tr className="group transition-colors duration-200 hover:bg-primary/[0.04] motion-reduce:transition-none [&>td]:border-b [&>td]:border-foreground/5">
      <td className="min-w-[200px] px-4 py-3">
        <p className="max-w-[240px] truncate font-medium">{r.name}</p>
        {/* One quiet line: the plate, then the car's share of the fleet's
            money in. Never wraps; the full wording is on hover. */}
        <p
          className="mt-0.5 truncate text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          title={`${r.share.toFixed(0)}% of the fleet's money in`}
        >
          {[r.plate, `${r.share.toFixed(0)}% of fleet`].filter(Boolean).join(' · ')}
        </p>
      </td>
      <td className="px-4 py-2">
        <Spark values={r.series} />
      </td>
      <Num>{money(r.moneyIn)}</Num>
      <Num className="text-muted-foreground">{money(r.spent)}</Num>
      <Num className={cn('text-[15px] font-semibold', r.kept < 0 && 'text-destructive')}>{signed(r.kept)}</Num>
      <Num>
        <Change value={r.change} />
      </Num>
      <Num>
        <Margin value={r.margin} />
      </Num>
      <Num>
        <span>{r.utilisation.toFixed(0)}%</span>
        <span className="ml-1.5 text-xs text-muted-foreground">{r.daysOut}d</span>
      </Num>
      <Num>{r.perDay == null ? <span className="text-muted-foreground">—</span> : money(r.perDay)}</Num>
    </tr>
  );
}

/** This month against last — accent when up, plain muted when down. */
function Change({ value, inverse }: { value: number | null; inverse?: boolean }) {
  if (value == null) return <span className={inverse ? 'opacity-75' : 'text-muted-foreground'}>—</span>;
  const up = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-medium',
        inverse
          ? up ? '' : 'opacity-75'
          : up ? 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]' : 'text-muted-foreground',
      )}
    >
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {Math.abs(value) >= 1000 ? '999+' : Math.abs(value).toFixed(0)}%
    </span>
  );
}

/** Margin as a figure with a thin accent bar under it. */
function Margin({ value, inverse }: { value: number | null; inverse?: boolean }) {
  if (value == null) return <span className={inverse ? 'opacity-75' : 'text-muted-foreground'}>—</span>;
  const w = Math.max(0, Math.min(100, value));
  return (
    <span className="inline-flex w-20 flex-col items-end gap-1">
      <span className={cn(inverse ? 'font-medium' : value < 0 && 'text-destructive')}>{value.toFixed(0)}%</span>
      <span className={cn('h-1 w-full overflow-hidden rounded-full', inverse ? 'bg-primary-foreground/25' : 'bg-foreground/[0.07]')}>
        <span
          className={cn('block h-full rounded-full', inverse ? 'bg-primary-foreground' : 'bg-primary')}
          style={{ width: `${w}%` }}
        />
      </span>
    </span>
  );
}

/**
 * The sparkline. Plain SVG (a Recharts chart per row would be dozens of
 * chart instances in one table). Accent line over a soft accent fill, a
 * dashed zero line when the series crosses it, and the last month as a dot —
 * the "price now" of a ticker. Drawn straight point to point: a smoothed
 * curve invents peaks and dips between months.
 */
function Spark({ values, strong, inverse }: { values: number[]; strong?: boolean; inverse?: boolean }) {
  // On the accent fleet row the line is drawn in the on-accent ink (white).
  const ink = inverse ? 'hsl(var(--primary-foreground))' : 'hsl(var(--primary))';
  const id = useId().replace(/:/g, '');
  const W = 168;
  const H = 36;
  const P = 3;
  if (values.length === 0) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - P * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => P + (1 - (v - min) / span) * (H - P * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const crosses = min < 0 && max > 0;
  const last = values.at(-1) ?? 0;
  const flat = values.every((v) => Math.abs(v) < 0.5);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" aria-hidden>
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ink} stopOpacity={strong ? 0.3 : 0.2} />
          <stop offset="100%" stopColor={ink} stopOpacity={0} />
        </linearGradient>
      </defs>
      {crosses ? (
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke={inverse ? ink : 'hsl(var(--foreground))'} strokeOpacity={inverse ? 0.4 : 0.18} strokeDasharray="2 3" />
      ) : null}
      {flat ? (
        <line x1={P} x2={W - P} y1={H / 2} y2={H / 2} stroke={inverse ? ink : 'hsl(var(--foreground))'} strokeOpacity={inverse ? 0.4 : 0.15} strokeDasharray="2 3" />
      ) : (
        <>
          <path d={area} fill={`url(#${id}-f)`} />
          <path
            d={line}
            fill="none"
            stroke={ink}
            strokeWidth={strong ? 2 : 1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={x(values.length - 1)}
            cy={y(last)}
            r={2.8}
            fill={last < 0 && !inverse ? 'hsl(var(--destructive))' : ink}
            stroke={inverse ? 'hsl(var(--primary))' : 'hsl(var(--background))'}
            strokeWidth={1.5}
          />
        </>
      )}
    </svg>
  );
}
