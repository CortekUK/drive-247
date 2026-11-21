'use client';

/**
 * The Super Admin home's business view: who the figures cover (all clients or
 * a chosen few), MRR with its growth line, then the supporting figures.
 * All numbers come from lib/dashboard/business-metrics.ts; nothing here queries.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Area, ComposedChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useLiveTenants } from '@/lib/dashboard/use-admin-dashboard';
import { computeBusiness, useBusinessRaw, type Business, type MrrPoint, type MrrRange } from '@/lib/dashboard/business-metrics';
import { Eyebrow, usd } from './kit';

const SCOPE_KEY = 'admin-dashboard:client-scope';
const RANGE_KEY = 'admin-dashboard:mrr-range';
const RANGES: { key: MrrRange; label: string }[] = [
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '12m', label: '12M' },
  { key: 'all', label: 'All' },
];

function readStore<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const pct = (n: number | null, digits = 1) => (n === null ? '—' : `${(n * 100).toFixed(digits)}%`);
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${usd(Math.abs(n))}`;
const monthDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/* ─────────────────────────────── segmented ─────────────────────────────── */

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--pv-line)] bg-[var(--pv-wash)] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[12px] font-medium [transition:background-color_200ms_ease-out,color_200ms_ease-out] motion-reduce:transition-none',
            value === o.key
              ? 'bg-[var(--pv-paper)] text-[var(--pv-ink)] ring-1 ring-[var(--pv-line)]'
              : 'text-[var(--pv-ink-3)] hover:text-[var(--pv-ink-2)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────── client scope ──────────────────────────── */

