import { DEFAULT_HOME_HERO } from "@nw/lib/cms/defaults";
import { loadSection } from "@nw/lib/cms/server";
import { pageMetadata } from "@nw/lib/cms/metadata";
import { SiteV2Home } from "@nw/site-v2/home";

/**
 * Northwind booking site v2 — home. Reached when the Developer-tab switch is on
 * v2, or with ?site=v2 (?site=v1 goes back).
 *
 * The hero text is the operator's own CMS `home_hero` section — the same one the
 * current site reads — so an edit in the portal shows on both versions.
 */

export function generateMetadata() {
  return pageMetadata("home", "");
}

export default async function NorthwindV2Home() {
  const hero = await loadSection("home", "home_hero", DEFAULT_HOME_HERO);

  return <SiteV2Home headline={hero.headline} subheading={hero.subheading} trustLine={hero.trust_line} />;
}
