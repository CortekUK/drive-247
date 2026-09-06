'use client';

/**
 * Insights — shared furniture and the ONE chart palette.
 *
 * Every colour any chart on this page draws with is declared here and nowhere
 * else. Re-declaring a hex inside a chart component is how two charts end up
 * calling the same category two different colours, and how a theme change fixes
 * one chart and misses the other.
 */

import type { CSSProperties, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
 * Palette
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every entry carries an explicit light AND dark value. `ui/chart.tsx` supports
 * exactly this shape — it emits `--color-<key>` under `[data-chart]` for light
 * and under `.dark [data-chart]` for dark — so a mode swap is a token swap, not
 * an automatic lightening of the same hex against a black card.
 *
 * The v2 theme's own `--chart-1..5` are deliberately NOT used for anything with
 * category identity. They are a five-step INDIGO RAMP (h 230→248), which is a
 * sequential scale: adjacent steps sit ~6 ΔE apart, below the ≥15 normal-vision
 * floor, so two revenue categories next to each other in a donut would be
 * genuinely indistinguishable. They are used below only where the scale really
 * is ordinal — the ageing buckets — which is what a sequential ramp is for.
 */

export type ChartColor = { light: string; dark: string };

/**
 * The two sides of the operating P&L, plus the answer.
 *
 * Revenue takes the brand indigo — it is the page's one accent. Cost takes a
 * warm orange: it reads as money leaving without being alarming, and the
 * indigo↔orange pair clears the CVD and normal-vision separation floors in both
 * modes. Net profit is drawn in plain ink rather than green, because the line
 * goes below zero and a green line at −$4,000 quietly congratulates the
 * operator on a loss.
 */
export const MONEY_COLORS = {
  revenue: { light: '#442dd7', dark: '#6461ff' },
  cost: { light: '#eb6834', dark: '#d95926' },
  profit: { light: '#0f172a', dark: '#f1f5f9' },
} satisfies Record<string, ChartColor>;

/**
 * Categorical slots for the revenue mix, indigo first so the dominant slice is
 * the brand colour. Assigned in fixed order and never cycled — a sixth
 * category folds into "Other" (see `foldMix`) rather than reusing a hue.
 *
 * Validated in both modes: worst adjacent CVD ΔE 9.1 light / 8.4 dark (≥8
 * target), worst adjacent normal-vision ΔE 19.6 light / 19.3 dark (≥15 floor).
 * Three of the light steps sit under 3:1 against a white card, which obliges
 * visible labels — hence the legend beside the donut naming every slice with
 * its amount and share, so identity never rests on the colour alone.
 */
export const MIX_COLORS: ChartColor[] = [
  { light: '#442dd7', dark: '#6461ff' },
  { light: '#eb6834', dark: '#d95926' },
  { light: '#1baf7a', dark: '#199e70' },
  { light: '#eda100', dark: '#c98500' },
  { light: '#e87ba4', dark: '#d55181' },
];

/** The tail slice. Neutral by design: "Other" is an absence of identity. */
export const OTHER_COLOR: ChartColor = { light: '#94a3b8', dark: '#64748b' };

/**
 * Ageing buckets — genuinely ordinal, so genuinely sequential.
 *
 * Light → dark as the debt gets older, from the v2 theme's own indigo ramp.
 * Deliberately not a green→red status scale: this page reports what is owed, it
 * does not grade the operator's collections, and four bars each carrying its own
 * axis label and value need no colour to be told apart.
 */
export const AGING_COLORS: ChartColor[] = [
  { light: '#a3b2ff', dark: '#a3b2ff' },
  { light: '#6461ff', dark: '#6461ff' },
  { light: '#442dd7', dark: '#513bf7' },
  { light: '#372aac', dark: '#442dd7' },
];

/** Diverging pair for profit-per-vehicle. Real polarity: made money / lost money. */
export const PROFIT_COLORS = {
  positive: { light: '#16a249', dark: '#28e26c' },
  negative: { light: '#e6000b', dark: '#ff6669' },
} satisfies Record<string, ChartColor>;

/* ────────────────────────────────────────────────────────────────────────────
 * Furniture
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One chart panel.
 *
 * Owns the three states a panel can be in — loading, empty, populated — so no
 * chart component has to remember to handle them and none of them can render a
 * bare axis frame with nothing in it. `isEmpty` is passed in rather than
 * inferred, because "the array is length 0" and "every value in it is 0" are
 * both empty and only the caller knows which applies.
 */
export function Panel({
  title,
  description,
  loading,
  isEmpty,
  emptyMessage,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('h-full', className)}>
      <CardHeader className={action ? 'has-[[data-slot=card-action]]:grid-cols-[1fr_auto]' : undefined}>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : isEmpty ? (
          <EmptyState message={emptyMessage ?? 'No data yet.'} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What a card shows instead of a chart when there is nothing to draw.
 *
 * A blank chart frame — axes, gridlines, no marks — reads as a page that failed
 * to load. A sentence reads as a business that has not done the thing yet,
 * which for a new tenant is the truth and is not an error.
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center rounded-3xl bg-muted/40 px-6 text-center">
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * A colour chip that follows the theme.
 *
 * Legends live in the card header and beside the chart — OUTSIDE
 * `ChartContainer`, so the `--color-*` variables `ui/chart.tsx` emits (scoped to
 * `[data-chart=…]`) are not in scope here. Rather than hardcoding the light hex
 * and letting every legend on the page go wrong in dark mode, both values are
 * set as custom properties and Tailwind's `dark:` variant picks between them.
 */
export function Swatch({
  color,
  shape = 'dot',
  className,
}: {
  color: ChartColor;
  shape?: 'dot' | 'line';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'shrink-0 bg-[var(--sw-light)] dark:bg-[var(--sw-dark)]',
        shape === 'line' ? 'h-0.5 w-3.5 rounded-full' : 'size-2.5 rounded-full',
        className,
      )}
      style={{ '--sw-light': color.light, '--sw-dark': color.dark } as CSSProperties}
    />
  );
}

/** A legend row: swatch, name, and the value. Never colour on its own. */
export function LegendRow({
  color,
  label,
  value,
  meta,
}: {
  color: ChartColor;
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <Swatch color={color} />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums font-medium">{value}</span>
      {meta ? (
        <span className="w-10 shrink-0 text-right tabular-nums text-xs text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </div>
  );
}
