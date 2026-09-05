import { StepCard } from "@/components/cards/step-card";
import { DEFAULT_HOW_IT_WORKS, STEP_ICONS } from "@/lib/cms/defaults";
import { evenGridCols } from "@/lib/cms/format";
import { resolveIcon } from "@/lib/cms/icons";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * "How It Works" — the portal's `promotions / how_it_works` section, which is
 * where the operator's numbered redemption steps live.
 *
 * The portal's step carries a `number`; the Figma card carries an amber icon
 * badge and no number. Rather than reshape a card this agent does not own, the
 * step's POSITION picks the icon and the operator's words fill the rest. Steps
 * past the fifth reuse the last icon instead of rendering an invisible one.
 */
export async function HowItWorksSection() {
  const content = await loadSection("promotions", "how_it_works", DEFAULT_HOW_IT_WORKS);
  const steps = content.steps.slice(0, 6);

  if (steps.length === 0) return null;

  return (
    <section {...cmsSection("promotions.how_it_works", "How it works")} className="bg-brand-cream">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            <Editable path="promotions.how_it_works.title">{content.title}</Editable>
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            <Editable path="promotions.how_it_works.subtitle">{content.subtitle}</Editable>
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
              cmsPath={`promotions.how_it_works.steps.${index}`}
              icon={resolveIcon(STEP_ICONS[Math.min(index, STEP_ICONS.length - 1)])}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
