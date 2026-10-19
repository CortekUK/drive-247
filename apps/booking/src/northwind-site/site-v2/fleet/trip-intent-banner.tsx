import { MapPin, X } from 'lucide-react-nw';

import { hasTripIntent, type TripIntent } from '@nw/lib/booking/trip-intent';
import { CARD, ICON_TILE } from '@nw/site-v2/kit';
import { cn } from '@nw/lib/utils';

interface TripIntentBannerProps {
  intent: TripIntent;
  /** Drops the context AND its query params — see `useFleetBrowser.clearTripIntent`. */
  onClear: () => void;
}

/**
 * v2 of `components/fleet/trip-intent-banner.tsx`: the receipt for the address
 * typed on the home page. Context, NOT a filter, and dismissable — the v1 file
 * documents both decisions.
 */
export function TripIntentBanner({ intent, onClear }: TripIntentBannerProps) {
  if (!hasTripIntent(intent)) return null;

  return (
    <div
      className={cn(
        CARD,
        'pv2-enter flex items-center justify-between gap-3 py-2.5 pl-3 pr-2.5 sm:gap-4 sm:px-4 sm:py-3',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={ICON_TILE}>
          <MapPin aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <p className="min-w-0 break-words text-[13px] leading-snug text-pv-muted-fg">
          {intent.pickup !== null && (
            <>
              Delivering to <span className="font-semibold text-pv-fg">{intent.pickup}</span>
            </>
          )}
          {intent.pickup !== null && intent.dropoff !== null && (
            <span aria-hidden className="px-1.5">
              ·
            </span>
          )}
          {intent.dropoff !== null && (
            <>
              Returning to <span className="font-semibold text-pv-fg">{intent.dropoff}</span>
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-pv-border bg-pv-card px-4 text-[13px] font-medium text-pv-fg transition-colors duration-200 ease-out hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none sm:min-h-9"
      >
        <X aria-hidden className="size-4" />
        Clear
      </button>
    </div>
  );
}
