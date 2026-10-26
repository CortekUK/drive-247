/**
 * Northwind booking site v2 — the About page's tinted band for the story: it
 * rises in one round arc under the intro and ends in a dome, so the section
 * after it ("today", on the page's own background) swells up into the tint.
 * Both edges are drawn in the band's colour, not border-radius, so they stay
 * clean curves at any width, and whatever is behind the page shows through
 * around them in light and dark alike.
 */
export function AboutBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative -mt-6 lg:-mt-10">
      <svg
        aria-hidden
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="block h-[40px] w-full fill-current text-pv-tint sm:h-[64px] lg:h-[96px]"
      >
        <path d="M0 120 C 300 8, 1140 8, 1440 120 Z" />
      </svg>
      <div className="-my-px bg-pv-tint pb-12 md:pb-16">{children}</div>
      <svg
        aria-hidden
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="block h-[48px] w-full fill-current text-pv-tint sm:h-[80px] lg:h-[120px]"
      >
        <path d="M0 0H1440V120C1140 8 300 8 0 120Z" />
      </svg>
    </div>
  );
}
