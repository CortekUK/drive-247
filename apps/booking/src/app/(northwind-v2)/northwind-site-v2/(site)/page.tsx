import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { pageMetadata } from "@nw/lib/cms/metadata";
import { getTenantSlug } from "@nw/lib/cms/server";
import { SiteV2Hero } from "@nw/site-v2/home";
import { FleetSection } from "@nw/site-v2/sections/fleet-section";
import { HomeCta } from "@nw/site-v2/sections/home-cta";
import { HomeFaq } from "@nw/site-v2/sections/home-faq";
import { HomeSteps } from "@nw/site-v2/sections/home-steps";
import { ScrollReveal } from "@nw/site-v2/sections/scroll-reveal";
import { TestimonialsSection } from "@nw/site-v2/sections/testimonials-section";
import { WhyRentSection } from "@nw/site-v2/sections/why-rent-section";

/**
 * Northwind booking site v2 — home. Read top to bottom it answers a first-time
 * renter's questions in order: can I book here (hero search), which car (the
 * fleet), how does it work, why this company, what do I need to bring — then
 * what others say, the leftover questions, and one last way in.
 */

export function generateMetadata() {
  return pageMetadata("home", "");
}

/** The car the hero's phone shows: the operator's dearest. */
async function heroCars() {
  const seed = await loadFleetSeed(await getTenantSlug());
  const cars = [...(seed?.vehicles ?? [])]
    .sort((a, b) => (b.dailyRent ?? 0) - (a.dailyRent ?? 0))
    .slice(0, 1)
    .map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
      label: [vehicle.categoryLabel, vehicle.year].filter(Boolean).join(' · ') || null,
      dailyRent: vehicle.dailyRent,
    }));
  return { cars, currencyCode: seed?.currencyCode ?? null };
}

export default async function NorthwindV2Home() {
  const hero = await heroCars();
  return (
    <>
      <ScrollReveal />
      <SiteV2Hero cars={hero.cars} currencyCode={hero.currencyCode} />
      <FleetSection />
      <WhyRentSection />
      <HomeSteps />
      <TestimonialsSection />
      <HomeFaq />
      <HomeCta />
    </>
  );
}
