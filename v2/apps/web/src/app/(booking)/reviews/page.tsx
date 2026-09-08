import { AboutHeroSection } from "@/components/sections/about-hero-section";
import { CtaBanner } from "@/components/sections/cta-banner";
import { RealStoriesSection } from "@/components/sections/real-stories-section";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { WhyChooseUsSection } from "@/components/sections/why-choose-us-section";
import { DEFAULT_REVIEWS_HERO } from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";
import { pageMetadata } from "@/lib/cms/metadata";

export function generateMetadata() {
  return pageMetadata("reviews", "Reviews");
}

export default async function ReviewsPage() {
  /**
   * The portal has a Reviews page with a Hero heading and standfirst. Nothing
   * in this app read it: the hero's words were hardcoded here, so an operator
   * could type their own and publish and the page never changed.
   */
  const hero = await loadSection("reviews", "hero", DEFAULT_REVIEWS_HERO);

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

/*
 * `TrustpilotBadge` stood here: a hardcoded "Trustpilot · 5.0 Rating" chip with
 * the green star, pinned to the top of every tenant's Reviews page.
 *
 * It was not read from anywhere. Northwind has zero reviews, so the page
 * asserted a perfect score from a named third-party review service on behalf of
 * a business that has never been rated by it — using that service's mark. A
 * fabricated star rating is the most load-bearing claim on a rental site, and
 * it is the one a customer is least able to check.
 *
 * Deleted rather than made configurable: a Trustpilot score is Trustpilot's to
 * publish, not a CMS field.
 */
