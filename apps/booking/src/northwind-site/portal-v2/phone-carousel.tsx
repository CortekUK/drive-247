'use client';

/**
 * The hero row as a swipeable pair on a phone — the operator Home's
 * (apps/portal/src/components/dashboard-v2/home/phone-carousel.tsx), copied:
 * each card nearly screen-wide, the next one peeking at the edge, snapping
 * into place, with page dots underneath. At `md` and up none of this applies.
 *
 * One difference: the operator's row is a flex column, the shared HeroRow is a
 * grid, so the phone rule also makes the row `flex`. The dots read the
 * section's first child, the row itself.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@nw/lib/utils';

/** Goes on the SECTION around the row, so the row's own classes are untouched. */
export const PHONE_CAROUSEL =
  'max-md:-mx-2 ' +
  'max-md:[&>div:first-child]:flex max-md:[&>div:first-child]:flex-row max-md:[&>div:first-child]:snap-x max-md:[&>div:first-child]:snap-mandatory ' +
  'max-md:[&>div:first-child]:gap-3 max-md:[&>div:first-child]:overflow-x-auto max-md:[&>div:first-child]:px-2 ' +
  'max-md:[&>div:first-child]:[scrollbar-width:none] max-md:[&>div:first-child::-webkit-scrollbar]:hidden ' +
  'max-md:[&>div:first-child>*]:basis-[86%] max-md:[&>div:first-child>*]:grow-0 max-md:[&>div:first-child>*]:shrink-0 ' +
  'max-md:[&>div:first-child>*]:snap-center';

/** The section, the row inside it, and the dots under it. */
export function PhoneCarousel({ count, children, className }: { count: number; children: ReactNode; className?: string }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const el = sectionRef.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollWidth - el.clientWidth;
      setPage(max > 0 ? Math.round((el.scrollLeft / max) * (count - 1)) : 0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [count]);

  return (
    <section ref={sectionRef} className={cn(PHONE_CAROUSEL, className)}>
      {children}
      <div aria-hidden="true" className="mt-3 flex justify-center gap-1.5 md:hidden">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={cn('h-1.5 rounded-full transition-all duration-300', i === page ? 'w-4 bg-pv-primary' : 'w-1.5 bg-pv-border')} />
        ))}
      </div>
    </section>
  );
}
