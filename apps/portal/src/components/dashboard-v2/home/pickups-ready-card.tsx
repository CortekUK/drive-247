'use client';

/**
 * "Ready to drive away?" — every pickup this week, and what stands between the
 * customer and the keys.
 *
 * The four checks are the ones that stop a handover at the counter: approved,
 * agreement signed, ID verified (only when the tenant requires it), paid. An
 * operator usually finds out one is missing when the customer is standing in
 * front of them. Pickups whose date passed while the rental stayed Pending are
 * listed first, because that customer has already been let down once.
 *
 * Data: `useFleetWeek` (tenant-filtered). This component issues no query.
 */

import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Pickup, ReadyCheck } from '@/hooks/use-fleet-week';
import { weekday } from '@/hooks/use-fleet-week';
import { Card, CardFooter } from './ui';
import { CarMascot } from './car-mascot';
import { MarginNote } from './margin-note';

const LABEL: Record<ReadyCheck, string> = {
  approved: 'Approved',
  signed: 'Signed',
  id: 'ID',
  paid: 'Paid',
};

/** What the operator does about each missing check, in a few words. */
const NEXT: Record<ReadyCheck, string> = {
  approved: 'approve the booking',
  signed: 'chase the signature',
  id: 'get their ID verified',
  paid: 'take the payment',
};

const MAX_ROWS = 5;

function when(p: Pickup): { text: string; late: boolean } {
  if (p.daysAway < 0) return { text: `${-p.daysAway}d late`, late: true };
  if (p.daysAway === 0) return { text: 'Today', late: false };
  if (p.daysAway === 1) return { text: 'Tomorrow', late: false };
  return { text: weekday(p.startDate), late: false };
}

function note(pickups: Pickup[]): string | null {
  const missed = pickups.find((p) => p.daysAway < 0 && !p.ready);
  const first = (name: string) => name.split(' ')[0];
  if (missed) {
    return `${first(missed.customerName)} was meant to collect ${-missed.daysAway === 1 ? 'yesterday' : `${-missed.daysAway} days ago`}. I'd ${NEXT[missed.missing[0]]} and call them today.`;
  }
  const soon = pickups.find((p) => p.daysAway <= 1 && !p.ready);
  if (soon) {
    return `${first(soon.customerName)} collects ${soon.daysAway === 0 ? 'today' : 'tomorrow'}. ${NEXT[soon.missing[0]][0].toUpperCase()}${NEXT[soon.missing[0]].slice(1)} first.`;
  }
  // The most common gap across the week, so one batch of work clears the most.
  const tally = new Map<ReadyCheck, number>();
  for (const p of pickups) for (const m of p.missing) tally.set(m, (tally.get(m) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 1) return `${top[1]} pickups are waiting on the same thing. I'd ${NEXT[top[0]]} for all of them in one go.`;
  return null;
}

export function PickupsReadyCard({
  pickups,
  isLoading,
  className,
}: {
  pickups: Pickup[];
  isLoading: boolean;
  className?: string;
}) {
  const router = useRouter();
  const notReady = pickups.filter((p) => !p.ready).length;
  const trax = note(pickups);

  return (
    <Card
      title="Ready to drive away?"
      count={pickups.length ? `${notReady} of ${pickups.length} not ready` : undefined}
      className={className}
    >
      {isLoading ? (
        <div className="mx-6 mb-6 flex-1 animate-pulse rounded-xl bg-[var(--pv-wash)]" />
      ) : pickups.length === 0 || notReady === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
          <CarMascot mood="happy" className="mb-2" />
          <p className="text-sm font-medium">
            {pickups.length === 0 ? 'No pickups this week' : 'Every pickup is ready'}
          </p>
          <p className="text-[11px] text-[var(--pv-ink-3)]">
            {pickups.length === 0
              ? 'New bookings will show here with what they still need.'
              : 'Approved, signed, verified and paid.'}
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[var(--pv-line)] border-t border-[var(--pv-line)]">
            {pickups.slice(0, MAX_ROWS).map((p) => {
              const w = when(p);
              return (
                <button
                  key={p.rentalId}
                  type="button"
                  onClick={() => router.push(`/rentals/${p.rentalId}`)}
                  className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-[var(--pv-wash)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium leading-tight">
                      {p.customerName}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--pv-ink-3)]">
                      {p.vehicleName}
                      {p.rentalNumber ? ` · ${p.rentalNumber}` : ''}
                    </span>
                    {/* The checks. A met one is a quiet tick; a missing one is
                        the only coloured thing in the row. */}
                    <span className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
                      {p.checks.map((c) => (
                        <span
                          key={c.key}
                          className={cn(
                            'flex items-center gap-1 text-[10.5px] font-medium',
                            c.ok ? 'text-[var(--pv-ink-3)]' : w.late ? 'text-[var(--pv-late)]' : 'text-[var(--pv-wait)]'
                          )}
                        >
                          {c.ok ? (
                            <Check className="size-3" strokeWidth={3} />
                          ) : (
                            <span className="size-1.5 rounded-full bg-current" />
                          )}
                          {LABEL[c.key]}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'w-[64px] shrink-0 self-start text-right text-[11.5px] font-semibold tabular-nums',
                      p.ready ? 'text-[var(--pv-clear)]' : w.late ? 'text-[var(--pv-late)]' : 'text-[var(--pv-ink-2)]'
                    )}
                  >
                    {p.ready ? 'Ready' : w.text}
                  </span>
                </button>
              );
            })}
          </div>
          {trax && <MarginNote>{trax}</MarginNote>}
          <CardFooter
            label={pickups.length > MAX_ROWS ? `See all ${pickups.length} pickups` : 'Go to rentals'}
            onClick={() => router.push('/rentals')}
          />
        </>
      )}
    </Card>
  );
}
