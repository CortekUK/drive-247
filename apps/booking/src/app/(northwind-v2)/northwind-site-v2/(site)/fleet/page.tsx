import { headers } from "next/headers";

import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { formatMoney } from "@nw/components/fleet/format";
import { DEV_FALLBACK_TENANT_SLUG, TENANT_HEADER } from "@nw/lib/constants";
import { pageMetadata } from "@nw/lib/cms/metadata";
import { CenteredHeader } from "@nw/site-v2/kit";
import { FleetCarsSection, FleetPricingSection } from "@nw/site-v2/sections/fleet-pricing-section";
import { HomeCta } from "@nw/site-v2/sections/home-cta";
import { ScrollReveal } from "@nw/site-v2/sections/scroll-reveal";
import { TestimonialsSection } from "@nw/site-v2/sections/testimonials-section";

/**
 * Northwind booking site v2 — /fleet. Its one job is choosing a car: a
 * centred headline with the facts a renter weighs first (how many cars, the
 * lowest price), one strip explaining daily, weekly and monthly prices, then
 * the cars. Reviews (once there are any) and the closing scene after.
 */

export function generateMetadata() {
  return pageMetadata("fleet", "Fleet and Pricing");
}

export default async function NorthwindV2FleetPage() {
  const requestHeaders = await headers();
  const tenantSlug = requestHeaders.get(TENANT_HEADER) ?? DEV_FALLBACK_TENANT_SLUG;
  const seed = await loadFleetSeed(tenantSlug);

  const cars = seed?.vehicles ?? [];
  const rates = cars.map((v) => v.dailyRent).filter((r): r is number => r != null && r > 0);
  const facts = [
    cars.length > 0 ? `${cars.length} ${cars.length === 1 ? "car" : "cars"}` : null,
    rates.length > 0 ? `from ${formatMoney(Math.min(...rates), seed?.currencyCode ?? null)} a day` : null,
  ].filter(Boolean);

  return (
    <>
      <ScrollReveal />
      <CenteredHeader
        title="Our cars and prices"
        description="Every car we rent, with its price. Choose one to pick your dates and see the total for your trip."
        meta={facts.length > 0 ? facts.join(" · ") : undefined}
        wave
      />
      <FleetPricingSection seed={seed} />
      <FleetCarsSection seed={seed} />
      <TestimonialsSection />
      <HomeCta />
    </>
  );
}
