import { Check, Fuel, Gauge, Hash } from "lucide-react-nw";
import Link from "next/link";

import { formatMileage, formatMoney } from "@nw/components/fleet/format";
import {
  RATE_PERIOD_ADVERB,
  RATE_PERIOD_MILEAGE_SUFFIX,
  RATE_PERIOD_SUFFIX,
  mileageForPeriod,
  rateForPeriod,
  vehicleHref,
  type FleetVehicle,
  type RatePeriod,
} from "@nw/components/fleet/fleet-vehicle";
import { VehiclePhoto } from "@nw/components/fleet/vehicle-photo";
import type { TripIntent } from "@nw/lib/booking/trip-intent";
import { cn } from "@nw/lib/utils";
import { CARD_INTERACTIVE } from "@nw/site-v2/kit";

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
  className?: string;
};

/**
 * v2 of `components/cards/vehicle-card.tsx` — same props, same link rules
 * (`vehicleHref` with the trip intent), same rate/mileage helpers. The whole
 * card is the link: the name carries a stretched `after:` overlay so the
 * accessible name stays the car's name.
 */
export function VehicleCard({
  vehicle,
  currencyCode,
  distanceUnit,
  period = "day",
  tripIntent = null,
  className,
}: VehicleCardProps) {
  const href = vehicleHref(vehicle, tripIntent);
  const rate = rateForPeriod(vehicle, period);
  const mileage = mileageForPeriod(vehicle, period);

  const meta = [vehicle.categoryLabel, vehicle.year, vehicle.colour]
    .filter((part): part is string | number => part != null && part !== "")
    .join(" · ");

  const mileageText =
    mileage == null
      ? "Unlimited mileage"
      : `${formatMileage(mileage, distanceUnit)}${RATE_PERIOD_MILEAGE_SUFFIX[period]}`;

  return (
    <article className={cn(CARD_INTERACTIVE, "group relative flex flex-col p-3", className)}>
      <VehiclePhoto url={vehicle.photoUrl} alt="" className="rounded-xl bg-pv-muted" />

      <div className="flex flex-1 flex-col px-1 pb-1 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-pv-fg">
              <Link
                href={href}
                className="outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-pv-primary/30"
              >
                {vehicle.name}
              </Link>
            </h3>
            {meta !== "" && <p className="mt-0.5 truncate text-xs text-pv-muted-fg">{meta}</p>}
          </div>
          {rate.offered && rate.amount != null ? (
            <p className="shrink-0 text-right">
              <span className="text-[15px] font-bold tabular-nums text-pv-fg">{formatMoney(rate.amount, currencyCode)}</span>
              <span className="block text-[11px] text-pv-muted-fg">{RATE_PERIOD_SUFFIX[period]}</span>
            </p>
          ) : (
            <p className="shrink-0 text-right text-[11px] text-pv-muted-fg">Not offered {RATE_PERIOD_ADVERB[period]}</p>
          )}
        </div>

        <ul className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-pv-muted-fg">
          {vehicle.fuelType && (
            <li className="inline-flex items-center gap-1">
              <Fuel aria-hidden className="size-3.5" strokeWidth={1.75} />
              {vehicle.fuelType}
            </li>
          )}
          <li className="inline-flex items-center gap-1">
            <Gauge aria-hidden className="size-3.5" strokeWidth={1.75} />
            {mileageText}
          </li>
          {vehicle.registration && (
            <li className="inline-flex items-center gap-1">
              <Hash aria-hidden className="size-3.5" strokeWidth={1.75} />
              {vehicle.registration}
            </li>
          )}
          {vehicle.unlimitedMileageAvailable && !vehicle.mileageIsUnlimited && (
            <li className="inline-flex items-center gap-1 text-pv-fg">
              <Check aria-hidden className="size-3.5 text-pv-success" strokeWidth={2.25} />
              Unlimited available
            </li>
          )}
        </ul>
      </div>
    </article>
  );
}
