import { CalendarDays, ClipboardCheck } from "lucide-react";

import { FeatureCard } from "@/components/cards/feature-card";
import { CHOOSE_US } from "@/lib/fixtures/landing";

const SMALL_ICONS = {
  flexible: ClipboardCheck,
  availability: CalendarDays,
} as const;

export function WhyChooseUsSection() {
  const featureCard = CHOOSE_US.find((item) => item.variant === "feature");
  const smallCards = CHOOSE_US.filter((item) => item.variant === "small");
  const mutedCard = CHOOSE_US.find((item) => item.variant === "muted");

  return (
    <section className="bg-white">
      <div className="container-page py-12 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            Why Choose Us?
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            Experience a new standard of mobility where luxury meets absolute
            convenience.
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
            <div className="grid gap-5 sm:grid-cols-2">
              {smallCards.map((card) => {
                const Icon = SMALL_ICONS[card.id as keyof typeof SMALL_ICONS];
                return (
                  <FeatureCard
                    key={card.id}
                    title={card.title}
                    description={card.description}
                    icon={Icon}
                    variant="small"
                  />
                );
              })}
            </div>

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
