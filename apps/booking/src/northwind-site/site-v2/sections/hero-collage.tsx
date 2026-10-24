'use client';

/**
 * The home hero's picture: how booking here works, in four numbered beats, in
 * the page's illustration style (ink outlines, the drawn car, the grid floor).
 *
 *   1  the booking on your phone — the operator's real car, its daily price,
 *      the coming weekend as example dates, and the button to book it
 *   2  your licence, checked before you arrive
 *   3  your rental agreement, signed on screen
 *   4  your keys, ready
 *
 * joined by a dashed route in that order. The car's name, type and price are
 * the operator's (`HeroCar`, from the fleet seed); the car itself is drawn, so
 * a mislabelled fleet photo can't put the wrong car in the hero.
 *
 * Everything is sized in `em` off the picture's own width (a container query
 * sets 1em = 1/56 of it), so the whole thing scales as one drawing from a
 * phone to a wide screen.
 *
 * Motion (styles/site.css), all of it still with reduced motion: on load the
 * numbers pop in order 1 → 4 and the signature writes itself; after that the
 * phone and the cards float a few pixels out of step and the route's dashes
 * creep along it, the way the trip goes.
 */

import { Check, IdCard, KeyRound } from 'lucide-react-nw';

import { formatMoney } from '@nw/components/fleet/format';
import { cn } from '@nw/lib/utils';
import { CarFloor, IllustratedCar } from '@nw/site-v2/illustrations/home-scenes';

export type HeroCar = { id: string; name: string; label: string | null; dailyRent: number | null };

const CARD =
  'nw-float absolute rounded-[1.4em] border border-pv-border bg-pv-card px-[1.3em] py-[1.1em] shadow-[0_1.8em_3.6em_-1.6em_rgb(15_15_40/0.35)]';

/** The coming weekend, Friday to Sunday — the example booking's days. */
function weekend() {
  const friday = new Date();
  friday.setDate(friday.getDate() + ((5 - friday.getDay() + 7) % 7 || 7));
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return [day(friday), day(sunday)] as const;
}

/** The beat's number, on the corner of its card. */
function Beat({ n, className }: { n: number; className?: string }) {
  return (
    <span
      className={cn('nw-pop absolute grid size-[2.6em] place-items-center rounded-full bg-pv-fg ring-[0.3em] ring-pv-card', className)}
      // The four pop in order, as the trip goes.
      style={{ '--d': `${0.5 + n * 0.25}s` } as React.CSSProperties}
    >
      <span className="text-[1.2em] font-bold text-pv-bg">{n}</span>
    </span>
  );
}

const Tick = () => (
  <span className="grid size-[2.2em] shrink-0 place-items-center rounded-full bg-pv-success/15 text-pv-success">
    <Check className="size-[1.3em]" strokeWidth={3} />
  </span>
);

