'use client';

/**
 * The shared parts of the dashboard preview.
 *
 * One device runs through the whole page: every row ends in a **clock column** —
 * either a time today, or how long the thing has been waiting. It is the only
 * right-aligned element, always tabular, always the same width. Rental sells
 * time, so time is what every row is measured in, and one aligned column means
 * a card can be scanned down a single edge instead of read left to right.
 *
 * Colour is reserved, not decorative. `late` / `waiting` / `clear` / `idle` are
 * states and never appear in a chart; the chart hues never appear on a row.
 */

import type { ReactNode } from 'react';
import { Check, MoveDownLeft, MoveUpRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Movement, State, Todo, WorkItem } from './mock';

/** Status ink. Reserved — never reused for a chart series. */
const STATE_INK: Record<State, string> = {
  late: 'text-[var(--pv-late)]',
  waiting: 'text-[var(--pv-wait)]',
  ready: 'text-[var(--pv-ink-3)]',
  // `clear` is the absence of a problem, so it reads as ink rather than green.
  // Reserving colour for what needs doing is what stops a healthy card from
  // looking as loud as a broken one.
  clear: 'text-[var(--pv-ink-3)]',
  idle: 'text-[var(--pv-ink-3)]',
};

const STATE_DOT: Record<State, string> = {
  late: 'bg-[var(--pv-late)]',
  waiting: 'bg-[var(--pv-wait)]',
  ready: 'bg-[var(--pv-accent)]',
  clear: 'bg-[var(--pv-clear)]',
  idle: 'bg-[var(--pv-line-2)]',
};

/**
 * The preview palette, scoped to `.pv`. Kept out of the theme layer so it
 * cannot leak into the rest of the portal, and in one place so the dashboard
 * and the preview route can never drift apart.
 *
 * `--pv-accent-30` is the accent at 30% alpha, baked in as a literal rather
 * than written at the call site as `bg-[var(--pv-accent)]/30`. Tailwind 3.4
 * cannot parse a `var()` well enough to apply an opacity modifier to it, so
 * that class silently compiles to nothing — the NOW divider's rule would just
 * not be drawn. Tailwind 4 (which this file came from) can, via `color-mix`.
 */
export const HOME_PALETTE = `
  .pv {
    --pv-paper: #ffffff;
    --pv-wash: #f7f8fc;
    --pv-line: #e8eaf2;
    --pv-line-2: #d6d9e6;

    --pv-ink: #12141c;
    --pv-ink-2: #4d5364;
    --pv-ink-3: #878da0;

    --pv-accent: #5b5bd6;
    --pv-accent-30: #5b5bd64d;
    --pv-accent-bg: #ececfb;

    --pv-late: #d93025;
    --pv-late-bg: #fdeceb;
    --pv-wait: #b45309;
    --pv-wait-bg: #fdf3e7;
    --pv-clear: #12a594;
    --pv-clear-bg: #e4f6f3;
  }
`;

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pv-ink-3)]',
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * A labelled band of three cards.
 *
 * No tray around them. A container drawn around three cards that already have
 * their own borders is a second box saying what the heading and the gap between
 * bands already say — the grouping comes from the title above and the space
 * below, which costs nothing and reads cleaner.
 */
