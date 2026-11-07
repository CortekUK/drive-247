'use client';

/**
 * Template 2 ("Glass") — the hero's showroom: the operator's cars, one at a
 * time, with the car's name set huge behind it.
 *
 * The arrows, the dots, a swipe or the ← / → keys change the car. The hero
 * (hero.tsx) owns which car is on stage, because the whole scene behind it —
 * the backdrop and the glass — takes on that car's colour (car-colour.ts).
 *
 * The new car glides in from the side it was asked for; the name crossfades.
 * With one car there is nothing to change, so the controls are not drawn.
 */

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react-nw';

import { cn } from '@nw/lib/utils';
import { HeroCar } from '@nw/template-2/hero-car';

export type ShowroomCar = {
  /** A cut-out on a clear background reads best. */
  src: string;
  /** Set huge behind the car: "Aston Martin". Optional. */
  name?: string | null;
  alt: string;
  /** The scene colour as "#rrggbb"; read off the photo when empty. */
  color?: string | null;
};

export type Direction = 'next' | 'prev';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
/** How far a finger must travel sideways to count as a swipe. */
const SWIPE_PX = 48;

export function Showroom({
  cars,
  index,
  direction,
  onStep,
  onPick,
}: {
  cars: ReadonlyArray<ShowroomCar>;
  index: number;
  /** Which way the last change went; null on first paint. */
  direction: Direction | null;
  onStep: (direction: Direction) => void;
  onPick: (index: number) => void;
}) {
  const car = cars[index];
  const many = cars.length > 1;
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // Fetch every car's photo up front, so a change never waits on the network.
  useEffect(() => {
    for (const other of cars) new Image().src = other.src;
  }, [cars]);

  return (
    <div
      role={many ? 'region' : undefined}
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label={many ? 'Our cars' : undefined}
      className="relative my-3 flex w-full flex-1 flex-col items-center justify-center sm:my-4 lg:min-h-0"
      onKeyDown={(event) => {
        if (!many) return;
        if (event.key === 'ArrowRight') onStep('next');
        else if (event.key === 'ArrowLeft') onStep('prev');
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!many || !start) return;
        const dx = event.clientX - start.x;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) onStep(dx < 0 ? 'next' : 'prev');
      }}
    >
      {/* A fixed-height stage, so a taller photo never pushes the search down. */}
      <div className="g2-stage relative grid h-[clamp(190px,28svh,300px)] sm:h-[clamp(210px,40svh,380px)] w-full place-items-end justify-items-center lg:[@media(max-height:820px)]:h-[clamp(200px,34svh,300px)]">
        {/* The name, huge, fading into the floor; the car stands in front of it. */}
        {car.name ? (
          <p
            key={`name-${index}`}
            aria-hidden
            style={{ '--chars': Math.max(car.name.length, 6) } as React.CSSProperties}
            className="g2-car-name g2-swap-fade pointer-events-none absolute inset-x-0 top-0 z-0 whitespace-nowrap text-center font-extrabold uppercase leading-[0.86] tracking-[-0.045em]"
          >
            {car.name}
          </p>
        ) : null}

        <div
          key={`car-${index}`}
          data-dir={direction ?? undefined}
          className={cn(
            'relative z-10 flex h-[78%] w-full items-end justify-center sm:w-[min(100%,820px)]',
            direction && 'g2-swap',
          )}
        >
          <HeroCar src={car.src} alt={car.alt} entrance={!direction} />
        </div>

        {many ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-[30%] z-20 hidden justify-between sm:flex">
            <StepButton side="prev" onClick={() => onStep('prev')} />
            <StepButton side="next" onClick={() => onStep('next')} />
          </div>
        ) : null}
      </div>

      {many ? (
        <div className="mt-2 flex items-center gap-1">
          {/* On a phone the arrows sit beside the dots, off the car. */}
          <span className="mr-2 sm:hidden">
            <StepButton side="prev" onClick={() => onStep('prev')} />
          </span>
          {cars.map((other, at) => (
            <button
              key={other.src + at}
              type="button"
              onClick={() => onPick(at)}
              aria-label={`Show ${other.name || `car ${at + 1}`}`}
              aria-current={at === index || undefined}
              className={cn('group grid h-6 place-items-center rounded-full px-1', FOCUS)}
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-all duration-300',
                  at === index ? 'w-6 bg-[var(--g2-ink)]' : 'w-1.5 bg-[var(--g2-ink)]/25 group-hover:bg-[var(--g2-ink)]/45',
                )}
              />
            </button>
          ))}
          <span className="ml-2 sm:hidden">
            <StepButton side="next" onClick={() => onStep('next')} />
          </span>
        </div>
      ) : null}

      {/* What changed, for a screen reader. */}
      {many ? (
        <p aria-live="polite" className="sr-only">
          {`${car.name || car.alt}, ${index + 1} of ${cars.length}`}
        </p>
      ) : null}
    </div>
  );
}

function StepButton({ side, onClick }: { side: Direction; onClick: () => void }) {
  const Icon = side === 'next' ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'next' ? 'Next car' : 'Previous car'}
      className={cn(
        'g2-glass-thin pointer-events-auto grid size-10 place-items-center rounded-full text-[var(--g2-ink)] transition-transform duration-200 hover:scale-105 active:scale-95 sm:size-12',
        FOCUS,
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={2.25} />
    </button>
  );
}
