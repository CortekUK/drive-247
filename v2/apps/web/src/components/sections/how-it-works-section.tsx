import { StepCard } from "@/components/cards/step-card";
import { DEFAULT_HOW_IT_WORKS, STEP_ICONS } from "@/lib/cms/defaults";
import { evenGridCols } from "@/lib/cms/format";
import { resolveIcon } from "@/lib/cms/icons";
import { completeRows } from "@/lib/cms/merge";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * "How It Works" — the numbered steps band on the HOME page.
 *
 * Two sources, in order: `home / how_it_works` first, then
 * `promotions / how_it_works`.
 *
 * The band has always rendered on the home page while its only editable copy
 * lived on the PROMOTIONS page — so an operator looking at their homepage could
 * not find the field, and one editing Promotions silently rewrote their
 * homepage. Home now owns it. The promotions key is still read as a fallback so
 * every tenant who wrote steps there keeps them until they write their own, and
 * nobody's homepage empties on deploy.
 *
 * The portal's step carries a `number`; the Figma card carries an amber icon
 * badge and no number. Rather than reshape a card this agent does not own, the
 * step's POSITION picks the icon and the operator's words fill the rest. Steps
 * past the fifth reuse the last icon instead of rendering an invisible one.
 */
const EMPTY = { title: "", subtitle: "", steps: [] as unknown[] };

export async function HowItWorksSection() {
  const [home, promo] = await Promise.all([
    loadSection("home", "how_it_works", EMPTY),
    loadSection("promotions", "how_it_works", DEFAULT_HOW_IT_WORKS),
  ]);

  /* Whichever source has STEPS owns the band, headings included — mixing a
     heading from one and steps from the other would read as two half-edits. */
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

  return (
    <section {...cmsSection(path, "How it works")} className="bg-brand-cream">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            <Editable path={`${path}.title`}>{content.title}</Editable>
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            <Editable path={`${path}.subtitle`}>{content.subtitle}</Editable>
          </p>
        </header>

        <div
          className={`mt-12 grid justify-items-center gap-y-10 lg:gap-6 ${evenGridCols(steps.length)}`}
        >
          {steps.map((step, index) => (
            <StepCard
              key={`${step.title}-${index}`}
              title={step.title}
              description={step.description}
              cmsPath={`${path}.steps.${index}`}
              /* The operator's choice first; position only as the fallback.
                 The icon used to be decided purely by position, so a step moved
                 up the list silently changed its picture and there was no way
                 to say "this one is a key". Steps past the fifth still reuse
                 the last positional icon rather than rendering nothing. */
              icon={resolveIcon(
                step.icon,
                resolveIcon(STEP_ICONS[Math.min(index, STEP_ICONS.length - 1)]),
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
