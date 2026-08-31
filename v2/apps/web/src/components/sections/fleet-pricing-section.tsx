import { FeatureCard } from "@/components/cards/feature-card";
import { FleetBrowser } from "@/components/fleet/fleet-browser";
import type { FleetSeed } from "@/components/fleet/fleet-vehicle";
import { DEFAULT_RENTAL_RATES } from "@/lib/cms/defaults";
import { resolveIcon } from "@/lib/cms/icons";
import { loadSection } from "@/lib/cms/server";
import type { RentalRateCard } from "@/lib/cms/types";

type FleetPricingSectionProps = {
  /**
   * Server-rendered vehicles for the first paint, from `loadFleetSeed()`.
   * Optional: without it the browser simply starts on its loading state.
   */
  seed?: FleetSeed | null;
};

/** Icon per rental period, by position — the portal's shape carries no icon. */
const RATE_ICONS = ["calendar-days", "clock", "car"] as const;

/**
 * The fleet band on /fleet.
 *
 * This used to map the static `FLEET` fixture — six identical "Vanquish · 2024
 * Silver Birch · $500" cards — and invent weekly and monthly prices by
 * multiplying the daily rate by 6 and 22. Both are gone: the vehicles are the
 * tenant's real rows, and each period shows the operator's own `weekly_rent` /
 * `monthly_rent`, which on real data are not multiples of the daily rate.
 *
 * The heading and the three period cards now come from the portal's
 * `fleet / rental_rates`. The cards default to empty — they are not in the
 * Figma design — so they appear only for an operator who has written them, and
 * the page an unconfigured tenant gets is unchanged.
 *
 * The client boundary still starts at `FleetBrowser`, so the heading and the
 * rate copy ship in the HTML.
 */
export async function FleetPricingSection({ seed = null }: FleetPricingSectionProps) {
  const rates = await loadSection("fleet", "rental_rates", DEFAULT_RENTAL_RATES);

  const periods: RentalRateCard[] = [rates.daily, rates.weekly, rates.monthly].filter(
    (card) => card.title.trim() !== "",
  );

  return (
    <section id="fleet" className="scroll-mt-24 bg-white">
      <div className="container-page py-12 lg:py-20">
        <header className="max-w-2xl">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            {rates.section_title}
          </h2>
          <p className="mt-4 max-w-[520px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            Every car we run, with the rate and the mileage you actually get.
            Filter by category, budget or fuel, then pick a vehicle to build your
            booking.
          </p>
        </header>

        {periods.length > 0 && (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {periods.map((card, index) => (
              <FeatureCard
                key={`${card.title}-${index}`}
                title={card.title}
                description={card.description}
                icon={resolveIcon(RATE_ICONS[index])}
                variant="small"
              />
            ))}
          </div>
        )}

        <div className="mt-10">
          <FleetBrowser seed={seed} />
        </div>
      </div>
    </section>
  );
}
