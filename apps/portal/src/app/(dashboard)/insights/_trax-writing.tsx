'use client';

/**
 * Insights — "Trax is writing your review", the 30–60 seconds of show.
 *
 * Cards pop in at the edge, wind back — an exaggerated anticipation — and are
 * yanked into the report sheet in the middle, which writes itself line by line
 * as they land. Under it, a ticker says what Trax is reading, in the
 * operator's numbers, and a progress bar creeps toward done.
 *
 * The cards are not a loop of the same six. Six SLOTS animate, and every time
 * a slot comes round it carries the next card from a pool built from the
 * operator's real facts — figures (took in, kept, owed…) AND written notes
 * Trax "noticed" (best month, busiest weekday, top car, repeat customers, idle
 * cars…). A 30–60s wait therefore keeps showing something new instead of the
 * same six tiles. The swap happens while a slot is invisible (the tail of its
 * cycle), so a card never changes under the eye.
 *
 * A loader, so outside the app's 200ms rule (continuous animation is the
 * stated exception). `prefers-reduced-motion` gets the same scene, still.
 * Keyframes are scoped by a per-instance prefix so nothing leaks.
 */

import { useEffect, useId, useState, type CSSProperties } from 'react';
import { CalendarDays, CarFront, CreditCard, Gauge, HandCoins, PenLine, PiggyBank, Receipt, Sparkles, Users } from 'lucide-react';
import { TraxMark } from '@/components/trax/trax-greeting';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

type Facts = {
  currency?: string;
  receipt?: { tookIn?: number; spent?: number; kept?: number };
  keptPercentOfTookIn?: number | null;
  fleet?: { cars?: number; utilisationPercent?: number | null };
  bookings?: {
    total?: number;
    averageLengthDays?: number | null;
    upcomingBookings?: number;
    cancellationRatePercent?: number | null;
    startsByWeekday?: Record<string, number>;
  };
  customers?: { renting?: number; repeatCustomers?: number };
  owedAsOfToday?: { total?: number; customers?: number };
  momentum?: { bestMonth?: string | null };
  fleetDetail?: { car: string; kept: number }[];
  idleCarsAllPeriod?: string[];
  cash?: { byMethod?: { method: string; amount: number }[] };
} | null;

/** A pool entry: a figure, or a sentence Trax "noticed". */
type Card =
  | { kind: 'stat'; icon: typeof CalendarDays; label: string; value: string }
  | { kind: 'note'; text: string };

/** Slot positions around the sheet, mirrored left/right so the scene is centred. */
const SLOTS = [
  { x: -48, y: -36 },
  { x: 48, y: -36 },
  { x: -52, y: 2 },
  { x: 52, y: 2 },
  { x: -46, y: 38 },
  { x: 46, y: 38 },
];

const LOOP = 3.6; // seconds per card cycle

