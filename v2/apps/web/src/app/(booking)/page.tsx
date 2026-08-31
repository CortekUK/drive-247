import { CtaBanner } from "@/components/sections/cta-banner";
import { FaqSection } from "@/components/sections/faq-section";
import { FleetSection } from "@/components/sections/fleet-section";
import { HeroSection } from "@/components/sections/hero-section";
import { HowItWorksSection } from "@/components/sections/how-it-works-section";
import { SafetyVerificationSection } from "@/components/sections/safety-verification-section";
import { StatsStrip } from "@/components/sections/stats-strip";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { WhyChooseUsSection } from "@/components/sections/why-choose-us-section";

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
