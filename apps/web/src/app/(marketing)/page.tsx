import { Hero } from "@/components/sections/hero";
import { CredibilityStrip } from "@/components/sections/credibility-strip";
import { ProblemSection } from "@/components/sections/problem-section";
import { OperationsDashboard } from "@/components/sections/operations-dashboard";
import { ProductShowcase } from "@/components/sections/product-showcase";
import { SocialProof } from "@/components/sections/social-proof";
import { Timeline } from "@/components/sections/timeline";
import { FAQSection } from "@/components/sections/faq-section";
import { connection } from "next/server";

import { cookies } from "next/headers";
import { CTABand } from "@/components/sections/cta-band";
import { PricingSection } from "@/components/sections/pricing";
import { ReferralBanner } from "@/components/sections/referral-banner";
import { fetchLandingPricingEnabled } from "@/lib/landing-pricing-server";
import { fetchSignupPlans } from "@/lib/plans-server";
import { lookupPromoOffer } from "@/lib/promo-lookup-server";
import { normalizeReferralCode, REFERRAL_COOKIE } from "@/lib/referral-cookie";

export default async function Home({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
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

  // A Drive247 promo / referral code the visitor carries (/r/{code} sets the
  // cookie; the first landing also carries ?ref=). A usable code shows the
  // invite banner and — even while the pricing switch is off (brief R5) — the
  // plans, priced with the discount, because an invited operator is here to
  // pick one.
  const ref = normalizeReferralCode((await searchParams)?.ref) ?? normalizeReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value);
  const offer = ref ? await lookupPromoOffer(ref) : null;

  const showPricing = (await fetchLandingPricingEnabled()) || !!offer;
  const plans = showPricing ? await fetchSignupPlans() : null;

  return (
    <>
      {offer && <ReferralBanner offer={offer} />}
      <Hero />
      <CredibilityStrip />
      <OperationsDashboard />
      <SocialProof />
      <ProblemSection />
      <ProductShowcase />
      <Timeline />
      {plans && <PricingSection plans={plans} offer={offer} />}
      <FAQSection />
      <CTABand />
    </>
  );
}
