import { MapPin, X } from 'lucide-react';

import { hasTripIntent, type TripIntent } from '@/lib/booking/trip-intent';

interface TripIntentBannerProps {
  intent: TripIntent;
  /** Drops the context AND its query params — see `FleetBrowser.clearIntent`. */
  onClear: () => void;
}

/**
 * "Delivering to <address>" — the receipt for what the customer typed on the
 * home page.
 *
 * ── WHY THIS IS NOT A FILTER ─────────────────────────────────────────────────
 * It looks like one and it is deliberately not. Availability by location is a
 * real feature — it needs a delivery radius per tenant, a geocoded address and
 * a per-vehicle home base — and none of that exists yet. Filtering the grid on
 * a string the customer typed would either do nothing (and lie about it) or
 * hide cars that are in fact bookable. So this band does exactly one honest
 * job: it proves the input survived the hop, and it lets the customer throw it
 * away. The grid below it is the whole fleet, as it always was.
 *
 * ── WHY IT IS DISMISSABLE ────────────────────────────────────────────────────
 * The intent is sticky: it rides on every vehicle link out of this page and
 * pre-fills the booking sidebar. A customer who typed an address, changed their
 * mind, and cannot see how to un-say it would carry it into a booking. The
 * clear control is the exit, and it strips the params from the address bar too
 * so a refresh does not resurrect them.
 */
export function TripIntentBanner({ intent, onClear }: TripIntentBannerProps) {
  if (!hasTripIntent(intent)) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-brand-border-soft bg-brand-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="flex min-w-0 items-start gap-2 text-sm leading-snug text-brand-text-soft">
        <MapPin
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-brand-forest"
          strokeWidth={1.75}
        />
        {/*
          `break-words`, not `truncate`: an address the customer cannot read in
          full is no proof that we kept it. Two legs are separated by a middot
          that is hidden from assistive tech, which reads the two spans as the
          two sentences they are.
        */}
        <span className="min-w-0 break-words">
          {intent.pickup !== null && (
            <>
              Delivering to{' '}
              <span className="font-medium text-brand-text">{intent.pickup}</span>
            </>
          )}
          {intent.pickup !== null && intent.dropoff !== null && (
            <span aria-hidden className="px-1.5 text-brand-text-subtle">
              ·
            </span>
          )}
          {intent.dropoff !== null && (
            <>
              Returning to{' '}
              <span className="font-medium text-brand-text">{intent.dropoff}</span>
            </>
          )}
        </span>
      </p>

      {/*
        `min-h-11` and a full-width tap area on a phone: this is the only escape
        from a sticky choice, and a 16px text link in the corner of a banner is
        not a target a thumb hits.
      */}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-brand-border bg-white px-4 text-sm font-medium text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 sm:w-auto"
      >
        <X aria-hidden className="size-4" strokeWidth={2} />
        Clear
      </button>
    </div>
  );
}
