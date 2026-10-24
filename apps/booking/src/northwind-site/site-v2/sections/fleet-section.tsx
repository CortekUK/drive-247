import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { getTenantSlug } from "@nw/lib/cms/server";
import { HomeFleet } from "@nw/site-v2/sections/home-fleet";

/**
 * The home page's cars — "Ready to drive". Loaded on the server so the
 * operator's cars are in the first HTML; the live query takes over in the
 * browser (see `home-fleet.tsx`, which also owns the heading, because its
 * arrow buttons drive the row). The seed never throws: an unreachable fleet
 * renders the empty state, not an error page.
 */
export async function FleetSection() {
  const seed = await loadFleetSeed(await getTenantSlug());
  return <HomeFleet seed={seed} />;
}
