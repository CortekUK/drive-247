import { pageMetadata } from '@nw/lib/cms/metadata';
import { AboutHeroSection } from '@nw/site-v2/sections/about-hero-section';
import { CtaBanner } from '@nw/site-v2/sections/cta-banner';
import { FaqSection } from '@nw/site-v2/sections/faq-section';
import { MarqueeStrip } from '@nw/site-v2/sections/marquee-strip';
import { StatsStrip } from '@nw/site-v2/sections/stats-strip';
import { TestimonialsSection } from '@nw/site-v2/sections/testimonials-section';
import { UncompromisingStandardsSection } from '@nw/site-v2/sections/uncompromising-standards-section';
import { WhyChooseUsSection } from '@nw/site-v2/sections/why-choose-us-section';

/** Northwind booking site v2 — /about. The current page's sections, in the v2 language. */

export function generateMetadata() {
  return pageMetadata('about', 'About');
}

export default function AboutPage() {
  return (
    <>
      <AboutHeroSection />
      <UncompromisingStandardsSection />
      <MarqueeStrip />
      <WhyChooseUsSection />
      <StatsStrip />
      <TestimonialsSection />
      <FaqSection page="about" />
      <CtaBanner page="about" />
    </>
  );
}
