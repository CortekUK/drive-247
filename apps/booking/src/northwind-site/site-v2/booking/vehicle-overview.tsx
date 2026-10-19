"use client";

import { describeVehicle } from "@nw/components/booking/vehicle-facts";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";
import type { Vehicle } from "@nw/lib/vehicles/types";
import { StatusChip } from "@nw/portal-v2/status-chip";

/**
 * The vehicle, described — v2. Same props and the same facts as
 * `components/booking/vehicle-overview` (both read `describeVehicle`), laid out
 * as a record page: chips, the headline rates, one line of description, then
 * the specs as a calm key/value grid.
 *
 * The name is NOT repeated here: on the v2 booking page it is the page title.
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

  const hasChips = categoryLabel !== null || vehicle.mileageIsUnlimited || vehicle.isPaused;

  return (
    <div className={cn("space-y-5", className)}>
      {hasChips || offeredRates.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {offeredRates.length > 0 ? (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              {offeredRates.map((rate, position) => (
                <p key={rate.label} className="leading-tight">
                  <span
                    className={cn(
                      "font-bold tabular-nums tracking-[-0.02em] text-pv-fg",
                      position === 0 ? "text-[22px]" : "text-[15px] font-semibold",
                    )}
                  >
                    {formatCurrency(rate.amount ?? 0)}
                  </span>
                  <span className="ml-1 text-[13px] text-pv-muted-fg">{rate.label}</span>
                </p>
              ))}
            </div>
          ) : (
            <span />
          )}

          {hasChips ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {categoryLabel ? <StatusChip>{categoryLabel}</StatusChip> : null}
              {vehicle.mileageIsUnlimited ? (
                <StatusChip tone="success">Unlimited mileage</StatusChip>
              ) : null}
              {vehicle.isPaused ? <StatusChip tone="warning">Currently paused</StatusChip> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {vehicle.description ? (
        <p className="max-w-2xl text-[14px] leading-relaxed text-pv-muted-fg">{vehicle.description}</p>
      ) : null}

      {specs.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-pv-border pt-5 sm:grid-cols-3">
          {specs.map((spec) => (
            <div key={spec.label} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-pv-muted-fg">
                <spec.icon aria-hidden strokeWidth={1.75} className="size-3.5" />
                {spec.label}
              </dt>
              <dd className="mt-1 truncate text-[14px] font-medium text-pv-fg">{spec.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
