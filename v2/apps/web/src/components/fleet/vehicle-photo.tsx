import { Car } from 'lucide-react';

import { cn } from '@/lib/utils';

interface VehiclePhotoProps {
  url: string | null;
  /** Empty string when a sibling heading already names the car. */
  alt: string;
  className?: string;
  /** Hover zoom is only wanted where the whole card is the link. */
  zoomOnGroupHover?: boolean;
}

/**
 * A vehicle photo, or an honest placeholder.
 *
 * Deliberately a plain `<img>`, not `next/image`. Operator photos live on
 * Supabase Storage — a remote host — and `next.config.ts` declares no
 * `images.remotePatterns`, so `next/image` throws at render for every real
 * tenant. The seeded fleet happens to point at local files, which would have
 * hidden that until production. See the handoff about adding the pattern.
 *
 * `object-contain` rather than `cover`: fleet photography on this platform is a
 * mix of cut-out PNGs and wide press shots, and cropping the latter to fill a
 * card slices the roof off the car.
 *
 * The default box is a 16:10 ASPECT RATIO, not a pixel height. A fluid grid
 * cell is 320px wide on a phone and 206px inside the desktop rail layout, and a
 * frame fixed at 136px tall letterboxes badly at one end of that range. Callers
 * that genuinely need a fixed height (the list row, from `md` up) pass
 * `aspect-auto` alongside their own height.
 */
export function VehiclePhoto({
  url,
  alt,
  className,
  zoomOnGroupHover = false,
}: VehiclePhotoProps) {
  return (
    <div
      className={cn(
        'relative flex aspect-[16/10] w-full min-w-0 items-center justify-center overflow-hidden rounded-[10px] bg-brand-stone/50',
        className,
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            'h-full w-full object-contain p-2 sm:p-3',
            zoomOnGroupHover && 'transition-transform duration-300 group-hover:scale-[1.04]',
          )}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 text-brand-text-subtle">
          <Car aria-hidden className="size-6" strokeWidth={1.5} />
          <span className="text-xs">Photo coming soon</span>
        </div>
      )}
    </div>
  );
}
