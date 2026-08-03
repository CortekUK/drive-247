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
 *
 * 10s, not 60s. At 60 an admin would toggle a plan's visibility, reload the
 * public page, still see the old grid, and reasonably conclude the toggle was
 * broken — which is exactly what happened the first time this shipped. The cost
 * is one PostgREST read per 10s of traffic on a marketing page, which is
 * nothing; the benefit is that the admin's change is believable.
 *
 * ISR is still a WINDOW, not a push: the first request after the window expires
 * serves the stale page and triggers the regeneration behind it, so a change can
 * take two loads to appear. The admin UI says so rather than implying instant.
 */
export const revalidate = 10;

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
