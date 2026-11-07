import { Hero } from "@/components/sections/hero";
import { OperationsDashboard } from "@/components/sections/operations-dashboard";
import { RentalCards } from "@/components/sections/rental-cards";
import { LaunchSection } from "@/components/sections/launch-section";
import { TuroSection } from "@/components/sections/turo-section";
import { BeyondTuro } from "@/components/sections/beyond-turo";
import { CalendarSection } from "@/components/sections/calendar-section";
import { TemplatesSection } from "@/components/sections/templates-section";
import { TraxSection } from "@/components/sections/trax-section";
import { BookingDemo } from "@/components/sections/booking-demo";
import { PwaSection } from "@/components/sections/pwa-section";
import { TraxWidgetSection } from "@/components/sections/trax-widget-section";
import { LandingTour } from "@/components/tour/landing-tour";
import { MultichatSection } from "@/components/sections/multichat-section";
import { EndToEndSection } from "@/components/sections/end-to-end-section";
import { KnowNumbers } from "@/components/sections/know-numbers";
import { IntegrationsSection } from "@/components/sections/integrations-section";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { NumbersSection } from "@/components/sections/numbers-section";
import { OperatorMap } from "@/components/sections/operator-map";
import { fetchOperatorMap } from "@/lib/operator-map-server";
import { StoriesSection } from "@/components/sections/stories-section";
import { MarketingSection } from "@/components/sections/marketing-section";
import { LeadsSection } from "@/components/sections/leads-section";
import { TuroSyncSection } from "@/components/sections/turo-sync-section";
import { BookDemoSection } from "@/components/sections/book-demo-section";
import { BlogSection } from "@/components/sections/blog-section";
import { FAQSection } from "@/components/sections/faq-section";
import { connection } from "next/server";

import { NameYourBusiness } from "@/components/sections/name-your-business";
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
import { LandingTheme } from "@/components/shared/landing-theme";

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

  const [catalogue, testimonials, enterprise, operators] = await Promise.all([
    fetchSignupPlans(),
    fetchTestimonials(),
    fetchEnterpriseCard(),
    fetchOperatorMap(),
  ]);
  // `null` = every plan is switched off, so no pricing section at all.
  const plans = catalogue.length > 0 ? catalogue : null;
  // The hero's "N-day free trial": the shortest trial across the live plans, and only
  // when every plan has one, so the promise holds whichever plan a visitor picks.
  const trialDays =
    plans && plans.every((plan) => (plan.trialDays ?? 0) > 0)
      ? Math.min(...plans.map((plan) => plan.trialDays ?? 0))
      : 0;

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
    <LandingTheme>
      <Header overHero floatingTrial />
      <main id="main" className="min-h-[calc(100vh-4rem)]">
        {offer && <ReferralBanner offer={offer} />}
        {/* Ghulam's order (2026-11-07). Keep it exactly as listed; change only on his word. */}
        <Hero trialDays={trialDays} />
        {/* Your own: portal, booking site, domain, renter portal */}
        <OperationsDashboard />
        {/* ID verification, insurance, agreements, payments */}
        <RentalCards />
        <CalendarSection />
        <MultichatSection />
        {/* Insights */}
        <KnowNumbers />
        <TraxSection />
        {/* Templates, then the domain: "What's your rental company called?" */}
        <TemplatesSection />
        <NameYourBusiness signup={plans !== null} />
        {/* The booking demo */}
        <BookingDemo />
        {/* Mobile: the portals install like apps */}
        <PwaSection />
        {/* Trax as a desktop and phone widget, which comes with the installed app (coming soon) */}
        <TraxWidgetSection />
        <IntegrationsSection />
        {/* Sales and marketing */}
        <MarketingSection />
        <LeadsSection />
        <EndToEndSection />
        {/* Turo: what it costs, growing your own brand beside it, then the extension */}
        <TuroSection plans={plans ?? undefined} />
        <BeyondTuro />
        <TuroSyncSection />
        {/* Credibility: numbers, operator logos, testimonials, case studies */}
        <NumbersSection />
        {operators.length > 0 && <OperatorMap initial={operators} />}
        <TestimonialsSection testimonials={testimonials} />
        <StoriesSection />
        <LaunchSection />
        {plans && <PricingSection plans={plans} offer={offer} enterprise={enterprise} detailed />}
        {/* Not sure yet? Book a demo */}
        <BookDemoSection />
        {/* Answers for anyone still unsure (placed by me at Ghulam's request) */}
        <FAQSection />
        {/* The blog, for anyone who wants to read before deciding; the footer follows */}
        <BlogSection />
        {/* The line down the whole page, and Trax in the corner walking through it. Last, so
            the sections that draw their own part of the line have measured first. */}
        <LandingTour />
      </main>
      <Footer />
    </LandingTheme>
  );
}
