import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { formatMoney } from "@nw/components/fleet/format";
import { getTenantSlug } from "@nw/lib/cms/server";
import { loadT3Cars } from "@nw/template-3/cars";
import { Template3Hero } from "@nw/template-3/hero";

/**
 * Template 3 ("Cinematic") — home. The hero only, for now: one pinned scene
 * that the scroll plays through (the line-up, the statement, three reasons,
 * the close).
 */

export const metadata = { title: "Template 3" };

export default async function Template3Home() {
  const seed = await loadFleetSeed(await getTenantSlug());
  const rents = (seed?.vehicles ?? []).map((vehicle) => vehicle.dailyRent).filter((rent): rent is number => !!rent && rent > 0);
  const fromDaily = rents.length ? formatMoney(Math.min(...rents), seed?.currencyCode ?? null) : null;

  return <Template3Hero fromDaily={fromDaily} cars={loadT3Cars()} />;
}
