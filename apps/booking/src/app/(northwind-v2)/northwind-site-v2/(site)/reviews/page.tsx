import { DEFAULT_REVIEWS_HERO } from '@nw/lib/cms/defaults';
import { pageMetadata } from '@nw/lib/cms/metadata';
import { loadSection } from '@nw/lib/cms/server';
import { AboutHeroSection } from '@nw/site-v2/sections/about-hero-section';
import { CtaBanner } from '@nw/site-v2/sections/cta-banner';
import { RealStoriesSection } from '@nw/site-v2/sections/real-stories-section';
import { TestimonialsSection } from '@nw/site-v2/sections/testimonials-section';
import { WhyChooseUsSection } from '@nw/site-v2/sections/why-choose-us-section';

/**
 * Northwind booking site v2 — /reviews. The hero words are the operator's own
 * `reviews / hero`, read exactly as the current page reads them.
 */

export function generateMetadata() {
  return pageMetadata('reviews', 'Reviews');
}

export default async function ReviewsPage() {
  const hero = await loadSection('reviews', 'hero', DEFAULT_REVIEWS_HERO);

  return (
    <>
      <AboutHeroSection
        imageSrc="/booking_landingpage/reviews-hero.jpg"
        imageAlt="Customer enjoying a drive at golden hour"
        imageObjectPosition="center"
        heading={hero.title.trim() || DEFAULT_REVIEWS_HERO.title}
        body={hero.subtitle.trim() || undefined}
      />
      <RealStoriesSection />
      <WhyChooseUsSection />
      <TestimonialsSection />
      <CtaBanner />
    </>
  );
}
