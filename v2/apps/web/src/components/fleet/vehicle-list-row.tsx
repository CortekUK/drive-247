import { Check, Fuel, Gauge, Hash } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

import { formatMileage, formatMoney } from './format';
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
} from './fleet-vehicle';
import { VehiclePhoto } from './vehicle-photo';

interface VehicleListRowProps {
  vehicle: FleetVehicle;
  currencyCode: string | null;
  distanceUnit: string | null;
  period: RatePeriod;
}

/**
 * The list view.
 *
 * Not a one-column grid — that is the trap the toggle usually falls into, where
 * "list" is the same card stretched wide and the switch buys the customer
 * nothing. This row uses the extra width for information the card has no space
 * for: the operator's own description, and ALL THREE real rates side by side so
 * a long hire can be compared without changing the period tab.
 *
 * It only BECOMES a row at `md`. The horizontal form needs a 220px photo and a
 * ~180px rate column before the description gets a single character, which at
 * 640px left the text about 90px wide — a squashed row is worse than a stacked
 * card, so below `md` this is a stacked card. Both side columns are also
 * proportional rather than fixed, because from `lg` the filter rail is taking
 * its share of the same line.
 */
export function VehicleListRow({
  vehicle,
  currencyCode,
  distanceUnit,
  period,
}: VehicleListRowProps) {
  const href = vehicleHref(vehicle);
  const active = rateForPeriod(vehicle, period);
  const mileage = mileageForPeriod(vehicle, period);

  const meta = [vehicle.year == null ? null : String(vehicle.year), vehicle.colour, vehicle.fuelType]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');

  const mileageText =
    mileage == null
      ? 'Unlimited mileage'
      : `${formatMileage(mileage, distanceUnit)}${RATE_PERIOD_MILEAGE_SUFFIX[period]} included`;

  return (
    <article className="group relative flex flex-col gap-4 rounded-[14px] border border-brand-border-soft bg-white p-4 transition-shadow hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)] md:flex-row">
      <VehiclePhoto
        url={vehicle.photoUrl}
        alt=""
        className="w-full shrink-0 md:aspect-auto md:h-auto md:w-[34%] md:max-w-[200px] md:self-stretch xl:max-w-[220px]"
        zoomOnGroupHover
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold leading-tight text-brand-text">
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:ring-2 focus-visible:after:ring-brand-forest/45"
            >
              {vehicle.name}
            </Link>
          </h3>
          {vehicle.categoryLabel && (
            <span className="rounded-full bg-brand-stone px-2 py-0.5 text-[11px] font-medium text-brand-text">
              {vehicle.categoryLabel}
            </span>
          )}
        </div>

        {meta !== '' && <p className="mt-1 text-xs text-brand-text-subtle">{meta}</p>}

        {vehicle.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-brand-text-soft">
            {vehicle.description}
          </p>
        )}

        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-brand-text-soft">
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
            <li className="inline-flex items-center gap-1.5 text-brand-text">
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

      <div className="flex shrink-0 flex-col gap-3 border-t border-brand-border-soft pt-4 md:w-[170px] md:border-l md:border-t-0 md:pl-5 md:pt-0 xl:w-[200px]">
        {active.offered && active.amount != null ? (
          <p className="leading-tight">
            <span className="block text-2xl font-semibold leading-tight text-brand-text">
              {formatMoney(active.amount, currencyCode)}
            </span>
            <span className="block text-xs leading-tight text-brand-text-subtle">
              {RATE_PERIOD_SUFFIX[period]}
            </span>
          </p>
        ) : (
          <p className="text-sm text-brand-text-subtle">Not offered {RATE_PERIOD_ADVERB[period]}</p>
        )}

        <dl className="space-y-1 text-xs">
          {RATE_PERIODS.filter((value) => value !== period).map((value) => {
            const rate = rateForPeriod(vehicle, value);
            return (
              <div key={value} className="flex items-baseline justify-between gap-2">
                <dt className="text-brand-text-subtle">{RATE_PERIOD_TAB_LABEL[value]}</dt>
                <dd
                  className={cn(
                    'tabular-nums',
                    rate.offered && rate.amount != null
                      ? 'text-brand-text-soft'
                      : 'text-brand-text-subtle',
                  )}
                >
                  {rate.offered && rate.amount != null
                    ? formatMoney(rate.amount, currencyCode)
                    : '—'}
                </dd>
              </div>
            );
          })}
        </dl>

        <Link
          href={href}
          tabIndex={-1}
          aria-hidden
          className="relative z-10 mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand-forest px-4 py-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 md:min-h-0 md:w-auto"
        >
          Rent Now
        </Link>
      </div>
    </article>
  );
}
