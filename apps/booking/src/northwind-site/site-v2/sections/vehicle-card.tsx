import { ArrowRight, Check, Fuel, Gauge } from "lucide-react-nw";
import Link from "next/link";

import { formatMileage, formatMoney } from "@nw/components/fleet/format";
import {
  RATE_PERIOD_ADVERB,
  mileageForPeriod,
  rateForPeriod,
  vehicleHref,
  type FleetVehicle,
  type RatePeriod,
} from "@nw/components/fleet/fleet-vehicle";
import type { TripIntent } from "@nw/lib/booking/trip-intent";
import { cn } from "@nw/lib/utils";
import { CarFloor, IllustratedCar } from "@nw/site-v2/illustrations/home-scenes";
import { CARD } from "@nw/site-v2/kit";

type VehicleCardProps = {
  vehicle: FleetVehicle;
  /** `tenants.currency_code`. Never assume "$". */
  currencyCode: string | null;
  /** `tenants.distance_unit`, for the mileage allowance. */
  distanceUnit: string | null;
  /** Which rate to headline. Defaults to the daily rate. */
  period?: RatePeriod;
  /** The addresses the customer typed on the home page, carried onto the link. */
  tripIntent?: TripIntent | null;
  /**
   * On a phone, a short row instead of a tall card: the photo on the left,
   * the name, price and allowance beside it, no separate button (the whole
   * card is the link). For long lists (/fleet), so nine cars are not five
   * screens of scrolling. Tablet and up are unchanged.
   */
  compact?: boolean;
  className?: string;
};

/**
 * v2 of `components/cards/vehicle-card.tsx` — same props, same link rules
 * (`vehicleHref` with the trip intent), same rate/mileage helpers — drawn as
 * the home page's car card, so a car looks the same wherever it is listed:
 * the photo filling the top (or the drawn car on the grid floor while there
 * is none), the name and the price large, fuel and mileage, and "Choose this
 * car". The whole card is the link: the name carries a stretched `after:`
 * overlay so the accessible name stays the car's name.
 */
export function VehicleCard({
  vehicle,
  currencyCode,
  distanceUnit,
  period = "day",
  tripIntent = null,
  compact = false,
  className,
}: VehicleCardProps) {
  /** Classes that apply only in the compact phone layout. */
  const phone = (classes: string) => (compact ? classes : "");
  const href = vehicleHref(vehicle, tripIntent);
  const rate = rateForPeriod(vehicle, period);
  const mileage = mileageForPeriod(vehicle, period);
  const artId = `nwvc${vehicle.id.replace(/[^a-zA-Z0-9]/g, "")}`;

  const meta = [vehicle.categoryLabel, vehicle.year, vehicle.colour]
    .filter((part): part is string | number => part != null && part !== "")
    .join(" · ");

  const mileageText =
    mileage == null
      ? "Unlimited miles"
      : `${formatMileage(mileage, distanceUnit)} a ${period} included`;

  return (
    <article
      className={cn(
        CARD,
        "group relative flex h-full flex-col overflow-hidden transition-colors duration-200 ease-out hover:border-pv-primary/40 focus-within:border-pv-primary/40 motion-reduce:transition-none",
        phone("max-sm:flex-row"),
        className,
      )}
    >
      <div
        className={cn(
          "relative aspect-[4/3] overflow-hidden bg-pv-tint/60",
          phone("max-sm:aspect-auto max-sm:min-h-[128px] max-sm:w-[40%] max-sm:shrink-0"),
        )}
      >
        {vehicle.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
          <img
            src={vehicle.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.05] motion-reduce:transition-none"
          />
        ) : (
          <>
            <CarFloor className="absolute inset-x-0 bottom-0 h-[50%] w-full text-[#d6d4e6] dark:text-[#3f3f46]" />
            <div className="absolute inset-0 flex items-end justify-center pb-[13%] transition-transform duration-200 ease-out group-hover:scale-[1.04] motion-reduce:transition-none">
              <IllustratedCar id={artId} className="w-[80%]" />
            </div>
          </>
        )}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col p-5", phone("max-sm:p-3.5"))}>
        <div className={cn("flex items-start justify-between gap-3", phone("max-sm:flex-col max-sm:gap-2"))}>
          <div className="min-w-0 max-w-full">
            <h3 className={cn("truncate text-[18px] font-bold tracking-[-0.02em] text-pv-fg", phone("max-sm:text-[16px]"))}>
              <Link
                href={href}
                className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-pv-primary/40"
              >
                {vehicle.name}
              </Link>
            </h3>
            {meta !== "" && <p className="mt-1 truncate text-[13px] text-pv-muted-fg">{meta}</p>}
          </div>
          {rate.offered && rate.amount != null ? (
            <p className={cn("shrink-0 text-right leading-none", phone("max-sm:text-left"))}>
              <span
                className={cn(
                  "block text-[22px] font-extrabold tabular-nums tracking-[-0.02em] text-pv-fg",
                  phone("max-sm:inline max-sm:text-[19px]"),
                )}
              >
                {formatMoney(rate.amount, currencyCode)}
              </span>
              <span className={cn("mt-1 block text-[12.5px] text-pv-muted-fg", phone("max-sm:ml-1 max-sm:inline"))}>
                a {period}
              </span>
            </p>
          ) : (
            <p className="shrink-0 text-right text-[12.5px] text-pv-muted-fg">Not offered {RATE_PERIOD_ADVERB[period]}</p>
          )}
        </div>

        <ul
          className={cn(
            "mb-5 mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-pv-fg",
            phone("max-sm:mb-0 max-sm:mt-2 max-sm:gap-x-3 max-sm:text-[12px]"),
          )}
        >
          {vehicle.fuelType && (
            <li className="inline-flex items-center gap-1.5">
              <Fuel aria-hidden className="size-4 text-pv-muted-fg" strokeWidth={1.75} />
              {vehicle.fuelType}
            </li>
          )}
          <li className="inline-flex items-center gap-1.5">
            <Gauge aria-hidden className="size-4 text-pv-muted-fg" strokeWidth={1.75} />
            {mileageText}
          </li>
          {vehicle.unlimitedMileageAvailable && !vehicle.mileageIsUnlimited && (
            <li className="inline-flex items-center gap-1.5">
              <Check aria-hidden className="size-4 text-pv-success" strokeWidth={2.25} />
              Unlimited miles available
            </li>
          )}
        </ul>

        <span
          aria-hidden
          className={cn(
            "mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-full border border-pv-border text-[14px] font-semibold text-pv-fg transition-colors duration-200 group-hover:border-pv-primary group-hover:bg-pv-primary group-hover:text-pv-primary-fg motion-reduce:transition-none",
            phone("max-sm:hidden"),
          )}
        >
          Choose this car
          <ArrowRight
            className="size-4 -translate-x-1 opacity-0 transition-[transform,opacity] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
            strokeWidth={2.25}
          />
        </span>
      </div>
    </article>
  );
}
