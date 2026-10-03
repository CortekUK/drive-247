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
import { ReferralBanner } from "@/components/sections/referral-banner";
import { fetchLandingPricingEnabled } from "@/lib/landing-pricing-server";
import { fetchSignupPlans } from "@/lib/plans-server";
import { lookupPromoOffer } from "@/lib/promo-lookup-server";
import { normalizeReferralCode } from "@/lib/referral-cookie";

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

  /*
   * A Drive247 referral code THIS REQUEST arrived with.
   *
   * Only `?ref=`, deliberately — not the cookie. `/r/{code}` sets the cookie
   * and redirects to `/?ref=CODE#pricing`, so both ways in carry the parameter
   * and an arrival is the same shape either way.
   *
   * This used to fall back to the cookie, which reads as the same thing and is
   * not. The cookie lasts 90 days and nothing on this page clears it, so one
   * click on a referral link three months ago greeted that browser with an
   * invite banner on every direct visit since, with no way to dismiss it — and,
   * worse, the `|| !!offer` below meant a stale cookie kept the pricing grid
   * and self-serve signup switched ON for that visitor after an admin had
   * deliberately switched them off.
   *
   * The cookie has NOT gone anywhere: it is still set by /r/{code}, still read
   * by the onboarding provider, and still applies the discount at checkout. An
   * invited operator who wanders off and comes back a week later is quoted the
   * standard price here, and still pays the discounted one. What it no longer
   * does is drive this page's chrome.
   */
  const ref = normalizeReferralCode((await searchParams)?.ref);
  const offer = ref ? await lookupPromoOffer(ref) : null;

  /*
   * The admin switch decides this, except for someone arriving on an invite:
   * they were sent here to pick a plan, so the grid is shown and priced with
   * their discount even while self-serve signup is off (brief R5).
   *
   * `offer` is now a FRESH arrival only, which is what keeps that exception
   * honest. It used to be satisfied by a 90-day-old cookie, so a browser that
   * had once touched a referral link kept seeing pricing an admin had switched
   * off — for up to three months, with nothing on screen explaining why.
   */
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
