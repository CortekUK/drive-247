import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { DEFAULT_HOME_HERO } from "@nw/lib/cms/defaults";
import { getTenantSlug, loadSection } from "@nw/lib/cms/server";
import type { HomeHeroContent } from "@nw/lib/cms/types";
import { Template2Hero } from "@nw/template-2/hero";
import type { ShowroomCar } from "@nw/template-2/showroom";

/**
 * Template 2 ("Glass") — home. Built a section at a time; the hero first,
 * since it settles the template's design language for every section after it.
 */

export const metadata = { title: "Template 2" };

/**
 * The template's own showroom, for an operator who has not set their cars:
 * cut-outs we already ship, in four different paints so the scene's colour
 * change shows. The Vanquish is vanquish.png upscaled 4x with Real-ESRGAN,
 * its feathered edge tightened, so it stays sharp on high-density screens.
 */
const TEMPLATE_CARS: ShowroomCar[] = [
  /* TEST: the team's own photo (a black Explorer on grass), cut out locally
     with rembg's BiRefNet model and sharpened, standing in for what
     prepare-hero-car will return for an operator's upload. Scene colour
     picked by hand from the paint, as the vision model will. Remove after review. */
  { src: "/booking_landingpage/test-explorer.webp", name: "Explorer ST", alt: "Black Ford Explorer ST, rear three-quarter view", color: "#3a3e4a" },
  { src: "/booking_landingpage/vanquish-hd.webp", name: "Aston Martin", alt: "White Aston Martin coupé, side view" },
  { src: "/booking_landingpage/lexus-rx-press.png", name: "Lexus RX", alt: "Olive green Lexus RX, side view" },
  { src: "/booking_landingpage/camaro.png", name: "Camaro", alt: "Red Chevrolet Camaro, front three-quarter view" },
  { src: "/booking_landingpage/rolls-royce.png", name: "Rolls-Royce", alt: "Black Rolls-Royce saloon, side view" },
];

/**
 * The operator's showroom, from `home_hero`:
 *   hero_cars   [{ image, name, alt, color }], in order — the showroom
 *   hero_image  one car (the field every template already has), when there
 *               is no list; site-v2's shipped default does not count
 */
function operatorCars(hero: HomeHeroContent): ShowroomCar[] {
  const listed = (hero as HomeHeroContent & { hero_cars?: unknown }).hero_cars;
  if (Array.isArray(listed)) {
    const cars = listed.flatMap((item): ShowroomCar[] => {
      if (!item || typeof item !== "object") return [];
      const { image, name, alt, color } = item as Record<string, unknown>;
      if (typeof image !== "string" || !image) return [];
      const title = typeof name === "string" ? name.trim() : "";
      return [{
        src: image,
        name: title || null,
        alt: (typeof alt === "string" && alt.trim()) || title || "A car from our fleet",
        color: typeof color === "string" ? color : null,
      }];
    });
    if (cars.length) return cars;
  }
  if (hero.hero_image && hero.hero_image !== DEFAULT_HOME_HERO.hero_image) {
    return [{ src: hero.hero_image, name: null, alt: hero.hero_image_alt || "A car from our fleet" }];
  }
  return TEMPLATE_CARS;
}

export default async function Template2Home() {
  const [seed, hero] = await Promise.all([
    loadFleetSeed(await getTenantSlug()),
    loadSection("home", "home_hero", DEFAULT_HOME_HERO),
  ]);
  const vehicles = seed?.vehicles ?? [];
  const dailyRents = vehicles.map((vehicle) => vehicle.dailyRent).filter((rent): rent is number => !!rent && rent > 0);

  return (
    <Template2Hero
      cars={operatorCars(hero)}
      fromDaily={dailyRents.length ? Math.min(...dailyRents) : null}
      currencyCode={seed?.currencyCode ?? null}
    />
  );
}
