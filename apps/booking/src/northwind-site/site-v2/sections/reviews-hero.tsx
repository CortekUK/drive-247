import { DEFAULT_REVIEWS_HERO } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { loadSection } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { ReviewsCrowdArt, ReviewsCrowdArtSmall } from '@nw/site-v2/illustrations/crowd-scene';
import { SITE_WIDE } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the /reviews opening: the operator's headline
 * and line (`reviews / hero`, editable in place), centred on the site's
 * tinted surface, with a row of renters standing along its bottom edge,
 * some holding up what they thought. The surface ends in a straight line
 * under their feet, so the crowd stands on the page itself.
 */
export async function ReviewsHero() {
  const hero = await loadSection('reviews', 'hero', DEFAULT_REVIEWS_HERO);
  const title = hero.title.trim() || DEFAULT_REVIEWS_HERO.title;
  const subtitle = hero.subtitle.trim();

  return (
    <div className="relative isolate overflow-hidden bg-[var(--nw-hero-bg)]">
      <header
        {...cmsSection('reviews.hero', 'Hero')}
        className={cn(SITE_WIDE, 'flex flex-col items-center pt-12 text-center sm:pt-16 lg:pt-20')}
      >
        <h1
          style={{ '--d': '60ms' } as React.CSSProperties}
          className="nw-rise max-w-[16ch] text-[42px] font-extrabold leading-[1.02] tracking-[-0.05em] text-pv-fg [text-wrap:balance] sm:text-[58px] lg:text-[72px]"
        >
          <Editable path="reviews.hero.title">{title}</Editable>
        </h1>
        {subtitle ? (
          <p
            style={{ '--d': '120ms' } as React.CSSProperties}
            className="nw-rise mt-5 max-w-[38rem] text-[16px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[18px]"
          >
            <Editable path="reviews.hero.subtitle">{subtitle}</Editable>
          </p>
        ) : null}
      </header>
      {/* Phones get five people who fit whole; wider screens the full row, cropped at the sides only when it must be. */}
      <div className="mx-auto mt-8 w-full max-w-[520px] px-3 sm:hidden">
        <ReviewsCrowdArtSmall className="block w-full" />
      </div>
      <div className="relative left-1/2 hidden w-[960px] -translate-x-1/2 sm:mt-10 sm:block lg:mt-12 lg:w-[1200px]">
        <ReviewsCrowdArt className="block w-full" />
      </div>
    </div>
  );
}