export function HeroCollage({ cars, currencyCode, className }: { cars: HeroCar[]; currencyCode: string | null; className?: string }) {
  const car = cars[0];
  const [pickup, dropoff] = weekend();

  return (
    <div aria-hidden className={cn('nw-live relative mx-auto aspect-[560/504] w-full max-w-[560px] [container-type:inline-size]', className)}>
      <div className="absolute inset-0 text-[calc(100cqw/56)]">
        {/* The ground everything stands on: a tinted stage with the page's grid floor. */}
        <div className="absolute bottom-[4%] left-[6%] right-[6%] top-[14%] overflow-hidden rounded-[3.2em] bg-pv-primary/[0.07]">
          <CarFloor className="absolute inset-x-0 bottom-0 h-[55%] w-full text-pv-primary/15" />
        </div>

        {/* The route, 1 → 2 → 3 → 4. */}
        <svg viewBox="0 0 560 504" className="absolute inset-0 h-full w-full text-pv-fg/40" fill="none">
          <g className="nw-flow-slow" stroke="currentColor" strokeWidth="2" strokeDasharray="5 7" strokeLinecap="round">
            <path d="M90 104 C96 70 130 50 182 44" />
            <path d="M398 110 C460 120 490 170 486 236" />
            <path d="M470 336 C470 380 460 400 440 424" />
          </g>
        </svg>

        {/* 1 — the booking, on your phone. */}
        <div className="nw-float absolute left-[18.5em] top-[1.5em] w-[20.5em]" style={{ animationDelay: '-4.2s', animationDuration: '7s' }}>
        <div className="relative flex -rotate-2 flex-col rounded-[3.2em] border-[0.25em] border-pv-fg bg-pv-card p-[1.2em] shadow-[0_2.4em_4.8em_-2em_rgb(15_15_40/0.45)]">
          <Beat n={1} className="-left-[1.2em] -top-[1.2em]" />
          <span className="mx-auto mb-[1em] h-[0.6em] w-[5em] rounded-full bg-pv-border" />
          <span className="relative flex h-[10em] items-end justify-center overflow-hidden rounded-[1.6em] bg-pv-tint">
            <CarFloor className="absolute inset-x-0 bottom-0 h-[6em] w-full text-pv-primary/25" />
            <IllustratedCar id="nwHeroPhoneCar" className="relative mb-[0.8em] w-[16.5em]" />
          </span>
          <span className="mt-[1.2em] block truncate text-[1.7em] font-extrabold leading-tight tracking-[-0.02em] text-pv-fg">
            {car?.name ?? 'Your car'}
          </span>
          {car?.label ? <span className="block text-[1.15em] text-pv-muted-fg">{car.label}</span> : null}
          <span className="mt-[1.1em] grid grid-cols-2 gap-[0.7em]">
            {[
              ['Pick-up', pickup],
              ['Return', dropoff],
            ].map(([label, day]) => (
              <span key={label} className="rounded-[1em] border border-pv-border px-[0.9em] py-[0.7em]">
                <span className="block text-[1em] text-pv-muted-fg">{label}</span>
                <span className="block truncate text-[1.15em] font-semibold text-pv-fg">{day}</span>
              </span>
            ))}
          </span>
          {car?.dailyRent != null ? (
            <span className="mt-[1em] flex items-baseline justify-between">
              <span className="text-[1.15em] text-pv-muted-fg">Price</span>
              <span className="text-[1.5em] font-extrabold tracking-[-0.02em] text-pv-fg">
                {formatMoney(car.dailyRent, currencyCode)}
                <span className="text-[0.75em] font-medium text-pv-muted-fg"> a day</span>
              </span>
            </span>
          ) : null}
          <span className="mt-[1.2em] grid h-[4em] place-items-center rounded-full bg-pv-primary">
            <span className="text-[1.35em] font-semibold text-pv-primary-fg">Book this car</span>
          </span>
        </div>
        </div>

        {/* 2 — your licence, checked. */}
        <div className={cn(CARD, 'left-0 top-[21%] flex items-center gap-[1em]')} style={{ animationDelay: '-1.4s' }}>
          <Beat n={2} className="-left-[1em] -top-[1em]" />
          <span className="grid size-[3.4em] shrink-0 place-items-center rounded-[1em] bg-pv-tint text-pv-primary">
            <IdCard className="size-[1.8em]" strokeWidth={2} />
          </span>
          <span>
            <span className="block whitespace-nowrap text-[1.3em] font-bold text-pv-fg">Licence checked</span>
            <span className="block whitespace-nowrap text-[1.1em] text-pv-muted-fg">Before you arrive</span>
          </span>
          <Tick />
        </div>

        {/* 3 — the agreement, signed on screen. */}
        <div className={cn(CARD, 'right-0 top-[48%] w-[16.5em]')} style={{ animationDelay: '-3.6s' }}>
          <Beat n={3} className="-right-[1em] -top-[1em]" />
          <span className="flex items-center justify-between gap-[0.8em]">
            <span className="whitespace-nowrap text-[1.3em] font-bold text-pv-fg">Agreement signed</span>
            <Tick />
          </span>
          <svg viewBox="0 0 150 34" className="mt-[0.6em] h-[3.2em] w-full text-pv-fg" fill="none">
            <path
              className="nw-draw"
              pathLength={1}
              style={{ '--d': '1.4s' } as React.CSSProperties}
              d="M6 24 C14 6 22 6 22 18 C22 28 30 10 38 14 C44 17 40 26 48 22 C58 16 62 8 70 16 C76 22 82 22 92 14 C100 8 108 18 118 16"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M4 30 H146" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.5" />
          </svg>
        </div>

        {/* 4 — the keys, ready. */}
        <div className={cn(CARD, 'bottom-[1%] right-[3%] flex items-center gap-[1em]')} style={{ animationDelay: '-2.4s' }}>
          <Beat n={4} className="-left-[1em] -top-[1em]" />
          <span className="grid size-[3.4em] shrink-0 place-items-center rounded-full bg-pv-primary text-pv-primary-fg">
            <KeyRound className="size-[1.7em]" strokeWidth={2.25} />
          </span>
          <span>
            <span className="block whitespace-nowrap text-[1.3em] font-bold text-pv-fg">Keys ready</span>
            <span className="block whitespace-nowrap text-[1.1em] text-pv-muted-fg">Clean and waiting for you</span>
          </span>
        </div>
      </div>
    </div>
  );
}
