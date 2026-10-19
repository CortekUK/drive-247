import { headers } from "next/headers";

import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { DEV_FALLBACK_TENANT_SLUG, TENANT_HEADER } from "@nw/lib/constants";
import { pageMetadata } from "@nw/lib/cms/metadata";
import { PageIntro } from "@nw/site-v2/kit";
import { CtaBanner } from "@nw/site-v2/sections/cta-banner";
import { FaqSection } from "@nw/site-v2/sections/faq-section";
import { FleetInclusionsSection } from "@nw/site-v2/sections/fleet-inclusions-section";
import { FleetPricingSection } from "@nw/site-v2/sections/fleet-pricing-section";
import { TestimonialsSection } from "@nw/site-v2/sections/testimonials-section";

export function generateMetadata() {
  return pageMetadata("fleet", "Fleet and Pricing");
}

/**
 * Northwind booking site v2 — the fleet page.
 *
 * Same data path as v1's `(booking)/fleet/page.tsx`: the vehicle list is seeded
 * on the server (`loadFleetSeed`) so the first paint carries real cars, and the
 * client query takes over when it lands. `?pickup=` / `?dropoff=` are read in
 * the browser component, not here (see the v1 page for why).
 *
 * v1 opens with the shared photo hero, but on /fleet its copy is hardcoded (the
 * CMS `about / hero` only feeds /about), so v2 opens with the plain PageIntro.
 */
export default async function NorthwindV2FleetPage() {
  const requestHeaders = await headers();
  const tenantSlug = requestHeaders.get(TENANT_HEADER) ?? DEV_FALLBACK_TENANT_SLUG;
  const seed = await loadFleetSeed(tenantSlug);

  return (
    <>
      <PageIntro
        title="Fleet and pricing"
        description="Every car we run, with live prices and the mileage included. Find the one you want and reserve it in a couple of minutes."
      />
      <FleetPricingSection seed={seed} />
      <FleetInclusionsSection />
      <TestimonialsSection />
      <FaqSection />
      <CtaBanner />
    </>
  );
}