export function Band({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: string;
  children: ReactNode;
}) {
  return (
    <section>
      {/* A real heading, not an eyebrow. These three are the only headings on
          the page, so they can carry weight without competing with anything —
          and a title with its own line underneath means a card inside never has
          to repeat the context. */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-semibold leading-none tracking-[-0.025em] text-[var(--pv-ink)]">
            {title}
          </h2>
          {hint && <p className="mt-2.5 text-[13px] leading-none text-[var(--pv-ink-3)]">{hint}</p>}
        </div>
        {action && (
          <button
            type="button"
            className="shrink-0 text-[12px] font-medium text-[var(--pv-accent)] transition-opacity hover:opacity-70"
          >
            {action}
          </button>
        )}
      </div>
      {/* Three equal columns. Variety comes from what is inside a card — a
          lead item, a headline figure, checkboxes, a chart — rather than from
          one card being wider than its neighbours. */}
      <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

export function Card({
  title,
  count,
  action,
  span = 1,
  tall,
  children,
  className,
}: {
  title: string;
  count?: ReactNode;
  action?: string;
  /** Kept for a card that genuinely needs two columns; nothing uses it today. */
  span?: 1 | 2;
  tall?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)]',
        span === 2 && 'md:col-span-2',
        tall ? 'min-h-[352px]' : 'min-h-[292px]',
        className
      )}
    >
      <header className="flex items-baseline justify-between gap-3 px-6 pb-4 pt-5">
        <div className="flex items-baseline gap-2">
          <Eyebrow>{title}</Eyebrow>
          {count !== undefined && (
            <span className="text-[11px] font-medium tabular-nums text-[var(--pv-ink-2)]">
              {count}
            </span>
          )}
        </div>
        {action && (
          <button
            type="button"
            className="text-[11px] font-medium text-[var(--pv-accent)] transition-opacity hover:opacity-70"
          >
            {action}
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * The one item in a card that gets to be big.
 *
 * Same columns as a Row — label left, amount then clock right — just set
 * larger. Size alone says "read this one first", and it keeps the right edge
 * aligned all the way down the card.
 */
export function Lead({
  title,
  meta,
  clock,
  amount,
  tone = 'late',
}: {
  title: string;
  meta?: string;
  clock: string;
  amount?: string;
  tone?: State;
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-4 border-b border-[var(--pv-line)] px-6 py-5 text-left transition-colors hover:bg-[var(--pv-wash)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold leading-tight tracking-[-0.01em]">
          {title}
        </span>
        {meta && (
          <span className="mt-1 block truncate text-[12.5px] text-[var(--pv-ink-3)]">{meta}</span>
        )}
      </span>

      {amount && <span className="shrink-0 text-[15px] font-semibold tabular-nums">{amount}</span>}
      <span
        className={cn(
          'w-[52px] shrink-0 text-right text-[12px] font-semibold tabular-nums',
          STATE_INK[tone]
        )}
      >
        {clock}
      </span>
    </button>
  );
}

/**
 * The action every list card ends on, pinned to the bottom edge.
 *
 * `mt-auto` is the point: a card with two items in it used to trail off into
 * half a card of nothing. Anchoring the action to the floor turns that gap into
 * margin instead of an unfinished card, and it puts the link where you arrive
 * after reading rather than above where you start.
 */
export function CardFooter({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      className="group mt-auto flex w-full items-center gap-2.5 border-t border-[var(--pv-line)] px-6 py-3.5 text-left transition-colors hover:bg-[var(--pv-wash)]"
    >
      {icon}
      <span className="flex-1 text-[12px] text-[var(--pv-ink-3)] transition-colors group-hover:text-[var(--pv-ink-2)]">
        {label}
      </span>
      <span className="text-[12px] text-[var(--pv-ink-3)] transition-colors group-hover:text-[var(--pv-accent)]">
        →
      </span>
    </button>
  );
}

/** A headline figure for cards whose story is one number. */
export function Figure({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 px-6 pb-4 pt-1.5">
      <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      <span className="text-[11px] text-[var(--pv-ink-3)]">{label}</span>
      {sub && <span className="ml-auto">{sub}</span>}
    </div>
  );
}

/** The right-hand column. Fixed width so it lines up across every card. */
function Clock({ children, state }: { children: ReactNode; state: State }) {
  return (
    <span
      className={cn(
        'w-[52px] shrink-0 text-right text-[11.5px] font-medium tabular-nums tracking-tight',
        STATE_INK[state]
      )}
    >
      {children}
    </span>
  );
}

/** A worklist row: state dot, label, meta line, then the clock. */
export function Row({ item }: { item: WorkItem }) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-4 px-6 py-3.5 text-left transition-colors hover:bg-[var(--pv-wash)]"
    >
      {/* No status dot. It said exactly what the clock column already says, and
          two marks for one state is how a card ends up looking alarmed. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-tight text-[var(--pv-ink)]">
          {item.label}
        </span>
        {item.meta && (
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--pv-ink-3)]">
            {item.meta}
          </span>
        )}
      </span>

      {item.amount && (
        <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-[var(--pv-ink)]">
          {item.amount}
        </span>
      )}
      {item.clock && <Clock state={item.state}>{item.clock}</Clock>}
    </button>
  );
}

/**
 * A movement on the day list. Out and back share one queue in time order,
 * because the day happens in one sequence — splitting them into two columns
 * makes you merge them in your head to know what is actually next.
 */
export function FlowRow({ m, past }: { m: Movement; past?: boolean }) {
  const out = m.direction === 'out';
  const Arrow = out ? MoveUpRight : MoveDownLeft;

  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-[var(--pv-wash)]',
        past && 'opacity-50'
      )}
    >
      <span className="w-[38px] shrink-0 text-[11px] font-semibold tabular-nums tracking-tight text-[var(--pv-ink)]">
        {m.time}
      </span>

      {/* The arrow alone, no filled tile behind it. Direction is a category
          rather than a state, so it gets ink weight — the shape already says
          which way it is going. */}
      <Arrow className="size-3.5 shrink-0 text-[var(--pv-ink-3)]" strokeWidth={2.5} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-tight">{m.customer}</span>
        <span className="block truncate text-[11px] leading-tight text-[var(--pv-ink-3)]">
          {m.vehicle}
        </span>
      </span>

      {/* One neutral chip. It only takes a state colour when something is
          actually wrong — a green "Code sent" chip and a red "Unsigned" chip
          competing in the same list makes neither of them mean anything. */}
      {m.flag && (
        <span
          className={cn(
            'shrink-0 rounded bg-[var(--pv-wash)] px-1.5 py-0.5 text-[10.5px] font-medium',
            m.state === 'late' ? 'text-[var(--pv-late)]' : 'text-[var(--pv-ink-3)]'
          )}
        >
          {m.flag}
        </span>
      )}
    </button>
  );
}

/** Where the day has got to. Sits between rows, in the queue rather than beside it. */
export function NowDivider({ label, next }: { label: string; next: string }) {
  return (
    <div className="flex items-center gap-2 px-6 py-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--pv-accent)]">
        Now
      </span>
      <span className="text-[10px] font-semibold tabular-nums text-[var(--pv-accent)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--pv-accent-30)]" />
      <span className="text-[10px] text-[var(--pv-ink-3)]">{next}</span>
    </div>
  );
}

export function TodoRow({ todo }: { todo: Todo }) {
  return (
    <label className="group flex w-full cursor-pointer items-start gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--pv-wash)]">
      <span
        className={cn(
          'mt-px flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border transition-colors',
          todo.done
            ? 'border-[var(--pv-clear)] bg-[var(--pv-clear)] text-white'
            : 'border-[var(--pv-line-2)] group-hover:border-[var(--pv-accent)]'
        )}
      >
        {todo.done && <Check className="size-2.5" strokeWidth={3.5} />}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[13.5px] leading-tight',
            todo.done
              ? 'text-[var(--pv-ink-3)] line-through'
              : 'font-medium text-[var(--pv-ink)]'
          )}
        >
          {todo.text}
        </span>
        {todo.meta && !todo.done && (
          <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--pv-ink-3)]">
            {todo.meta}
          </span>
        )}
      </span>

      {todo.due && !todo.done && (
        <span
          className={cn(
            'shrink-0 text-[11px] font-medium tabular-nums',
            todo.due === 'Today' ? 'text-[var(--pv-wait)]' : 'text-[var(--pv-ink-3)]'
          )}
        >
          {todo.due}
        </span>
      )}
    </label>
  );
}

