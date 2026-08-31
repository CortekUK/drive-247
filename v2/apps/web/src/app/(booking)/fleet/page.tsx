import { headers } from "next/headers";

import { loadFleetSeed } from "@/components/fleet/fleet-seed";
import { AboutHeroSection } from "@/components/sections/about-hero-section";
import { CtaBanner } from "@/components/sections/cta-banner";
import { FaqSection } from "@/components/sections/faq-section";
import { FleetPricingSection } from "@/components/sections/fleet-pricing-section";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { DEV_FALLBACK_TENANT_SLUG, TENANT_HEADER } from "@/lib/constants";

export const metadata = { title: "Fleet and Pricing" };

/**
 * The fleet page.
 *
 * The vehicle list is fetched HERE, on the server, and handed to the client
 * browser as its first render. `useVehicles()` is a client hook, so without
 * this the page would ship a skeleton and nothing else — no car names for a
 * crawler, and an empty frame for anyone on a slow connection. The client query
 * still runs and takes over the moment it lands; this only decides what the
 * first paint contains.
 */
export default async function FleetPage() {
  // The middleware resolves the tenant from the subdomain (or a custom booking
  // domain) and forwards it as `x-tenant-slug`. The dev fallback is a belt for
  // the same braces and is itself gated on NODE_ENV inside constants.ts.
  const requestHeaders = await headers();
  const tenantSlug = requestHeaders.get(TENANT_HEADER) ?? DEV_FALLBACK_TENANT_SLUG;
  const seed = await loadFleetSeed(tenantSlug);

  return (
    <>
      <AboutHeroSection
        imageSrc="/booking_landingpage/fleet-hero.jpg"
        imageAlt="Row of luxury SUVs"
        imageObjectPosition="center"
        heading="Our Fleet."
        body="Every vehicle we run, with live pricing and the mileage included before you book. Find the one you want and reserve it in a couple of minutes."
        ctaLabel="Browse vehicles"
        ctaHref="#fleet"
      />
      <FleetPricingSection seed={seed} />
      <TestimonialsSection />
      <FaqSection />
      <CtaBanner />
    </>
  );
}
