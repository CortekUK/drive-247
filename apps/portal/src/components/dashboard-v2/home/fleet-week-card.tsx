'use client';

/**
 * "Your cars, next 7 days" — one row per car, one cell per day.
 *
 * The question it answers is whether each car can actually do the work booked
 * on it this week. A car can look fine in the vehicles list and still be out
 * on a lapsed inspection, double-booked on Saturday, or still with last week's
 * customer. Each row carries at most one flag, the worst one, so the card reads
 * top-down as a to-do list: cars are sorted by how bad their flag is.
 *
 * Data: `useFleetWeek` (tenant-filtered). This component issues no query.
 */

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { DayUse, FleetCar } from '@/hooks/use-fleet-week';
import { weekday } from '@/hooks/use-fleet-week';
import { Card, CardFooter } from './ui';
import { MarginNote } from './margin-note';

const CELL: Record<DayUse, string> = {
  free: 'bg-[var(--pv-wash)] border border-[var(--pv-line)]',
  booked: 'bg-[var(--pv-accent)]',
  // Booked but not approved yet: the car is spoken for, the money is not.
  held: 'bg-[var(--pv-accent-bg)] border border-[var(--pv-accent-30)]',
  late: 'bg-[var(--pv-late-bg)] border border-[var(--pv-late)]',
  clash: 'bg-[var(--pv-late)]',
};

const FLAG_INK = {
  late: 'text-[var(--pv-late)]',
  waiting: 'text-[var(--pv-wait)]',
  idle: 'text-[var(--pv-ink-3)]',
} as const;

function note(cars: FleetCar[]): string | null {
  const lapsed = cars.find((c) => c.rank === 0);
  if (lapsed) {
    return `${lapsed.name} (${lapsed.reg}) is working on a lapsed ${lapsed.flag!.text.startsWith('Inspection') ? 'inspection' : 'registration'}. I'd renew that before anything else this week.`;
  }
  const clash = cars.find((c) => c.rank === 2 || c.days.includes('clash'));
  if (clash) return `${clash.name} has two bookings on the same day. One of those customers needs another car.`;
  const idle = cars.filter((c) => c.freeDays === c.days.length);
  const freeDays = cars.reduce((n, c) => n + c.freeDays, 0);
  if (idle.length > 0) {
    return `${freeDays} car-days are free this week, ${idle.length === 1 ? `${idle[0].name} has` : `${idle.length} cars have`} nothing booked at all. A weekday discount might fill them.`;
  }
  if (freeDays === 0 && cars.length > 0) return 'Every car is working every day this week.';
  return null;
}

export function FleetWeekCard({
  cars,
  days,
  isLoading,
  className,
}: {
  cars: FleetCar[];
  days: string[];
  isLoading: boolean;
  className?: string;
}) {
  const router = useRouter();
  const problems = cars.filter((c) => c.rank <= 4).length;
  const total = cars.length * days.length;
  const used = cars.reduce((n, c) => n + (c.days.length - c.freeDays), 0);
  const utilisation = total ? Math.round((used / total) * 100) : 0;
  const trax = note(cars);

  return (
    <Card
      title="Your cars, next 7 days"
      count={problems ? `${problems} need a look` : undefined}
      className={className}
    >
      {isLoading ? (
        <div className="mx-6 mb-6 flex-1 animate-pulse rounded-xl bg-[var(--pv-wash)]" />
      ) : cars.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--pv-ink-3)]">No cars in the fleet yet.</p>
      ) : (
        <>
          {/* Day header, aligned to the cells below. */}
          <div className="flex items-end gap-4 px-6 pb-2">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                {utilisation}%
              </span>
              <span className="text-[11px] text-[var(--pv-ink-3)]">of car-days booked</span>
            </div>
            <div className="hidden w-[196px] shrink-0 grid-cols-7 gap-1 sm:grid">
              {days.map((d, i) => (
                <span
                  key={d}
                  className={cn(
                    'text-center text-[10px] font-medium',
                    i === 0 ? 'text-[var(--pv-accent-ink)]' : 'text-[var(--pv-ink-3)]'
                  )}
                >
                  {i === 0 ? 'Today' : weekday(d).slice(0, 2)}
                </span>
              ))}
            </div>
            <span className="hidden w-[150px] shrink-0 md:block" />
          </div>

          <div className="divide-y divide-[var(--pv-line)] border-t border-[var(--pv-line)]">
            {cars.map((car) => (
              <button
                key={car.id}
                type="button"
                onClick={() => router.push(`/vehicles/${car.id}`)}
                className="flex w-full items-center gap-4 px-6 py-2.5 text-left transition-colors hover:bg-[var(--pv-wash)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium leading-tight">{car.name}</span>
                  <span className="block truncate text-[11px] leading-tight text-[var(--pv-ink-3)]">{car.reg}</span>
                </span>
                <span className="hidden w-[196px] shrink-0 grid-cols-7 gap-1 sm:grid" aria-hidden="true">
                  {car.days.map((u, i) => (
                    <span key={i} className={cn('h-5 rounded-[5px]', CELL[u])} />
                  ))}
                </span>
                <span
                  className={cn(
                    'w-[150px] shrink-0 truncate text-right text-[11.5px] font-medium',
                    car.flag ? FLAG_INK[car.flag.tone] : 'text-[var(--pv-ink-3)]'
                  )}
                >
                  {car.flag?.text ?? `${car.freeDays} free ${car.freeDays === 1 ? 'day' : 'days'}`}
                </span>
              </button>
            ))}
          </div>

          {/* Key, only for the two cell styles that are not obvious. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pt-3 text-[10.5px] text-[var(--pv-ink-3)]">
            <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-[3px]', CELL.booked)} />Out</span>
            <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-[3px]', CELL.held)} />Awaiting approval</span>
            <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-[3px]', CELL.late)} />Not back</span>
            <span className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-[3px]', CELL.clash)} />Double-booked</span>
          </div>

          {trax && <MarginNote>{trax}</MarginNote>}
          <CardFooter label="Go to vehicles" onClick={() => router.push('/vehicles')} />
        </>
      )}
    </Card>
  );
}
