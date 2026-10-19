import { DEFAULT_WHY_CHOOSE_US } from "@nw/lib/cms/defaults";
import { resolveIcon } from "@nw/lib/cms/icons";
import { completeRows } from "@nw/lib/cms/merge";
import { isEditMode, loadSection } from "@nw/lib/cms/server";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { SITE_CONTAINER, SectionHeading } from "@nw/site-v2/kit";
import { FeatureCard } from "@nw/site-v2/sections/feature-card";

/**
 * v2 of `components/sections/why-choose-us-section.tsx` — same key
 * (`about / why_choose_us`), same marks, same rule that POSITION picks the
 * card's shape: item 1 is the tall photo card, 2 and 3 the small icon pair,
 * 4 the quieter closing card. Anything past the fourth is dropped.
 */
export async function WhyChooseUsSection() {
  const [content, editing] = await Promise.all([
    loadSection("about", "why_choose_us", DEFAULT_WHY_CHOOSE_US),
    isEditMode(),
  ]);
  const items = completeRows(content.items, DEFAULT_WHY_CHOOSE_US.items).slice(0, 4);
  const subtitle = content.subtitle.trim();

  const featureCard = items[0];
  const smallCards = items.slice(1, 3);
  const mutedCard = items[3];

  // The shipped photo is the floor for stored items that predate the `image` key.
  const featureImage = featureCard?.image?.trim() ? featureCard.image : DEFAULT_WHY_CHOOSE_US.items[0].image;
  const featureImageAlt = featureCard?.image_alt?.trim()
    ? featureCard.image_alt
    : DEFAULT_WHY_CHOOSE_US.items[0].image_alt;

  return (
    <section {...cmsSection("about.why_choose_us", "Why choose us")} className={`${SITE_CONTAINER} pt-12 md:pt-16`}>
      <SectionHeading
        title={<Editable path="about.why_choose_us.title">{content.title}</Editable>}
        description={
          subtitle !== "" || editing ? (
            <Editable path="about.why_choose_us.subtitle" placeholder="Add a line under the heading">
              {subtitle}
            </Editable>
          ) : undefined
        }
      />

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[5fr_7fr]">
        {featureCard && (
          <FeatureCard
            title={featureCard.title}
            description={featureCard.description}
            cmsPath="about.why_choose_us.items.0"
            variant="feature"
            imageSrc={featureImage}
            imageAlt={featureImageAlt ?? ""}
            imageCmsPath="about.why_choose_us.items.0.image"
          />
        )}

        <div className="flex flex-col gap-4">
          {smallCards.length > 0 && (
            <div className="grid flex-1 gap-4 sm:grid-cols-2">
              {smallCards.map((card, index) => (
                <FeatureCard
                  key={`${card.title}-${index}`}
                  title={card.title}
                  description={card.description}
                  cmsPath={`about.why_choose_us.items.${index + 1}`}
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
              cmsPath="about.why_choose_us.items.3"
              variant="muted"
              className="h-auto"
            />
          )}
        </div>
      </div>
    </section>
  );
}
