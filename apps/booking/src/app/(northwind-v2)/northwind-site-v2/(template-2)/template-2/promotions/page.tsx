import { loadFleetSeed } from "@nw/components/fleet/fleet-seed";
import { DEFAULT_PROMOTIONS_TERMS } from "@nw/lib/cms/defaults";
import { getSection } from "@nw/lib/cms/merge";
import { getTenantSlug, loadPageSections, loadPromotions } from "@nw/lib/cms/server";
import { Template2PromotionsPage } from "@nw/template-2/promotions-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/**
 * Template 2 ("Glass") — Promotions, on the preview link (/template-2/promotions).
 * Same sources as site-v2's page; the page is template-2/promotions-page.tsx.
 */

export const metadata = { title: "Promotions" };

type Step = { number?: string; title?: string; description?: string };
const EMPTY_HOW = { title: "", subtitle: "", steps: [] as Step[] };

export default async function Template2PromotionsRoute() {
  const slug = await getTenantSlug();
  const [seed, sections, fleet] = await Promise.all([
    loadPromotions(),
    loadPageSections("promotions"),
    slug ? loadFleetSeed(slug) : Promise.resolve(null),
  ]);

  const how = getSection(sections, "how_it_works", EMPTY_HOW);
  // Kept with their STORED index: the editor writes back by position.
  const steps = (how.steps ?? [])
    .map((step, index) => ({ index, title: (step.title ?? "").trim(), description: (step.description ?? "").trim() }))
    .filter((step) => step.title !== "");
  const terms = getSection(sections, "terms", DEFAULT_PROMOTIONS_TERMS);

  return (
    <>
      <Template2PromotionsPage
        seed={seed}
        sections={sections}
        fleet={fleet}
        steps={steps}
        stepsTitle={how.title.trim()}
        stepsSubtitle={how.subtitle.trim()}
        termsTitle={terms.title.trim()}
        terms={terms.terms.filter((term) => term.trim() !== "")}
      />
      <Template2PageClosing />
    </>
  );
}