/** The one input on the page. An empty list should invite, not just report. */
export function AddNote() {
  return (
    <button
      type="button"
      className="group mt-auto flex w-full items-center gap-2.5 border-t border-[var(--pv-line)] px-6 py-4 text-left transition-colors hover:bg-[var(--pv-wash)]"
    >
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[5px] border border-dashed border-[var(--pv-line-2)] text-[var(--pv-ink-3)] group-hover:border-[var(--pv-accent)] group-hover:text-[var(--pv-accent)]">
        <Plus className="size-2.5" strokeWidth={3} />
      </span>
      <span className="text-[12px] text-[var(--pv-ink-3)] group-hover:text-[var(--pv-ink-2)]">
        Add a note
      </span>
    </button>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────────

/**
 * A sparkline. One series, so no legend — the label beside it names it. The
 * last point is marked because "where it ended up" is the only value worth
 * reading off a shape this small.
 */
export function Spark({ data, color, height = 34 }: { data: number[]; color: string; height?: number }) {
  const w = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const usable = height - pad * 2;

  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: pad + usable - ((v - min) / span) * usable,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className="w-full overflow-visible"
      style={{ height }}
      role="img"
      aria-label="Fourteen day trend"
    >
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={last.x}
        cy={last.y}
        r={3}
        fill={color}
        stroke="var(--pv-paper)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Delta({ value, suffix = 'pt' }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        'text-[11px] font-semibold tabular-nums',
        up ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-late)]'
      )}
    >
      {up ? '↑' : '↓'} {Math.abs(value)}
      {suffix}
    </span>
  );
}

/** Magnitude, so one hue at one strength rather than a colour per bar. */
export function MagnitudeBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--pv-line)]">
      <span
        className="block h-full rounded-full bg-[var(--pv-accent)]"
        style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
      />
    </span>
  );
}
