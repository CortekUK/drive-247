'use client';

/**
 * The home page's "start booking" button. Booking starts in the hero's search,
 * so this goes there: it scrolls up to the dates and opens the calendar
 * (`OPEN_TRIP_DATES_EVENT`), instead of dropping the visitor on another page.
 */

import { ArrowRight } from 'lucide-react-nw';

import { cn } from '@nw/lib/utils';
import { OPEN_TRIP_DATES_EVENT } from '@nw/site-v2/home';

export function startBooking() {
  const target = document.getElementById('trip-dates');
  // On a page without the search (About, Reviews…): to the home page's, which opens its calendar on arrival.
  if (!target) {
    window.location.assign('/#trip-dates');
    return;
  }
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  window.setTimeout(() => window.dispatchEvent(new Event(OPEN_TRIP_DATES_EVENT)), smooth ? 450 : 0);
}

/** The page's primary pill: 48px, fully round, the arrow nudging on hover. */
export const PRIMARY_PILL =
  'group/pill inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-pv-primary px-6 text-[15px] font-semibold text-pv-primary-fg ' +
  'transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/25 motion-reduce:transition-none';

export function StartBookingButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={startBooking} className={cn(PRIMARY_PILL, className)}>
      {children}
      <ArrowRight
        aria-hidden
        className="size-4 transition-transform duration-200 ease-out group-hover/pill:translate-x-0.5 motion-reduce:transition-none"
        strokeWidth={2.25}
      />
    </button>
  );
}
