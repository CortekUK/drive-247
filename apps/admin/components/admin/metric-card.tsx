'use client';

/**
 * A metric, in the v2 card idiom the operator portal uses everywhere.
 *
 * Extracted from the dashboard page so it is a component other admin screens
 * can reach for, and so the design can be looked at without signing in — see
 * `app/admin/preview`.
 *
 * ── What the idiom is ─────────────────────────────────────────────────────
 *
 * `rounded-4xl`, a `bg-card` surface, a hairline `ring-1 ring-foreground/5`
 * instead of a border, and colour as an ACCENT on a small mark rather than a
 * wash over the whole card.
 *
 * This card used to paint its entire surface in one of seven literal Tailwind
 * hues — blue, green, purple, yellow, indigo, cyan, emerald, one per metric.
 * Two things were wrong with that. Seven full-card washes are seven equal
 * shouts, so nothing on the row leads; and a literal palette entry does not
 * move when the brand does, which is why `primary` and `indigo-600` being the
 * same colour today is a coincidence rather than a rule. `accent` names a
 * TOKEN, so these follow the brand.
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MetricAccent = 'brand' | 'success' | 'warning' | 'info';

const ACCENT: Record<MetricAccent, string> = {
  brand: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]',
};

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = 'brand',
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  accent?: MetricAccent;
}) {
  return (
    <div className="rounded-4xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl', ACCENT[accent])}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
      {/* The number is the point, so it is ink rather than a seventh colour. */}
      <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