function ClientPicker({
  clients,
  selected,
  onChange,
}: {
  clients: { id: string; name: string }[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [q, setQ] = useState('');
  const shown = clients.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-[var(--pv-line)] bg-[var(--pv-paper)] px-2.5 text-[12px] font-medium text-[var(--pv-ink-2)] hover:text-[var(--pv-ink)]"
        >
          {selected.size === 0 ? 'Pick clients' : `${selected.size} of ${clients.length} clients`}
          <ChevronDown className="size-3.5 text-[var(--pv-ink-3)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="pv w-72 rounded-xl p-0 shadow-none">
        <div className="flex items-center gap-2 border-b border-[var(--pv-line)] px-3 py-2">
          <Search className="size-3.5 text-[var(--pv-ink-3)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients"
            className="h-7 flex-1 bg-transparent text-[13px] text-[var(--pv-ink)] outline-none placeholder:text-[var(--pv-ink-3)]"
          />
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 text-[11.5px]">
          <button type="button" className="text-[var(--pv-accent-ink)]" onClick={() => onChange(new Set(clients.map((c) => c.id)))}>
            Select all
          </button>
          <button type="button" className="text-[var(--pv-ink-3)] hover:text-[var(--pv-ink-2)]" onClick={() => onChange(new Set())}>
            Clear
          </button>
        </div>
        <ul className="max-h-72 overflow-y-auto pb-1.5">
          {shown.map((c) => {
            const on = selected.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-[var(--pv-ink)] hover:bg-[var(--pv-wash)]"
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-[var(--pv-accent)] bg-[var(--pv-accent)] text-white' : 'border-[var(--pv-line-2)]',
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{c.name}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-3 py-3 text-[12.5px] text-[var(--pv-ink-3)]">No client matches.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/* ─────────────────────────────── MRR hero ──────────────────────────────── */

function MrrTip({ point }: { point: MrrPoint }) {
  return (
    <div className="pv min-w-[170px] rounded-xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-3.5 py-3 text-[12px]">
      <p className="text-[11px] font-medium text-[var(--pv-ink-3)]">{monthDay(point.date)}</p>
      <p className="mt-1 text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--pv-ink)]">{usd(point.mrr)}</p>
      <p className="text-[11.5px] text-[var(--pv-ink-3)]">
        MRR · {point.clients} paying client{point.clients === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function MrrHero({ b, range, onRange }: { b: Business; range: MrrRange; onRange: (r: MrrRange) => void }) {
  const uid = useId().replace(/:/g, '');
  const last = b.series[b.series.length - 1];
  const up = b.growth === null || b.growth >= 0;
  return (
    <section className="rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-6 pb-4 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Monthly recurring revenue</Eyebrow>
          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <span className="text-[44px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-[var(--pv-ink)]">
              {usd(b.mrr)}
            </span>
            {b.growth !== null && (
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums',
                  up ? 'bg-[color-mix(in_srgb,var(--pv-clear)_12%,transparent)] text-[var(--pv-clear)]' : 'bg-[color-mix(in_srgb,var(--pv-late)_12%,transparent)] text-[var(--pv-late)]',
                )}
              >
                {up ? '↑' : '↓'} {Math.abs(b.growth * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <p className="mt-2 text-[13px] text-[var(--pv-ink-2)]">
            From <span className="font-semibold tabular-nums text-[var(--pv-ink)]">{usd(b.start.mrr)}</span>
            <span className="text-[var(--pv-ink-3)]"> on {monthDay(b.start.date)}</span> to{' '}
            <span className="font-semibold tabular-nums text-[var(--pv-ink)]">{usd(b.mrr)}</span>
            <span className="text-[var(--pv-ink-3)]"> today</span>
            <span className="text-[var(--pv-ink-3)]">
              {' '}
              · {signed(b.mrr - b.start.mrr)} · {b.start.clients} → {b.payingClients} paying clients
            </span>
          </p>
        </div>
        <Segmented value={range} options={RANGES} onChange={onRange} />
      </div>

      <div className="relative mt-3 h-[260px] text-[var(--pv-accent-ink)]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={b.series} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.26} />
                <stop offset="75%" stopColor="currentColor" stopOpacity={0.05} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={56}
              tickMargin={6}
              tick={{ fontSize: 10.5, fill: 'var(--pv-ink-3)' }}
              tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: range === '3m' ? 'numeric' : undefined })}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10.5, fill: 'var(--pv-ink-3)' }}
              tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
              domain={[0, (max: number) => Math.max(100, Math.ceil((max * 1.1) / 500) * 500)]}
            />
            <Tooltip
              cursor={{ stroke: 'var(--pv-ink-3)', strokeWidth: 1, strokeDasharray: '2 3' }}
              content={(props) => {
                const p = props.active ? (props.payload?.[0]?.payload as MrrPoint | undefined) : undefined;
                return p ? <MrrTip point={p} /> : null;
              }}
              wrapperStyle={{ outline: 'none', zIndex: 20 }}
              isAnimationActive={false}
            />
            <Area
              dataKey="mrr"
              type="monotone"
              stroke="currentColor"
              strokeWidth={2.25}
              fill={`url(#${uid}-fill)`}
              dot={false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--pv-paper)', fill: 'currentColor' }}
              animationDuration={700}
              animationEasing="ease-out"
            />
            {last && <ReferenceDot x={last.date} y={last.mrr} r={4.5} fill="currentColor" stroke="var(--pv-paper)" strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
        {b.mrr === 0 && b.start.mrr === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-[var(--pv-ink-3)]">
            No paying clients in this selection.
          </p>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────────── tiles ─────────────────────────────────── */

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'late' | 'clear' }) {
  return (
    <div className="rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-5 py-4">
      <Eyebrow>{label}</Eyebrow>
      <p
        className={cn(
          'mt-2.5 text-[24px] font-semibold leading-none tracking-[-0.025em] tabular-nums',
          tone === 'late' ? 'text-[var(--pv-late)]' : tone === 'clear' ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-ink)]',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 truncate text-[11.5px] text-[var(--pv-ink-3)]">{sub}</p>}
    </div>
  );
}

function Movement({ b }: { b: Business }) {
  const rows: { label: string; value: number; note: string }[] = [
    { label: 'New', value: b.newMrr30, note: `${b.newClients30} client${b.newClients30 === 1 ? '' : 's'} started paying` },
    { label: 'Plan changes', value: b.changesMrr30, note: 'Upgrades and downgrades' },
    { label: 'Churned', value: -b.churnedMrr30, note: `${b.churned30} client${b.churned30 === 1 ? '' : 's'} stopped paying` },
  ];
  return (
    <section className="flex flex-col rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)]">
      <div className="px-6 pb-2 pt-5">
        <Eyebrow>MRR movement · last 30 days</Eyebrow>
      </div>
      <ul className="flex-1 px-6">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4 border-b border-[var(--pv-line)] py-3 last:border-0">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--pv-ink)]">{r.label}</span>
              <span className="block truncate text-[11.5px] text-[var(--pv-ink-3)]">{r.note}</span>
            </span>
            <span
              className={cn(
                'text-[14px] font-semibold tabular-nums',
                r.value > 0 ? 'text-[var(--pv-clear)]' : r.value < 0 ? 'text-[var(--pv-late)]' : 'text-[var(--pv-ink-3)]',
              )}
            >
              {r.value === 0 ? usd(0) : signed(r.value)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-[var(--pv-line)] px-6 py-3.5">
        <span className="text-[12.5px] font-medium text-[var(--pv-ink-2)]">Net new MRR</span>
        <span className={cn('text-[16px] font-semibold tabular-nums', b.netNew30 >= 0 ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-late)]')}>
          {signed(b.netNew30)}
        </span>
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-[380px] animate-pulse rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-wash)] motion-reduce:animate-none" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[96px] animate-pulse rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-wash)] motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── the view ──────────────────────────────── */

type ScopeMode = 'all' | 'some';

export function BusinessHome({ headerLeft }: { headerLeft: ReactNode }) {
  const tenants = useLiveTenants();
  const raw = useBusinessRaw();

  const [mode, setMode] = useState<ScopeMode>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<MrrRange>('6m');
  useEffect(() => {
    const s = readStore<{ mode: ScopeMode; ids: string[] }>(SCOPE_KEY, { mode: 'all', ids: [] });
    setMode(s.mode === 'some' ? 'some' : 'all');
    setPicked(new Set(Array.isArray(s.ids) ? s.ids : []));
    const r = readStore<MrrRange>(RANGE_KEY, '6m');
    if (RANGES.some((x) => x.key === r)) setRange(r);
  }, []);
  const saveScope = (m: ScopeMode, ids: Set<string>) => {
    setMode(m);
    setPicked(ids);
    writeStore(SCOPE_KEY, { mode: m, ids: [...ids] });
  };

  const clients = useMemo(() => {
    if (!tenants.data || !raw.data) return [];
    return tenants.data.list
      .filter((t) => raw.data.everSubscribed.has(t.id))
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tenants.data, raw.data]);

  const b = useMemo(
    () => (raw.data ? computeBusiness(raw.data, mode === 'all' ? null : picked, range) : null),
    [raw.data, mode, picked, range],
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        {headerLeft}
        <div className="flex items-center gap-2">
          <Segmented
            value={mode}
            options={[
              { key: 'all', label: 'All clients' },
              { key: 'some', label: 'Selected' },
            ]}
            onChange={(m) => saveScope(m, picked)}
          />
          {mode === 'some' && <ClientPicker clients={clients} selected={picked} onChange={(s) => saveScope('some', s)} />}
        </div>
      </header>

      {raw.isError && (
        <p className="rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-6 py-10 text-center text-[13px] text-[var(--pv-ink-3)]">
          The business figures couldn&rsquo;t be loaded just now.
        </p>
      )}
      {!b && !raw.isError && <HomeSkeleton />}
      {b && mode === 'some' && picked.size === 0 && (
        <p className="rounded-2xl border border-dashed border-[var(--pv-line-2)] px-6 py-10 text-center text-[13px] text-[var(--pv-ink-3)]">
          Pick one or more clients to see their figures.
        </p>
      )}
      {b && !(mode === 'some' && picked.size === 0) && (
        <>
          <MrrHero
            b={b}
            range={range}
            onRange={(r) => {
              setRange(r);
              writeStore(RANGE_KEY, r);
            }}
          />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="ARR" value={usd(b.arr)} sub="MRR × 12" />
            <Tile label="Total earned" value={usd(b.totalEarned)} sub={`${usd(b.earned30)} in the last 30 days`} />
            <Tile label="Paying clients" value={String(b.payingClients)} sub={`${usd(b.arpa)} average per client`} />
            <Tile label="All-time clients" value={String(b.allTimeClients)} sub="Ever paid a subscription" />
            <Tile
              label="Churn rate · 30 days"
              value={pct(b.churn30)}
              sub={`${b.churned30} lost · ${usd(b.churnedMrr30)} MRR`}
              tone={b.churn30 !== null && b.churn30 > 0.05 ? 'late' : undefined}
            />
            <Tile
              label="Retention · 30 days"
              value={b.churn30 === null ? '—' : pct(1 - b.churn30)}
              sub="Clients still paying"
            />
            <Tile label="In trial" value={String(b.trialing)} sub={`${usd(b.trialMrr)} MRR if they convert`} />
            <Tile
              label="Payment due"
              value={String(b.pastDue)}
              sub={`${usd(b.atRiskMrr)} MRR at risk`}
              tone={b.pastDue > 0 ? 'late' : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Movement b={b} />
            <ClientsLine b={b} />
          </div>
        </>
      )}
    </div>
  );
}

/** Paying clients over the same range — the head count behind the MRR line. */
function ClientsLine({ b }: { b: Business }) {
  const uid = useId().replace(/:/g, '');
  return (
    <section className="flex flex-col rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] px-6 pb-3 pt-5">
      <Eyebrow>Paying clients</Eyebrow>
      <p className="mt-2.5 text-[13px] text-[var(--pv-ink-2)]">
        <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--pv-ink)]">{b.payingClients}</span>
        <span className="ml-2 text-[var(--pv-ink-3)]">
          {b.payingClients >= b.start.clients ? 'up' : 'down'} from {b.start.clients} on {monthDay(b.start.date)}
        </span>
      </p>
      <div className="mt-2 h-[150px] min-h-0 text-[var(--pv-accent-ink)]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={b.series} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${uid}-c`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" hide />
            <YAxis hide domain={[0, (m: number) => Math.max(1, Math.ceil(m * 1.15))]} />
            <Tooltip
              cursor={{ stroke: 'var(--pv-ink-3)', strokeWidth: 1, strokeDasharray: '2 3' }}
              content={(props) => {
                const p = props.active ? (props.payload?.[0]?.payload as MrrPoint | undefined) : undefined;
                return p ? <MrrTip point={p} /> : null;
              }}
              wrapperStyle={{ outline: 'none', zIndex: 20 }}
              isAnimationActive={false}
            />
            <Area
              dataKey="clients"
              type="stepAfter"
              stroke="currentColor"
              strokeWidth={1.75}
              fill={`url(#${uid}-c)`}
              dot={false}
              animationDuration={700}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
