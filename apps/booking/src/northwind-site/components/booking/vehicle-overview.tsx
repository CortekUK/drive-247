"use client";

import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";
import type { Vehicle } from "@nw/lib/vehicles/types";

import { Pill } from "./field-primitives";
import { describeVehicle } from "./vehicle-facts";

/**
 * The vehicle, described — the body of the card in the left rail.
 *
 * Everything shown here comes off the allowlisted row that
 * `vehiclePublicColumns()` produced, so there is nothing on this page that a
 * customer is not entitled to see. The registration in particular is already
 * null when the tenant hides plates — it is not fetched and then concealed.
 *
 * It is sized for a ~380px rail, not for a full-width hero: the name tops out
 * at `text-2xl` and the spec grid is two columns wide at every width the rail
 * is ever rendered at. The middle `sm:grid-cols-3` step only ever applies on a
 * tablet, where the card spans the page because the grid has not split yet.
 */
export function VehicleOverview({
  vehicle,
  className,
}: {
  vehicle: Vehicle;
  className?: string;
}) {
  const { formatCurrency, distanceLabel } = useTenantBranding();

  const { categoryLabel, offeredRates, specs } = describeVehicle(vehicle, {
    formatCurrency,
    distanceLabel,
  });

  return (
    <div className={cn("space-y-3", className)}>
      <header className="space-y-2">
        {categoryLabel || vehicle.mileageIsUnlimited || vehicle.isPaused ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {categoryLabel ? <Pill>{categoryLabel}</Pill> : null}
            {vehicle.mileageIsUnlimited ? (
              <Pill tone="positive">Unlimited mileage</Pill>
            ) : null}
            {vehicle.isPaused ? <Pill tone="notice">Currently paused</Pill> : null}
          </div>
        ) : null}

        <h1 className="text-xl font-semibold leading-tight tracking-tight text-brand-text sm:text-2xl">
          {vehicle.displayName}
        </h1>

        {offeredRates.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {offeredRates.map((rate, position) => (
              <p key={rate.label} className="leading-tight">
                <span
                  className={cn(
                    "font-semibold tabular-nums text-brand-text",
                    position === 0 ? "text-xl" : "text-sm",
                  )}
                >
                  {formatCurrency(rate.amount ?? 0)}
                </span>
                <span className="ml-1 text-xs text-brand-text-subtle">
                  {rate.label}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </header>

      {vehicle.description ? (
        <p className="text-xs leading-relaxed text-brand-text-soft">
          {vehicle.description}
        </p>
      ) : null}

      {specs.length > 0 ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-brand-border-soft bg-brand-border-soft sm:grid-cols-3 lg:grid-cols-2">
          {specs.map((spec) => (
            <div key={spec.label} className="bg-white px-3 py-2.5">
              <dt className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.07em] text-brand-text-subtle">
                <spec.icon aria-hidden strokeWidth={1.75} className="size-3" />
                {spec.label}
              </dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-brand-text">
                {spec.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
