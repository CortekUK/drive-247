import { pageMetadata } from '@nw/lib/cms/metadata';
import { HomeCta } from '@nw/site-v2/sections/home-cta';
import { ReviewsHero } from '@nw/site-v2/sections/reviews-hero';
import { RealStoriesSection } from '@nw/site-v2/sections/real-stories-section';
import { ScrollReveal } from '@nw/site-v2/sections/scroll-reveal';

/**
 * Northwind booking site v2 — /reviews: what renters say, and nothing else.
 * The operator's headline and line (`reviews / hero`) over a crowd of renters,
 * the wall of real reviews (or an honest "none yet"), the ask to past
 * renters, and the home page's closing scene.
 */

export function generateMetadata() {
  return pageMetadata('reviews', 'Reviews');
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ sample?: string }> }) {
  // On a dev server an empty wall shows sample reviews; `?sample=0` turns them off (see RealStoriesSection).
  const { sample } = await searchParams;
  return (
    <>
      <ScrollReveal />
      <ReviewsHero />
      <RealStoriesSection sample={sample !== '0'} />
      <HomeCta />
    </>
  );
}
