import { Check, Fuel, Gauge, Hash } from "lucide-react";
import Link from "next/link";

import { formatMileage, formatMoney } from "@/components/fleet/format";
import {
  RATE_PERIOD_ADVERB,
  RATE_PERIOD_MILEAGE_SUFFIX,
  RATE_PERIOD_SUFFIX,
  mileageForPeriod,
  rateForPeriod,
  vehicleHref,
  type FleetVehicle,
  type RatePeriod,
} from "@/components/fleet/fleet-vehicle";
import { VehiclePhoto } from "@/components/fleet/vehicle-photo";
import type { TripIntent } from "@/lib/booking/trip-intent";
import { cn } from "@/lib/utils";

type VehicleCardProps = {
  vehicle: FleetVehicle;
  /** `tenants.currency_code`. Never assume "$" — most operators are not in USD. */
  currencyCode: string | null;
  /** `tenants.distance_unit`, for the mileage allowance. */
  distanceUnit: string | null;
  /** Which rate to headline. Defaults to the daily rate. */
  period?: RatePeriod;
  /**
   * The addresses the customer typed on the home page, if any.
   *
   * Threaded onto BOTH links below so the intent survives the click. Without it
   * the customer is asked for an address they have already given — which is the
   * exact hop where their input used to die. Omitted (`/fleet` reached directly,
   * the home-page strip) it changes nothing: `vehicleHref` returns the bare path.
   */
  tripIntent?: TripIntent | null;
  className?: string;
};

/**
 * One vehicle, as a card.
 *
 * The WHOLE card navigates to that vehicle's booking page, in the same tab: the
 * heading carries a stretched link (`after:absolute after:inset-0`) so the click
 * target is the card while the accessible name stays the car's name. "Book Now"
 * sits above it on its own z-index and remains the explicit affordance — it is
 * the second link rather than a nested one, because an `<a>` inside an `<a>` is
 * invalid HTML and browsers recover from it unpredictably.
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

  const meta = [vehicle.year, vehicle.colour]
    .filter((part): part is string | number => part != null && part !== "")
    .join(" · ");

  const mileageText =
    mileage == null
      ? "Unlimited mileage"
      : `${formatMileage(mileage, distanceUnit)}${RATE_PERIOD_MILEAGE_SUFFIX[period]}`;

  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-[14px] border border-brand-border-soft bg-white p-4 transition-shadow hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]",
        className,
      )}
    >
      <div className="relative">
        {/* No height: `VehiclePhoto` is 16:10, so the frame tracks the column
            width instead of letterboxing a 320px-wide phone card into 136px. */}
        <VehiclePhoto url={vehicle.photoUrl} alt="" zoomOnGroupHover />
        {vehicle.categoryLabel && (
          <span className="absolute left-2 top-2 rounded-full bg-brand-card/90 px-2 py-0.5 text-[11px] font-medium text-brand-text">
            {vehicle.categoryLabel}
          </span>
        )}
      </div>

      <header className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-brand-text sm:text-sm">
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:ring-2 focus-visible:after:ring-brand-forest/45"
            >
              {vehicle.name}
            </Link>
          </h3>
          {meta !== "" && (
            <p className="truncate text-xs leading-tight text-brand-text-subtle">{meta}</p>
          )}
        </div>
        <BrandWingsMark className="shrink-0 text-brand-text-subtle" />
      </header>

      <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-tight text-brand-text-soft">
        {vehicle.fuelType && (
          <li className="inline-flex items-center gap-1">
            <Fuel aria-hidden className="size-3" strokeWidth={1.75} />
            {vehicle.fuelType}
          </li>
        )}
        <li className="inline-flex items-center gap-1">
          <Gauge aria-hidden className="size-3" strokeWidth={1.75} />
          {mileageText}
        </li>
        {/* Present only when the tenant permits plates — `registration` is
            already null otherwise, so there is nothing to hide here. */}
        {vehicle.registration && (
          <li className="inline-flex items-center gap-1">
            <Hash aria-hidden className="size-3" strokeWidth={1.75} />
            {vehicle.registration}
          </li>
        )}
      </ul>

      {vehicle.unlimitedMileageAvailable && !vehicle.mileageIsUnlimited && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs leading-tight text-brand-text">
          <Check aria-hidden className="size-3" strokeWidth={2.25} />
          Unlimited mileage available
        </p>
      )}

      <footer className="mt-auto flex items-end justify-between gap-3 pt-4">
        {rate.offered && rate.amount != null ? (
          <p className="leading-tight">
            <span className="block text-2xl font-semibold leading-tight text-brand-text sm:text-xl">
              {formatMoney(rate.amount, currencyCode)}
            </span>
            <span className="block text-xs leading-tight text-brand-text-subtle">
              {RATE_PERIOD_SUFFIX[period]}
            </span>
          </p>
        ) : (
          <p className="text-xs leading-tight text-brand-text-subtle">
            Not offered {RATE_PERIOD_ADVERB[period]}
          </p>
        )}

        <Link
          href={href}
          tabIndex={-1}
          aria-hidden
          className="relative z-10 inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-brand-forest px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 sm:min-h-0"
        >
          Book Now
        </Link>
      </footer>
    </article>
  );
}

function BrandWingsMark({ className }: { className?: string }) {
  return (
    <svg
      width="34"
      height="14"
      viewBox="0 0 34 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M17 7 L1 4 L4 6 L1 7 L4 8 L1 10 L17 7 L33 4 L30 6 L33 7 L30 8 L33 10 L17 7Z"
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="17" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}
