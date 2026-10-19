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
import { fetchSignupPlans } from "@/lib/plans-server";
import { fetchEnterpriseCard } from "@/lib/enterprise-card-server";
import { fetchTestimonials } from "@/lib/testimonials-server";
import { lookupPromoOffer } from "@/lib/promo-lookup-server";
import { normalizeReferralCode } from "@/lib/referral-cookie";
import { fetchLandingVersion, parseLandingPreview } from "@/lib/landing-version-server";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { LandingV2 } from "@/components/landing-v2/landing-v2";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; landing?: string }>;
}) {
  // The pricing tier section (and with it self-serve signup) shows whenever at
  // least one plan is switched on in the admin Signup Plans page. There is no
  // separate master switch: hiding every plan hides the section.
  //
  // `connection()` renders this page per request, explicitly, so a referral
  // arrival (`?ref=`) is read fresh. The plan catalogue keeps its own
  // 10-second cache.
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
   * invite banner on every direct visit since, with no way to dismiss it.
   *
   * The cookie has NOT gone anywhere: it is still set by /r/{code}, still read
   * by the onboarding provider, and still applies the discount at checkout. An
   * invited operator who wanders off and comes back a week later is quoted the
   * standard price here, and still pays the discounted one. What it no longer
   * does is drive this page's chrome.
   */
  const ref = normalizeReferralCode((await searchParams)?.ref);
  const offer = ref ? await lookupPromoOffer(ref) : null;

  const [catalogue, testimonials, enterprise] = await Promise.all([
    fetchSignupPlans(),
    fetchTestimonials(),
    fetchEnterpriseCard(),
  ]);
  // `null` = every plan is switched off, so no pricing section at all.
  const plans = catalogue.length > 0 ? catalogue : null;

  /*
   * v1 or v2 of the landing page — the super-admin switch on the Signup Plans
   * tab (`admin_settings.landing_version`), failing to v1. `?landing=v1|v2`
   * previews either one without flipping the switch for everyone.
   */
  const version =
    parseLandingPreview((await searchParams)?.landing) ?? (await fetchLandingVersion());

  if (version === "v2") {
    return <LandingV2 plans={plans} offer={offer} />;
  }

  return (
    <>
      <Header />
      <main id="main" className="min-h-[calc(100vh-4rem)]">
        {offer && <ReferralBanner offer={offer} />}
        <Hero />
        <CredibilityStrip />
        <OperationsDashboard />
        <SocialProof testimonials={testimonials} />
        <ProblemSection />
        <ProductShowcase />
        <Timeline />
        {plans && <PricingSection plans={plans} offer={offer} enterprise={enterprise} />}
        <FAQSection />
        <CTABand />
      </main>
      <Footer />
    </>
  );
}
