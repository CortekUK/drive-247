import { Hero } from "@/components/sections/hero";
import { CredibilityStrip } from "@/components/sections/credibility-strip";
import { ProblemSection } from "@/components/sections/problem-section";
import { OperationsDashboard } from "@/components/sections/operations-dashboard";
import { ProductShowcase } from "@/components/sections/product-showcase";
import { SocialProof } from "@/components/sections/social-proof";
import { Timeline } from "@/components/sections/timeline";
import { FAQSection } from "@/components/sections/faq-section";
import { connection } from "next/server";

import { CTABand } from "@/components/sections/cta-band";
import { PricingSection } from "@/components/sections/pricing";
import { fetchLandingPricingEnabled } from "@/lib/landing-pricing-server";
import { fetchSignupPlans } from "@/lib/plans-server";

export default async function Home() {
  // The pricing tier section (and with it self-serve signup) shows only while
  // the super-admin switch on the Signup Plans tab is on. Off by default, and
  // off on any read failure, so the page is exactly as before unless someone is
  // testing the live signup journey.
  //
  // `connection()` renders this page per request, explicitly. The switch must
  // take effect on the very next page load; left to the fetch alone, a build
  // without Supabase env prerendered the page as static and baked in "off".
  // The plan catalogue keeps its own 10-second cache.
  await connection();
  const showPricing = await fetchLandingPricingEnabled();
  const plans = showPricing ? await fetchSignupPlans() : null;

  return (
    <>
      <Hero />
      <CredibilityStrip />
      <OperationsDashboard />
      <SocialProof />
      <ProblemSection />
      <ProductShowcase />
      <Timeline />
      {plans && <PricingSection plans={plans} />}
      <FAQSection />
      <CTABand />
    </>
  );
}
