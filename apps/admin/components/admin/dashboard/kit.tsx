'use client';

/**
 * The dashboard's parts, ported from the Northwind operator home
 * (apps/portal/src/components/dashboard-v2/home/ui.tsx) so the two read as one
 * product: the `.pv` palette, a flat hairline card with an eyebrow title, rows
 * that end in a right-aligned CLOCK column, and a footer link pinned to the
 * card's floor.
 *
 * Colour is reserved for state — `late` / `wait` / `clear` — and never used as
 * decoration; the accent is the theme's primary.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Scoped to `.pv`; values come from the admin theme tokens in globals.css. */
export const DASH_PALETTE = `
  .pv {
    --pv-paper: hsl(var(--card));
    --pv-wash: color-mix(in srgb, hsl(var(--foreground)) 3%, hsl(var(--card)));
    --pv-line: hsl(var(--border));
    --pv-line-2: color-mix(in srgb, hsl(var(--foreground)) 16%, hsl(var(--card)));
    --pv-ink: hsl(var(--foreground));
    --pv-ink-2: color-mix(in srgb, hsl(var(--foreground)) 72%, hsl(var(--card)));
    --pv-ink-3: hsl(var(--muted-foreground));
    --pv-accent: hsl(var(--primary));
    --pv-accent-ink: hsl(var(--primary));
    --pv-accent-bg: color-mix(in srgb, hsl(var(--primary)) 11%, hsl(var(--card)));
    --pv-late: #d93025;
    --pv-wait: #b45309;
    --pv-clear: #12a594;
  }
  /* Dark: brand ink in the lighter link step, status inks lifted to read on
     the soft dark card (Northwind's dark palette). */
  .dark .pv {
    --pv-accent-ink: hsl(var(--v2-link));
    --pv-late: #f87171;
    --pv-wait: #fbbf24;
    --pv-clear: #2dd4bf;
  }
`;

export type Tone = 'late' | 'wait' | 'clear' | 'idle';

const INK: Record<Tone, string> = {
  late: 'text-[var(--pv-late)]',
  wait: 'text-[var(--pv-wait)]',
  clear: 'text-[var(--pv-ink-3)]',
  idle: 'text-[var(--pv-ink-3)]',
};

const DOT: Record<Tone, string> = {
  late: 'bg-[var(--pv-late)]',
  wait: 'bg-[var(--pv-wait)]',
  clear: 'bg-[var(--pv-clear)]',
  idle: 'bg-[var(--pv-line-2)]',
};

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--pv-ink-3)]', className)}>
      {children}
    </span>
  );
}

export function Card({
  title,
  count,
  children,
  className,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[292px] flex-col overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)]',
        className,
      )}
    >
      <header className="flex items-baseline gap-2 px-6 pb-3 pt-5">
        <Eyebrow>{title}</Eyebrow>
        {count !== undefined && (
          <span className="text-[11px] font-medium tabular-nums text-[var(--pv-ink-2)]">{count}</span>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** A worklist row: state dot, title, meta line, then the clock. */
export function Row({
  title,
  meta,
  clock,
  tone = 'idle',
  href,
  newTab = false,
}: {
  title: string;
  meta?: string | null;
  clock: string;
  tone?: Tone;
  href?: string;
  /** Open in its own browser tab (Support). */
  newTab?: boolean;
}) {
  const body = (
    <>
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--pv-ink)]">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-[11.5px] text-[var(--pv-ink-3)]">{meta}</span>}
      </span>
      <span className={cn('w-[52px] shrink-0 text-right text-[11.5px] font-medium tabular-nums tracking-tight', INK[tone])}>
        {clock}
      </span>
    </>
  );
  const cls =
    'flex w-full items-center gap-3 px-6 py-2.5 text-left [transition:background-color_200ms_ease-in] hover:bg-[var(--pv-wash)] hover:[transition:background-color_200ms_ease-out] motion-reduce:transition-none';
  return href ? (
    <Link href={href} className={cls} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The link every list card ends on, pinned to the bottom edge. */
export function CardFooter({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="group mt-auto flex w-full items-center gap-2.5 border-t border-[var(--pv-line)] px-6 py-3.5 text-left [transition:background-color_200ms_ease-in] hover:bg-[var(--pv-wash)] hover:[transition:background-color_200ms_ease-out] motion-reduce:transition-none"
    >
      <span className="flex-1 text-[12px] text-[var(--pv-ink-3)] group-hover:text-[var(--pv-ink-2)]">{label}</span>
      <span className="text-[12px] text-[var(--pv-ink-3)] group-hover:text-[var(--pv-accent-ink)]">→</span>
    </Link>
  );
}

/** A card with nothing in it says so in one quiet line, centred. */
export function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-1 items-center justify-center px-6 pb-6 text-center text-[13px] text-[var(--pv-ink-3)]">
      {children}
    </p>
  );
}

/** Placeholder rows while a card loads. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-6 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="size-1.5 rounded-full bg-[var(--pv-line-2)]" />
          <span className="h-3 flex-1 animate-pulse rounded bg-[var(--pv-wash)] motion-reduce:animate-none" />
          <span className="h-3 w-10 animate-pulse rounded bg-[var(--pv-wash)] motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** "now", "12m", "5h", "3d", "6w", "4mo" — how long ago, in the clock column's width. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

export function usd(n: number, cents = false): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
}