export function TraxWriting({ facts }: { facts: unknown }) {
  const f = (facts ?? null) as Facts;
  const k = useId().replace(/:/g, '');
  const money = (n?: number) =>
    formatCurrency(n ?? 0, f?.currency ?? 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const pool: Card[] = (() => {
    const out: Card[] = [];
    const stat = (icon: typeof CalendarDays, label: string, value: string) => out.push({ kind: 'stat', icon, label, value });
    const note = (text: string | null | false | undefined) => { if (text) out.push({ kind: 'note', text }); };

    const weekdays = Object.entries(f?.bookings?.startsByWeekday ?? {});
    const busiest = weekdays.length ? weekdays.reduce((b, x) => (x[1] > b[1] ? x : b)) : null;
    const topCar = f?.fleetDetail?.[0];
    const topMethod = [...(f?.cash?.byMethod ?? [])].sort((a2, b2) => b2.amount - a2.amount)[0];
    const idle = f?.idleCarsAllPeriod?.length ?? 0;

    /* Interleaved figure, note, figure, note… so neighbouring slots differ. */
    stat(CalendarDays, 'Bookings', `${f?.bookings?.total ?? 0}`);
    note(f?.momentum?.bestMonth && `${f.momentum.bestMonth} was your best month`);
    stat(HandCoins, 'Took in', money(f?.receipt?.tookIn));
    note(busiest && busiest[1] > 0 && `${busiest[0]} is when most rentals start`);
    stat(CarFront, 'Cars', `${f?.fleet?.cars ?? 0}`);
    note(topCar && topCar.kept > 0 && `${topCar.car} earns you the most`);
    stat(Receipt, 'Costs', money(f?.receipt?.spent));
    note((f?.customers?.repeatCustomers ?? 0) > 0 && `${f!.customers!.repeatCustomers} customers came back for more`);
    stat(Users, 'Customers', `${f?.customers?.renting ?? 0}`);
    note(f?.bookings?.averageLengthDays != null && `A typical rental runs ${f.bookings.averageLengthDays} days`);
    stat(PiggyBank, 'Kept', money(f?.receipt?.kept));
    note(idle > 0 && `${idle} car${idle === 1 ? '' : 's'} sat idle all period`);
    stat(CreditCard, 'Owed', money(f?.owedAsOfToday?.total));
    note((f?.bookings?.upcomingBookings ?? 0) > 0 && `${f!.bookings!.upcomingBookings} bookings already on the books`);
    stat(Gauge, 'Fleet busy', f?.fleet?.utilisationPercent != null ? `${f.fleet.utilisationPercent}%` : '—');
    note(topMethod && `Most of your money arrives by ${topMethod.method.toLowerCase()}`);
    note(f?.keptPercentOfTookIn != null && `You keep ${f.keptPercentOfTookIn}% of what comes in`);
    note(f?.bookings?.cancellationRatePercent != null && `${f.bookings.cancellationRatePercent}% of bookings were cancelled`);
    return out;
  })();

  const lines = [
    `Reading your ${f?.bookings?.total ?? 0} bookings, one by one`,
    `Going through ${f?.fleet?.cars ?? 0} cars, day by day`,
    `Following ${money(f?.receipt?.tookIn)} through your books`,
    `Getting to know your ${f?.customers?.renting ?? 0} customers`,
    `Checking who still owes you ${money(f?.owedAsOfToday?.total)}`,
    'Comparing you with healthy rental fleets',
    'Weighing what you kept against what it cost',
    'Drafting your 30 / 60 / 90-day plan',
    'Choosing your customer of the period',
    'Putting the finishing touches on your review',
  ];

  const [tick, setTick] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const a = window.setInterval(() => setTick((t) => t + 1), 2600);
    const b = window.setInterval(() => setElapsed((e) => e + 0.25), 250);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, []);
  // Creeps toward 96% over about a minute and never claims to be done.
  const progress = Math.min(96, 100 * (1 - Math.exp(-elapsed / 22)));

  return (
    <div className="relative mx-auto flex h-full min-h-[520px] w-full flex-col items-center justify-center overflow-hidden">
      <style>{`
        @keyframes ${k}-pull {
          0%   { transform: translate(-50%, -50%) translate(var(--x), var(--y)) scale(.4) rotate(var(--r)); opacity: 0 }
          10%  { transform: translate(-50%, -50%) translate(var(--x), var(--y)) scale(1.12) rotate(calc(var(--r) * -1)); opacity: 1 }
          20%  { transform: translate(-50%, -50%) translate(var(--x), var(--y)) scale(1) rotate(0deg) }
          46%  { transform: translate(-50%, -50%) translate(calc(var(--x) * 1.18), calc(var(--y) * 1.18)) scale(1.06) rotate(var(--r)) }
          70%  { transform: translate(-50%, -50%) translate(0, 0) scale(.28) rotate(calc(var(--r) * -3)); opacity: .95 }
          76%, 100% { transform: translate(-50%, -50%) translate(0, 0) scale(.05); opacity: 0 }
        }
        @keyframes ${k}-gulp {
          0%, 100% { transform: scale(1) }
          50%      { transform: scale(1.035) }
        }
        @keyframes ${k}-write {
          0%   { transform: scaleX(0) }
          60%  { transform: scaleX(1) }
          100% { transform: scaleX(1) }
        }
        @keyframes ${k}-glow {
          0%, 100% { opacity: .35; transform: scale(.92) }
          50%      { opacity: .7;  transform: scale(1.08) }
        }
        @keyframes ${k}-sparkle {
          0%, 100% { transform: rotate(0deg) scale(1) }
          50%      { transform: rotate(18deg) scale(1.15) }
        }
        @keyframes ${k}-in {
          from { opacity: 0; transform: translateY(8px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @media (prefers-reduced-motion: reduce) {
          .${k}-anim { animation: none !important }
          .${k}-card { opacity: 1 !important; transform: translate(-50%, -50%) translate(var(--x), var(--y)) !important }
          .${k}-line { transform: scaleX(1) !important }
        }
      `}</style>

      {/* The stage: cards around, the sheet in the middle. */}
      {/* Height from the viewport, not an aspect ratio: at 4:3 the stage was
          taller than the frame and pushed the ticker off the bottom. */}
      <div className="relative mx-auto h-[min(500px,56vh)] w-full max-w-[720px] shrink-0">
        {/* soft accent glow behind the sheet */}
        {/* Centring and animation live on different elements: an animated
            `transform: scale()` replaces the element's whole transform, so
            on one element it wiped out the -50% centring and the scene sat
            right of and below the middle. */}
        <div aria-hidden className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className={cn(`${k}-anim`, 'size-[340px] rounded-full bg-primary/25 blur-3xl')}
            style={{ animation: `${k}-glow 2.6s ease-in-out infinite` }}
          />
        </div>

        {/* the report sheet */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className={cn(
            `${k}-anim`,
            'w-[230px] rounded-3xl bg-card p-5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10',
          )}
          style={{ animation: `${k}-gulp ${LOOP / 2}s ease-in-out infinite` }}
        >
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Sparkles
                className={cn(`${k}-anim`, 'size-3.5')}
                style={{ animation: `${k}-sparkle 1.6s ease-in-out infinite` }}
                aria-hidden
              />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold">Business review</p>
              <p className="text-[10px] text-muted-foreground">by Trax</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {[92, 70, 84, 58, 88, 64, 76, 50, 80].map((w, i) => (
              <div key={i} className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.05]">
                <div
                  className={cn(`${k}-anim ${k}-line`, 'h-full origin-left rounded-full', i % 4 === 0 ? 'bg-primary' : 'bg-primary/35')}
                  style={{
                    width: `${w}%`,
                    animation: `${k}-write ${LOOP * 1.5}s cubic-bezier(.22,1,.36,1) ${i * 0.35}s infinite`,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        </div>

        {/* the cards, yanked into the sheet one after another — six slots,
            each carrying the next card from the pool every time round */}
        {SLOTS.map((slot, i) => {
          const delay = i * (LOOP / SLOTS.length);
          const cycle = Math.max(0, Math.floor((elapsed - delay) / LOOP));
          const c = pool.length ? pool[(i + cycle * SLOTS.length) % pool.length] : null;
          if (!c) return null;
          return (
            <div
              key={i}
              className={cn(`${k}-anim ${k}-card`, 'absolute top-1/2 left-1/2 opacity-0')}
              style={
                {
                  '--x': `${slot.x * 4.6}px`,
                  '--y': `${slot.y * 3.0}px`,
                  '--r': `${i % 2 ? 7 : -7}deg`,
                  animation: `${k}-pull ${LOOP}s cubic-bezier(.68,-0.55,.27,1.55) ${delay}s infinite`,
                } as CSSProperties
              }
            >
              {c.kind === 'stat' ? (
                <div className="flex items-center gap-2.5 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_12px_30px_-12px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10">
                  <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                    <c.icon className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{c.label}</p>
                    <p className="text-sm font-semibold tabular-nums">{c.value}</p>
                  </div>
                </div>
              ) : (
                /* A written note: what Trax noticed, in a sentence. */
                <div className="w-[200px] rounded-2xl bg-card px-3.5 py-3 shadow-[0_12px_30px_-12px_rgb(0_0_0/0.35)] ring-1 ring-primary/20">
                  <p className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                    <PenLine className="size-3" aria-hidden />
                    Trax noticed
                  </p>
                  <p className="mt-1 text-[12.5px] font-medium leading-snug text-foreground">{c.text}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* What Trax is doing, in the operator's numbers — the line the eye
          should land on, so it is set large, beside the Trax mark. */}
      <div className="mt-4 flex w-full max-w-xl flex-col items-center text-center">
        <div className="flex min-h-[32px] items-center justify-center gap-2.5">
          <TraxMark size="sm" animated />
          <p
            key={tick}
            className={cn(`${k}-anim`, 'text-[20px] font-semibold tracking-tight text-foreground')}
            style={{ animation: `${k}-in .35s ease-out both` }}
            aria-live="polite"
          >
            {lines[tick % lines.length]}…
          </p>
        </div>
        <div className="mx-auto mt-4 h-1.5 w-80 max-w-full overflow-hidden rounded-full bg-foreground/[0.07]">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          This takes about a minute. I'm reading everything, so it's worth the wait.
        </p>
      </div>
    </div>
  );
}
