import { DEFAULT_HOW_IT_WORKS, STEP_ICONS } from "@nw/lib/cms/defaults";
import { resolveIcon } from "@nw/lib/cms/icons";
import { completeRows } from "@nw/lib/cms/merge";
import { loadSection } from "@nw/lib/cms/server";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { SITE_CONTAINER, SectionHeading } from "@nw/site-v2/kit";
import { StepCard } from "@nw/site-v2/sections/step-card";

/** One column on phones, two on tablets, then a row of up to four. */
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * v2 of `components/sections/how-it-works-section.tsx` — same two sources in
 * the same order (`home / how_it_works`, falling back to
 * `promotions / how_it_works`), same rule that whichever has STEPS owns the
 * whole band, same icon choice (the operator's, then position).
 */
const EMPTY = { title: "", subtitle: "", steps: [] as unknown[] };

export async function HowItWorksSection() {
  const [home, promo] = await Promise.all([
    loadSection("home", "how_it_works", EMPTY),
    loadSection("promotions", "how_it_works", DEFAULT_HOW_IT_WORKS),
  ]);

  const usingHome = Array.isArray(home.steps) && home.steps.length > 0;
  const path = usingHome ? "home.how_it_works" : "promotions.how_it_works";
  const content = usingHome
    ? {
        title: home.title.trim() || DEFAULT_HOW_IT_WORKS.title,
        subtitle: home.subtitle.trim() || DEFAULT_HOW_IT_WORKS.subtitle,
        steps: home.steps,
      }
    : promo;

  const steps = completeRows(content.steps, DEFAULT_HOW_IT_WORKS.steps).slice(0, 6);

  if (steps.length === 0) return null;

  const cols = COLS[steps.length] ?? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section {...cmsSection(path, "How it works")} className={`${SITE_CONTAINER} pt-12 md:pt-16`}>
      <SectionHeading
        title={<Editable path={`${path}.title`}>{content.title}</Editable>}
        description={<Editable path={`${path}.subtitle`}>{content.subtitle}</Editable>}
      />

      <div className={`mt-5 grid gap-4 ${cols}`}>
        {steps.map((step, index) => (
          <StepCard
            key={`${step.title}-${index}`}
            title={step.title}
            description={step.description}
            cmsPath={`${path}.steps.${index}`}
            step={index + 1}
            icon={resolveIcon(step.icon, resolveIcon(STEP_ICONS[Math.min(index, STEP_ICONS.length - 1)]))}
          />
        ))}
      </div>
    </section>
  );
}
