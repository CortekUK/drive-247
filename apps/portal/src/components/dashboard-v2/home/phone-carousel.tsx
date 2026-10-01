'use client';

/**
 * The revenue chart and the feature card as a swipeable pair on a phone
 * (Sep 28 2026), the way iOS pages cards: each one nearly screen-wide, the
 * next peeking at the edge, snapping into place, with page dots underneath.
 * At `md` and up none of this applies.
 */

import { useEffect, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';

/** Goes on the SECTION around the row, so the row's own classes are untouched. */
export const PHONE_CAROUSEL =
  'max-md:-mx-2 ' +
  'max-md:[&>div:first-child]:flex-row max-md:[&>div:first-child]:snap-x max-md:[&>div:first-child]:snap-mandatory ' +
  'max-md:[&>div:first-child]:gap-3 max-md:[&>div:first-child]:overflow-x-auto max-md:[&>div:first-child]:px-2 ' +
  'max-md:[&>div:first-child]:[scrollbar-width:none] max-md:[&>div:first-child::-webkit-scrollbar]:hidden ' +
  // `basis`, not `width`: the revenue card carries `flex-1` (basis 0), which
  // would otherwise win and squeeze it to nothing beside the feature card.
  'max-md:[&>div:first-child>*]:basis-[86%] max-md:[&>div:first-child>*]:grow-0 max-md:[&>div:first-child>*]:shrink-0 ' +
  'max-md:[&>div:first-child>*]:snap-center';

/** Dots under a horizontal scroller: which page is showing. Phone only. */
export function PageDots({ scroller, count }: { scroller: RefObject<HTMLElement | null>; count: number }) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollWidth - el.clientWidth;
      setPage(max > 0 ? Math.round((el.scrollLeft / max) * (count - 1)) : 0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scroller, count]);

  return (
    <div aria-hidden="true" className="mt-3 flex justify-center gap-1.5 md:hidden">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i === page ? 'w-4 bg-[var(--pv-accent)]' : 'w-1.5 bg-[var(--pv-line-2)]'
          )}
        />
      ))}
    </div>
  );
}
