import { pageMetadata } from '@nw/lib/cms/metadata';
import { PatternHero } from '@nw/site-v2/sections/pattern-hero';
import { HomeCta } from '@nw/site-v2/sections/home-cta';
import { PromotionsListSection } from '@nw/site-v2/sections/promotions-list-section';
import { ScrollReveal } from '@nw/site-v2/sections/scroll-reveal';

/**
 * Northwind booking site v2 — /promotions: the offers running now, how to use
 * one, and the small print. The headline is plain on purpose — a renter is
 * here to see what is cheaper, not to be sold to. The offers rise over the
 * opening's curved edge.
 */

export function generateMetadata() {
  return pageMetadata('promotions', 'Promotions');
}

export default function PromotionsPage() {
  return (
    <>
      <ScrollReveal />
      <PatternHero
        title="Offers and deals"
        description="Our current discounts on cars, with the dates each one runs until."
      />
      <div className="relative -mt-16 sm:-mt-24 lg:-mt-36">
        <PromotionsListSection />
      </div>
      <HomeCta />
    </>
  );
}
