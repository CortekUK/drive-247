import { AboutHeroSection } from "@nw/components/sections/about-hero-section";
import { CtaBanner } from "@nw/components/sections/cta-banner";
import { FaqSection } from "@nw/components/sections/faq-section";
import { MarqueeStrip } from "@nw/components/sections/marquee-strip";
import { StatsStrip } from "@nw/components/sections/stats-strip";
import { TestimonialsSection } from "@nw/components/sections/testimonials-section";
import { UncompromisingStandardsSection } from "@nw/components/sections/uncompromising-standards-section";
import { WhyChooseUsSection } from "@nw/components/sections/why-choose-us-section";
import { pageMetadata } from "@nw/lib/cms/metadata";

export function generateMetadata() {
  return pageMetadata("about", "About");
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
