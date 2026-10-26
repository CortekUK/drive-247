import { ArrowRight, Check, Fuel, Gauge, Hash } from 'lucide-react-nw';
import Link from 'next/link';

import { formatMileage, formatMoney } from '@nw/components/fleet/format';
import {
  RATE_PERIODS,
  RATE_PERIOD_ADVERB,
  RATE_PERIOD_MILEAGE_SUFFIX,
  RATE_PERIOD_SUFFIX,
  RATE_PERIOD_TAB_LABEL,
  mileageForPeriod,
  rateForPeriod,
  vehicleHref,
  type FleetVehicle,
  type RatePeriod,
} from '@nw/components/fleet/fleet-vehicle';
import type { TripIntent } from '@nw/lib/booking/trip-intent';

import { VehiclePhoto } from '@nw/components/fleet/vehicle-photo';

interface VehicleListRowProps {
  vehicle: FleetVehicle;
  currencyCode: string | null;
  distanceUnit: string | null;
  period: RatePeriod;
  /** The home-page addresses, carried onto this row's link. */
  tripIntent?: TripIntent | null;
}

/**
 * v2 of `components/fleet/vehicle-list-row.tsx`: one row of the list panel,
 * like an operator portal v2 table row (divided, `bg-pv-row-hover` on hover).
 * It uses the width for what the card cannot carry — the description and all
 * three real rates side by side — and only becomes a row at `md`; below that it
 * stacks (the v1 file explains why a squashed row is worse).
 */
export function VehicleListRow({ vehicle, currencyCode, distanceUnit, period, tripIntent = null }: VehicleListRowProps) {
  const href = vehicleHref(vehicle, tripIntent);
  const active = rateForPeriod(vehicle, period);
  const mileage = mileageForPeriod(vehicle, period);

  const meta = [vehicle.categoryLabel, vehicle.year == null ? null : String(vehicle.year), vehicle.colour]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');

  const mileageText =
    mileage == null
      ? 'Unlimited mileage'
      : `${formatMileage(mileage, distanceUnit)}${RATE_PERIOD_MILEAGE_SUFFIX[period]} included`;

  return (
    <article className="group relative flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 transition-colors duration-200 ease-out hover:bg-pv-row-hover motion-reduce:transition-none md:flex-nowrap md:items-center md:gap-5">
      <VehiclePhoto
        url={vehicle.photoUrl}
        alt=""
        className="w-[112px] shrink-0 rounded-xl bg-pv-muted md:aspect-auto md:h-[96px] md:w-[150px]"
      />

      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold leading-tight text-pv-fg">
          <Link
            href={href}
            className="outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-pv-primary/40"
          >
            {vehicle.name}
          </Link>
        </h3>
        {meta !== '' && <p className="mt-0.5 text-xs text-pv-muted-fg">{meta}</p>}

        {vehicle.description && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-pv-muted-fg">{vehicle.description}</p>
        )}

        <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-pv-muted-fg">
          <li className="inline-flex items-center gap-1.5">
            <Gauge aria-hidden className="size-3.5" strokeWidth={1.75} />
            {mileageText}
          </li>
          {vehicle.fuelType && (
            <li className="inline-flex items-center gap-1.5">
              <Fuel aria-hidden className="size-3.5" strokeWidth={1.75} />
              {vehicle.fuelType}
            </li>
          )}
          {vehicle.unlimitedMileageAvailable && !vehicle.mileageIsUnlimited && (
            <li className="inline-flex items-center gap-1.5 text-pv-success">
              <Check aria-hidden className="size-3.5" strokeWidth={2.25} />
              Unlimited mileage available
            </li>
          )}
          {vehicle.registration && (
            <li className="inline-flex items-center gap-1.5">
              <Hash aria-hidden className="size-3.5" strokeWidth={1.75} />
              {vehicle.registration}
            </li>
          )}
        </ul>
      </div>

      <div className="flex w-full shrink-0 items-end justify-between gap-4 border-t border-pv-border pt-3 md:w-[200px] md:flex-col md:items-stretch md:border-l md:border-t-0 md:pl-5 md:pt-0">
        <div className="min-w-0">
          {active.offered && active.amount != null ? (
            <p className="leading-tight">
              <span className="text-lg font-bold tabular-nums text-pv-fg">{formatMoney(active.amount, currencyCode)}</span>
              <span className="ml-1 text-[11px] text-pv-muted-fg">{RATE_PERIOD_SUFFIX[period]}</span>
            </p>
          ) : (
            <p className="text-[13px] text-pv-muted-fg">Not offered {RATE_PERIOD_ADVERB[period]}</p>
          )}

          <dl className="mt-1.5 space-y-0.5 text-xs">
            {RATE_PERIODS.filter((value) => value !== period).map((value) => {
              const rate = rateForPeriod(vehicle, value);
              return (
                <div key={value} className="flex items-baseline justify-between gap-3">
                  <dt className="text-pv-muted-fg">{RATE_PERIOD_TAB_LABEL[value]}</dt>
                  <dd className="tabular-nums text-pv-fg">
                    {rate.offered && rate.amount != null ? formatMoney(rate.amount, currencyCode) : '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        <Link
          href={href}
          tabIndex={-1}
          aria-hidden
          className="relative z-10 inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-pv-primary px-4 text-[13px] font-medium text-pv-primary-fg transition-colors duration-200 ease-out hover:bg-pv-primary-hover motion-reduce:transition-none md:h-9"
        >
          Book
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </article>
  );
}
