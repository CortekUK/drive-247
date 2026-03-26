import { Hero } from "@/components/sections/hero";
import { CredibilityStrip } from "@/components/sections/credibility-strip";
import { ProblemSection } from "@/components/sections/problem-section";
import { OperationsDashboard } from "@/components/sections/operations-dashboard";
import { RenterPortal } from "@/components/sections/renter-portal";
import { BookingWebsite } from "@/components/sections/booking-website";
import { SocialProof } from "@/components/sections/social-proof";
import { Timeline } from "@/components/sections/timeline";
import { FAQSection } from "@/components/sections/faq-section";
import { PricingSection } from "@/components/sections/pricing";
import { CTABand } from "@/components/sections/cta-band";

export default function Home() {
  return (
    <>
      <Hero />
      <CredibilityStrip />
      <ProblemSection />
      <OperationsDashboard />
      <RenterPortal />
      <BookingWebsite />
      <SocialProof />
      <Timeline />
      <PricingSection />
      <FAQSection />
      <CTABand />
    </>
  );
}
