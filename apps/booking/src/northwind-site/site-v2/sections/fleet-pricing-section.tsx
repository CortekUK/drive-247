import { FleetBrowser } from "@nw/site-v2/fleet/fleet-browser";
import type { FleetSeed, FleetVehicle } from "@nw/components/fleet/fleet-vehicle";
import { formatMoney } from "@nw/components/fleet/format";
import { DEFAULT_RENTAL_RATES } from "@nw/lib/cms/defaults";
import { loadSection } from "@nw/lib/cms/server";
import type { RentalRateCard } from "@nw/lib/cms/types";
import { Editable, cmsSection } from "@nw/lib/cms/editable";
import { cn } from "@nw/lib/utils";
import { DailyRateArt, MonthlyRateArt, WeeklyRateArt } from "@nw/site-v2/illustrations/page-scenes";
import { SITE_WIDE } from "@nw/site-v2/kit";

const RATE_ART = { daily: DailyRateArt, weekly: WeeklyRateArt, monthly: MonthlyRateArt };

type FleetPricingSectionProps = {
  /** Server-rendered vehicles for the first paint, from `loadFleetSeed()`. */
  seed?: FleetSeed | null;
};

/**
 * Northwind booking site v2 — the cars themselves, at the top of /fleet: the
 * filter rail and the grid (`FleetBrowser`, where the client boundary
 * starts), the page's whole width. Every car is the home page's card.
 */
export function FleetCarsSection({ seed = null }: FleetPricingSectionProps) {
  return (
    <section id="fleet" aria-label="Our cars" className={cn(SITE_WIDE, "scroll-mt-24 pt-8 md:pt-10")}>
      <FleetBrowser seed={seed} />
    </section>
  );
}

type Period = "daily" | "weekly" | "monthly";

const PERIOD: Record<Period, { label: string; days: number; unit: string; rent: (car: FleetVehicle) => number | null }> = {
  daily: { label: "Daily", days: 1, unit: "a day", rent: (car) => (car.availableDaily ? car.dailyRent : null) },
  weekly: { label: "Weekly", days: 7, unit: "a week", rent: (car) => (car.availableWeekly ? car.weeklyRent : null) },
  monthly: { label: "Monthly", days: 30, unit: "a month", rent: (car) => (car.availableMonthly ? car.monthlyRent : null) },
};

/**
 * How the prices work, just above the cars — so the grid's Daily / Weekly /
 * Monthly switch is explained before a renter reaches it. One compact strip,
 * a step per period, every number worked out from the fleet:
 *
 *   the lowest price for that period
 *   what that comes to a day
 *   how much less a day than renting the SAME car daily ("up to 20% less a
 *   day") — compared car by car, never cheapest-week against cheapest-day
 *
 * The heading and each step's name are the operator's (`fleet / rental_rates`,
 * same editor paths as v1); a period no car is offered for is left out.
 */
export async function FleetPricingSection({ seed = null }: FleetPricingSectionProps) {
  const rates = await loadSection("fleet", "rental_rates", DEFAULT_RENTAL_RATES);
  const cars = seed?.vehicles ?? [];
  const currency = seed?.currencyCode ?? null;

  const steps = (["daily", "weekly", "monthly"] as const)
    .map((key) => {
      const { days, rent } = PERIOD[key];
      const prices = cars.map(rent).filter((price): price is number => price != null && price > 0);
      if (prices.length === 0) return null;
      const lowest = Math.min(...prices);
      const savings = cars
        .map((car) => {
          const price = rent(car);
          return price && car.dailyRent ? 1 - price / (days * car.dailyRent) : 0;
        })
        .filter((saving) => saving > 0);
      const best = savings.length > 0 ? Math.round(Math.max(...savings) * 100) : 0;
      const card: RentalRateCard = rates[key];
      return { key, lowest, perDay: lowest / days, best, title: card.title.trim() };
    })
    .filter((step): step is NonNullable<typeof step> => step !== null);

  if (steps.length === 0) return null;

  return (
    <section
      {...cmsSection("fleet.rental_rates", "Rates")}
      aria-labelledby="fleet-rates-title"
      className={cn(SITE_WIDE, "pt-10 md:pt-14")}
    >
      <div data-reveal className="grid gap-4 rounded-3xl bg-pv-tint p-3 sm:p-4 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:items-center xl:gap-6">
        <div className="px-3 pt-3 xl:py-3">
          <h2 id="fleet-rates-title" className="text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-pv-fg md:text-[24px]">
            <Editable path="fleet.rental_rates.section_title">{rates.section_title}</Editable>
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-pv-muted-on-tint">
            Rent by the day, the week or the month. The longer you keep a car, the less each day costs.
          </p>
        </div>

        <ol className={cn("grid gap-3", steps.length === 3 ? "md:grid-cols-3" : steps.length === 2 ? "md:grid-cols-2" : "")}>
          {steps.map(({ key, lowest, perDay, best, title }) => {
            const Art = RATE_ART[key];
            return (
              <li key={key} className="flex items-center gap-4 rounded-2xl bg-pv-card p-4 md:max-xl:flex-col md:max-xl:items-start md:max-xl:gap-3">
                <span className="grid size-[72px] shrink-0 place-items-center rounded-xl bg-pv-tint/70 p-1.5">
                  <Art className="w-full" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold uppercase tracking-[0.08em] text-pv-muted-fg">
                    {title ? <Editable path={`fleet.rental_rates.${key}.title`}>{title}</Editable> : PERIOD[key].label}
                  </span>
                  <span className="mt-1 block whitespace-nowrap text-[15px] text-pv-muted-fg">
                    from{" "}
                    <span className="text-[22px] font-extrabold tracking-[-0.03em] text-pv-fg">{formatMoney(lowest, currency)}</span>{" "}
                    {PERIOD[key].unit}
                  </span>
                  {key === "daily" ? (
                    <span className="mt-0.5 block text-[13px] text-pv-muted-fg">Any number of days</span>
                  ) : (
                    <span className="mt-0.5 block text-[13px] text-pv-muted-fg">
                      about {formatMoney(Math.round(perDay), currency)} a day
                      {best > 0 ? (
                        <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-pv-success-light px-2 py-0.5 text-[12px] font-semibold text-pv-success">
                          up to {best}% less
                        </span>
                      ) : null}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
