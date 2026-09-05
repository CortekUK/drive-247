import { AboutHeroSection } from "@/components/sections/about-hero-section";
import { CtaBanner } from "@/components/sections/cta-banner";
import { FaqSection } from "@/components/sections/faq-section";
import { MarqueeStrip } from "@/components/sections/marquee-strip";
import { StatsStrip } from "@/components/sections/stats-strip";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { UncompromisingStandardsSection } from "@/components/sections/uncompromising-standards-section";
import { WhyChooseUsSection } from "@/components/sections/why-choose-us-section";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <AboutHeroSection />
      <UncompromisingStandardsSection />
      <MarqueeStrip />
      <WhyChooseUsSection />
      <StatsStrip />
      <TestimonialsSection />
      <FaqSection />
      <CtaBanner />
    </>
  );
}
