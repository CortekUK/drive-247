import { FeatureCard } from "@/components/cards/feature-card";
import { DEFAULT_WHY_CHOOSE_US } from "@/lib/cms/defaults";
import { resolveIcon } from "@/lib/cms/icons";
import { loadSection } from "@/lib/cms/server";

/**
 * "Why Choose Us" — the portal's `about / why_choose_us` section.
 *
 * The Figma layout is four fixed slots of three different shapes: one tall
 * image card, two small icon cards, one wide muted card with the shield. The
 * portal's shape is a flat ordered list of `{ icon, title, description }`, so
 * POSITION decides the shape here — item 1 is the tall card, 2 and 3 are the
 * small pair, 4 is the muted band. An operator who writes only two items gets
 * the first two shapes and no holes; anything past the fourth is dropped rather
 * than breaking the grid.
 *
 * The section subtitle is a design constant: the portal has no field for it.
 */
const SUBTITLE =
  "Experience a new standard of mobility where luxury meets absolute convenience.";

export async function WhyChooseUsSection() {
  const content = await loadSection("about", "why_choose_us", DEFAULT_WHY_CHOOSE_US);
  const items = content.items.slice(0, 4);

  const featureCard = items[0];
  const smallCards = items.slice(1, 3);
  const mutedCard = items[3];

  return (
    <section className="bg-white">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            {content.title}
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            {SUBTITLE}
          </p>
        </header>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-[5fr_7fr]">
          {featureCard && (
            <FeatureCard
              title={featureCard.title}
              description={featureCard.description}
              variant="feature"
              imageSrc="/booking_landingpage/rolls-royce.png"
              imageAlt="Rolls-Royce Phantom"
            />
          )}

          <div className="flex flex-col gap-5">
            {smallCards.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2">
                {smallCards.map((card, index) => (
                  <FeatureCard
                    key={`${card.title}-${index}`}
                    title={card.title}
                    description={card.description}
                    icon={resolveIcon(card.icon)}
                    variant="small"
                  />
                ))}
              </div>
            )}

            {mutedCard && (
              <FeatureCard
                title={mutedCard.title}
                description={mutedCard.description}
                variant="muted"
                imageSrc="/booking_landingpage/shield.png"
                imageAlt="Privacy shield"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
