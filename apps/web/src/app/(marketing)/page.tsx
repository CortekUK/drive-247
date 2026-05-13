import { Hero } from "@/components/sections/hero";
import { CredibilityStrip } from "@/components/sections/credibility-strip";
import { ProblemSection } from "@/components/sections/problem-section";
import { OperationsDashboard } from "@/components/sections/operations-dashboard";
import { ProductShowcase } from "@/components/sections/product-showcase";
import { SocialProof } from "@/components/sections/social-proof";
import { Timeline } from "@/components/sections/timeline";
import { FAQSection } from "@/components/sections/faq-section";
import { CTABand } from "@/components/sections/cta-band";

export default function Home() {
  return (
    <>
      <Hero />
      <CredibilityStrip />
      <OperationsDashboard />
      <SocialProof />
      <ProblemSection />
      <ProductShowcase />
      <Timeline />
      <FAQSection />
      <CTABand />
    </>
  );
}
