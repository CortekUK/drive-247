'use client';

/**
 * "The day" — the full-width card at the top of "Today".
 *
 * Everything that happens to the business across the day, on one time axis:
 * cars going out and coming back, payment reminders, extension charges,
 * installments, lockbox codes — each done, missed or still to come.
 *
 * Drawn as a Gantt chart (`day-gantt.tsx`). Several designs were built and
 * compared on Sep 26 2026 — a line of pins, labelled lanes, stacked bars,
 * vertical tiles — and Ghulam chose the Gantt; the others were deleted.
 *
 * Fits the card on every normal screen; only below 640px does it scroll
 * sideways.
 *
 * Data: `useDayTimeline` (tenant-filtered on every query). This component
 * issues no query of its own.
 */

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DayEvent, DayEventKind } from '@/hooks/use-day-timeline';
import { useDayTimeline } from '@/hooks/use-day-timeline';
import { CarMascot } from './car-mascot';
import { buildDemoDay } from './mock';
import { DayGantt, MONEY_KINDS, dayAxis } from './day-gantt';

export function DayTimeline({
  canSeeRentals,
  canSeePayments,
}: {
  canSeeRentals: boolean;
  canSeePayments: boolean;
}) {
  const router = useRouter();
  const live = useDayTimeline();
  // PREVIEW (Sep 26 2026): a made-up day showing every kind of event in every
  // state is ON BY DEFAULT while the design is reviewed; `?demo-day=0` shows
  // the real day. Client-side only — nothing is read or written. Flip the
  // default back to real data (`=== '1'`) before this widens past the canary.
  const demo = useSearchParams()?.get('demo-day') !== '0';
  const timeline = useMemo(() => {
    if (!demo) return live.timeline;
    // A fixed early-afternoon NOW, so the sample always shows a morning of
    // history and an afternoon still to come, whatever the reviewer's clock.
    const now = 13 * 60 + 10;
    return { events: buildDemoDay(now), today: 'demo', nowMinutes: now, open: 8 * 60, close: 20 * 60, timezone: 'local' };
  }, [demo, live.timeline]);
  const isLoading = !demo && live.isLoading;
  const isError = !demo && live.isError;

  const canSee = (kind: DayEventKind) => (MONEY_KINDS.includes(kind) ? canSeePayments : canSeeRentals);
  const events = useMemo(
    () => (timeline?.events ?? []).filter((e) => canSee(e.kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, canSeeRentals, canSeePayments]
  );
  const timed = useMemo(() => events.filter((e) => e.at !== null), [events]);
  const axis = dayAxis(timed, timeline?.nowMinutes ?? 0, timeline?.open, timeline?.close);


  const onOpen = (e: DayEvent) => (e.rentalId ? () => router.push(`/rentals/${e.rentalId}`) : undefined);

  return (
    <div
      data-day-timeline=""
      className="flex flex-col overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] md:col-span-2"
      // A very soft indigo wash across the whole card, fading to paper — the
      // accent's presence without a fill that competes with the bars.
      style={{
        backgroundImage:
          'linear-gradient(160deg, color-mix(in srgb, var(--pv-accent) 7%, var(--pv-paper)) 0%, var(--pv-paper) 55%, color-mix(in srgb, var(--pv-accent) 4%, var(--pv-paper)) 100%)',
      }}
    >
      {/* No header (Sep 27 2026, at Ghulam's request): the band title above
          says what this is, and the chart starts at the top edge. */}

      {isLoading ? (
        <div
          aria-hidden="true"
          className="mx-6 my-6 h-[72px] animate-pulse rounded-xl bg-[var(--pv-wash)] motion-reduce:animate-none"
        />
      ) : isError ? (
        <p className="px-6 py-6 text-[12px] text-[var(--pv-ink-3)]">
          The day could not be loaded. It will try again in a moment.
        </p>
      ) : events.length === 0 ? (
        <div className="flex items-center gap-4 px-6 py-6">
          <CarMascot mood="sleepy" className="size-14 shrink-0" />
          <div>
            <p className="text-sm font-medium">Nothing on the day</p>
            <p className="text-[11px] text-[var(--pv-ink-3)]">
              No cars going out or coming back, and no reminders or charges.
            </p>
          </div>
        </div>
      ) : (
        <DayGantt timed={timed} axis={axis} onOpen={onOpen} />
      )}
    </div>
  );
}
