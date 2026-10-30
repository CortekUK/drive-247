import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { getTenantSlug } from "@nw/lib/cms/server";
import { Template2FleetPage } from "@nw/template-2/fleet-page";

/**
 * Template 2 ("Glass") — Fleet and Pricing, on the preview link beside the
 * home page (/template-2/fleet). The page is template-2/fleet-page.tsx; this
 * only loads the cars for the first paint.
 */

export const metadata = { title: "Fleet and Pricing" };

export default async function Template2FleetRoute() {
  const slug = await getTenantSlug();
  const seed = slug ? await loadFleetSeed(slug) : null;
  return <Template2FleetPage seed={seed} />;
}
