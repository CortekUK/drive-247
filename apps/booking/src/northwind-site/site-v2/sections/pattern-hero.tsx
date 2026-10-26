import { cn } from '@nw/lib/utils';
import { LIQUID_PATH, LIQUID_VIEWBOX } from '@nw/site-v2/illustrations/liquid-pattern';
import { SITE_WIDE } from '@nw/site-v2/kit';

/**
 * The hero's pattern: a liquid print of interlocking poured shapes
 * (`liquid-pattern.ts`), in the operator's colour a few shades deeper than
 * the surface, lighter behind the headline so it still reads first, and
 * fading in under the navbar.
 */
function Liquid() {
  return (
    <svg
      aria-hidden
      viewBox={LIQUID_VIEWBOX}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 -z-10 size-full text-pv-primary opacity-[0.14] [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,transparent,#000_72px),radial-gradient(40%_46%_at_50%_34%,rgba(0,0,0,0.35)_45%,#000_100%)] [-webkit-mask-composite:source-in] dark:opacity-[0.2]"
    >
      <path d={LIQUID_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * Northwind booking site v2 — a centred page opening on the site's tinted
 * surface, poured over with liquid shapes in the operator's colour,
 * ending in a dome that dips at the sides. The page's first block is meant
 * to rise over that dome (a negative top margin on it), so the opening and
 * the content read as one piece. Used by /promotions.
 */
export function PatternHero({
  title,
  description,
  cms,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** `cmsSection(...)` props, so the visual editor can find the block. */
  cms?: Record<string, string>;
}) {
  return (
    <div className="relative isolate overflow-hidden bg-[var(--nw-hero-bg)]">
      <Liquid />
      <header
        {...cms}
        className={cn(SITE_WIDE, 'flex flex-col items-center pb-36 pt-12 text-center sm:pb-44 sm:pt-16 lg:pb-52 lg:pt-20')}
      >
        <h1
          style={{ '--d': '60ms' } as React.CSSProperties}
          className="nw-rise max-w-[16ch] text-[42px] font-extrabold leading-[1.02] tracking-[-0.05em] text-pv-fg [text-wrap:balance] sm:text-[58px] lg:text-[72px]"
        >
          {title}
        </h1>
        {description ? (
          <p
            style={{ '--d': '120ms' } as React.CSSProperties}
            className="nw-rise mt-5 max-w-[38rem] text-[16px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[18px]"
          >
            {description}
          </p>
        ) : null}
      </header>
      {/* The page, cut into the surface's bottom corners: what is left is a dome that dips at the sides. */}
      <svg
        aria-hidden
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 block h-[40px] w-full fill-pv-bg sm:h-[64px] lg:h-[96px]"
      >
        <path d="M0 120C300 16 1140 16 1440 120H1441V121H-1Z" />
      </svg>
    </div>
  );
}
