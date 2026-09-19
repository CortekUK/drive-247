import { CtaBanner } from "@nw/components/sections/cta-banner";
import { FaqSection } from "@nw/components/sections/faq-section";
import { FleetSection } from "@nw/components/sections/fleet-section";
import { HeroSection } from "@nw/components/sections/hero-section";
import { HowItWorksSection } from "@nw/components/sections/how-it-works-section";
import { SafetyVerificationSection } from "@nw/components/sections/safety-verification-section";
import { StatsStrip } from "@nw/components/sections/stats-strip";
import { TestimonialsSection } from "@nw/components/sections/testimonials-section";
import { WhyChooseUsSection } from "@nw/components/sections/why-choose-us-section";
import { pageMetadata } from "@nw/lib/cms/metadata";

/* The home page's own Search listing block. Falls back to the tenant title
   the root layout resolves, so an unconfigured tenant is unchanged. */
export function generateMetadata() {
  return pageMetadata("home", "");
}

export default function BookingLandingPage() {
  return (
    <>
      <HeroSection />
      <FleetSection />
      <WhyChooseUsSection />
      <StatsStrip />
      <HowItWorksSection />
      <TestimonialsSection />
      <SafetyVerificationSection />
      <FaqSection />
      <CtaBanner />
    </>
  );
}
