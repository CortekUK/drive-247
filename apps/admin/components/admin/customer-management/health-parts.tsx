'use client';

/**
 * The pieces that draw a customer health score: band colours, the score chip
 * and the breakdown of how the score is made. Shared by Customer Management →
 * Customer Health and a company's own page.
 */

import { cn } from '@/lib/utils';
import type { HealthBand, HealthResult } from '@/lib/customer-health/score';

export const BAND: Record<HealthBand, { label: string; dot: string; text: string; chipBg: string; fill: string }> = {
  critical: {
    label: 'Critical',
    dot: 'bg-red-500',
    text: 'text-red-600',
    chipBg: 'bg-destructive/15 border-destructive/30',
    fill: 'hsl(var(--destructive))',
  },
  at_risk: {
    label: 'At risk',
    dot: 'bg-amber-500',
    text: 'text-amber-600',
    chipBg: 'bg-warning/15 border-warning/30',
    fill: 'hsl(var(--warning))',
  },
  healthy: {
    label: 'Healthy',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600',
    chipBg: 'bg-success/15 border-success/30',
    fill: 'hsl(var(--success))',
  },
};

export function BandChip({ band, score }: { band: HealthBand; score?: number }) {
  const b = BAND[band];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold', b.chipBg, b.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', b.dot)} />
      {score !== undefined ? <span className="tabular-nums">{score}</span> : b.label}
    </span>
  );
}

/** What the band means, then the four parts the score is made of. */
export function HealthBreakdown({ health }: { health: HealthResult }) {
  return (
    <>
      <div className={cn('rounded-2xl border p-3', BAND[health.band].chipBg)}>
        <p className={cn('mb-1 text-xs font-bold uppercase tracking-wide', BAND[health.band].text)}>{BAND[health.band].label}</p>
        <p className="text-foreground/80">
          {health.band === 'critical'
            ? 'Likely to leave. Call them before they cancel.'
            : health.band === 'at_risk'
              ? 'Slipping. Worth a check-in.'
              : 'Using Drive247 and paying. Nothing to do.'}
          {health.ageDays < 14 && ` Signed up ${health.ageDays} days ago, so there is little history yet.`}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">How the score is made</p>
        {(
          [
            ['Logins', health.parts.logins],
            ['Bookings', health.parts.bookings],
            ['Payment', health.parts.payment],
            ['Setup', health.parts.setup],
          ] as const
        ).map(([name, part]) => (
          <div key={name} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{name}</span>
              <span className={cn('font-semibold tabular-nums', part.concern ? 'text-red-600' : 'text-emerald-600')}>
                {part.points} / {part.max}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', part.concern ? 'bg-red-500' : 'bg-emerald-500')}
                style={{ width: `${(part.points / part.max) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{part.label}</p>
          </div>
        ))}
      </div>
    </>
  );
}
