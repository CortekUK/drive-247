import { Hero } from "@/components/sections/hero";
import { CredibilityStrip } from "@/components/sections/credibility-strip";
import { ProblemSection } from "@/components/sections/problem-section";
import { OperationsDashboard } from "@/components/sections/operations-dashboard";
import { ProductShowcase } from "@/components/sections/product-showcase";
import { SocialProof } from "@/components/sections/social-proof";
import { Timeline } from "@/components/sections/timeline";
import { PricingSection } from "@/components/sections/pricing";
import { FAQSection } from "@/components/sections/faq-section";
import { CTABand } from "@/components/sections/cta-band";
import { fetchSignupPlans } from "@/lib/plans-server";

/**
 * ISR, not a static build artefact.
 *
 * Every plan value used to be baked into the prerendered HTML *and* the client
 * bundle at build time, so a super admin editing a price in the admin app
 * changed nothing a visitor could see until the next deploy. Declaring
 * `revalidate` is what turns this page into something that re-reads
 * `signup_plans` on its own; without it the fetch below would run exactly once,
 * during `next build`, and the DB read would be pure theatre.
 *
 * Must stay a literal. Next parses segment config statically and rejects an
 * imported constant ("Invalid segment configuration export detected"), so this
 * cannot be `PLANS_REVALIDATE_SECONDS` however much it would like to be — keep
 * the two in step by hand if either changes.
 */
export const revalidate = 60;

export default async function Home() {
  // Never throws and never returns empty: a Supabase outage yields the
  // hardcoded catalogue rather than a failed build or a blank pricing grid.
  const plans = await fetchSignupPlans();

  return (
    <>
      <Hero />
      <CredibilityStrip />
      <OperationsDashboard />
      <SocialProof />
      <ProblemSection />
      <ProductShowcase />
      <Timeline />
      <PricingSection plans={plans} />
      <FAQSection />
      <CTABand />
    </>
  );
}
