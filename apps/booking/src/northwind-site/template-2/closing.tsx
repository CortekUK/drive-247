'use client';

/**
 * Template 2 ("Glass") — the home page's last word, in the same glass as every
 * section above it: centred, like every heading on the page, one line on what
 * happens next, "Choose your dates" (back up to the hero's search, focused)
 * and every car.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react-nw';

import { toFleetVehicle, type FleetSeed } from '@nw/components/fleet/fleet-vehicle';
import { useVehicles } from '@nw/hooks/use-vehicles';
import { cn } from '@nw/lib/utils';
import { t2Href } from '@nw/template-2/links';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
function startBooking() {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  window.setTimeout(() => document.getElementById('g2-pickup')?.focus({ preventScroll: true }), smooth ? 500 : 0);
}

export function Template2Closing({ seed }: { seed: FleetSeed | null }) {
  const { vehicles } = useVehicles();
  const live = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);
  const fleet = live.length > 0 ? live : (seed?.vehicles ?? []);

  return (
    <section aria-labelledby="g2-close-title" className="relative">
      <div className="mx-auto w-full max-w-[1320px] px-3 pb-3 pt-4 sm:px-5 lg:pt-[92px]">
        <div className="g2-glass flex flex-col items-center rounded-[32px] p-3 text-center sm:rounded-[44px] sm:p-5 lg:rounded-[40px]">
          <div className="flex flex-col items-center px-3 py-10 sm:py-14 lg:py-16">
            <h2
              id="g2-close-title"
              className="max-w-[18ch] text-[34px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[52px] lg:text-[60px]"
            >
              Your car is ready when you are.
            </h2>
            <p className="mt-4 max-w-[32rem] text-[16px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[18px]">
              Choose your dates and see every car that is free, with the full price before you pay.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={startBooking}
                className={cn('g2-cta inline-flex h-[52px] items-center gap-2 rounded-full px-7 text-[16px] font-semibold', FOCUS)}
              >
                Choose your dates
                <ArrowRight aria-hidden className="size-4" strokeWidth={2.5} />
              </button>
              {fleet.length > 0 ? (
                <Link
                  href={t2Href('/fleet')}
                  className={cn(
                    'inline-flex h-[52px] items-center rounded-full bg-white px-6 text-[16px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff] transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--g2-accent)_8%,#fff)]',
                    FOCUS,
                  )}
                >
                  See all {fleet.length} cars
                </Link>
              ) : null}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
