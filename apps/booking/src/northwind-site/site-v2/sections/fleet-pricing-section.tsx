import { FleetBrowser } from "@nw/site-v2/fleet/fleet-browser";
import type { FleetSeed } from "@nw/components/fleet/fleet-vehicle";
import { DEFAULT_RENTAL_RATES } from "@nw/lib/cms/defaults";
import { resolveIcon } from "@nw/lib/cms/icons";
import { loadSection } from "@nw/lib/cms/server";
import type { RentalRateCard } from "@nw/lib/cms/types";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { CARD, ICON_TILE, Section, SectionHeading } from "@nw/site-v2/kit";
import { cn } from "@nw/lib/utils";

type FleetPricingSectionProps = {
  /** Server-rendered vehicles for the first paint, from `loadFleetSeed()`. */
  seed?: FleetSeed | null;
};

/** Icon per rental period, by position — the portal's shape carries no icon. */
const RATE_ICONS = ["calendar-days", "clock", "car"] as const;

/**
 * v2 of `components/sections/fleet-pricing-section.tsx`: the fleet band, same
 * CMS read (`fleet / rental_rates`, same default), same editor affordances
 * (`cmsSection` + `Editable` paths). The period cards still appear only when
 * the operator has written them. The client boundary starts at `FleetBrowser`.
 */
export async function FleetPricingSection({ seed = null }: FleetPricingSectionProps) {
  const rates = await loadSection("fleet", "rental_rates", DEFAULT_RENTAL_RATES);

  const periods: { key: "daily" | "weekly" | "monthly"; card: RentalRateCard }[] = (
    [
      { key: "daily", card: rates.daily },
      { key: "weekly", card: rates.weekly },
      { key: "monthly", card: rates.monthly },
    ] as const
  ).filter(({ card }) => card.title.trim() !== "");

  return (
    <div id="fleet" {...cmsSection("fleet.rental_rates", "Rates")} className="scroll-mt-24">
      <Section className="pt-8 md:pt-10">
        <SectionHeading
          title={<Editable path="fleet.rental_rates.section_title">{rates.section_title}</Editable>}
          description="Filter by category, budget or fuel, then pick a car to build your booking."
        />

        {periods.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {periods.map(({ key, card }, index) => {
              const Icon = resolveIcon(RATE_ICONS[index]);
              const path = `fleet.rental_rates.${key}`;
              return (
                <div key={key} className={cn(CARD, "flex items-start gap-3 px-5 py-4")}>
                  <span className={ICON_TILE}>
                    <Icon aria-hidden strokeWidth={1.75} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-pv-fg">
                      <Editable path={`${path}.title`}>{card.title}</Editable>
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">
                      <Editable path={`${path}.description`}>{card.description}</Editable>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6">
          <FleetBrowser seed={seed} />
        </div>
      </Section>
    </div>
  );
}
