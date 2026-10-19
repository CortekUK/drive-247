import type { ReadinessVehicle } from "@nw/site-v2/sections/readiness-card";
import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { DEFAULT_HOME_HERO } from "@nw/lib/cms/defaults";
import { pageMetadata } from "@nw/lib/cms/metadata";
import { getTenantSlug, isEditMode, loadSection } from "@nw/lib/cms/server";
import { SiteV2Hero } from "@nw/site-v2/home";
import { CtaBanner } from "@nw/site-v2/sections/cta-banner";
import { FaqSection } from "@nw/site-v2/sections/faq-section";
import { FleetSection } from "@nw/site-v2/sections/fleet-section";
import { HowItWorksSection } from "@nw/site-v2/sections/how-it-works-section";
import { SafetyVerificationSection } from "@nw/site-v2/sections/safety-verification-section";
import { StatsStrip } from "@nw/site-v2/sections/stats-strip";
import { TestimonialsSection } from "@nw/site-v2/sections/testimonials-section";
import { WhyChooseUsSection } from "@nw/site-v2/sections/why-choose-us-section";

/**
 * Northwind booking site v2 — home. The same sections, in the same order, as
 * the current home page, each in its v2 form.
 *
 * The hero reads exactly what the current `HeroSection` reads: the CMS
 * `home_hero` section, the edit-mode flag, and the fleet seed — the last only
 * so the readiness card names (and links to) a real car, the cheapest one
 * (`loadFleetSeed` orders by daily rate). All three run in parallel and the
 * seed never throws, so an empty fleet just keeps the card's shipped copy.
 */

export function generateMetadata() {
  return pageMetadata("home", "");
}

export default async function NorthwindV2Home() {
  const tenantSlug = await getTenantSlug();
  const [hero, seed, editing] = await Promise.all([
    loadSection("home", "home_hero", DEFAULT_HOME_HERO),
    loadFleetSeed(tenantSlug),
    isEditMode(),
  ]);

  const featured = seed?.vehicles[0];
  const vehicle: ReadinessVehicle | null =
    featured === undefined ? null : { id: featured.id, name: featured.name, categoryLabel: featured.categoryLabel };

  return (
    <>
      <SiteV2Hero hero={hero} vehicle={vehicle} editing={editing} />
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
