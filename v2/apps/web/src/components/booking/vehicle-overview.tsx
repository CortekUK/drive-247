"use client";

import {
  CalendarRange,
  CircleDashed,
  Fuel,
  Gauge,
  Hash,
  Palette,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { cn } from "@/lib/utils";
import { VEHICLE_CATEGORY_LABELS, type Vehicle } from "@/lib/vehicles/types";

import { Pill } from "./field-primitives";

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

  const categoryLabel = vehicle.category
    ? VEHICLE_CATEGORY_LABELS[vehicle.category]
    : (vehicle.categoryRaw ?? null);

  const rates: Array<{ label: string; amount: number | null; offered: boolean }> = [
    { label: "per day", amount: vehicle.dailyRent, offered: vehicle.availableDaily },
    { label: "per week", amount: vehicle.weeklyRent, offered: vehicle.availableWeekly },
    { label: "per month", amount: vehicle.monthlyRent, offered: vehicle.availableMonthly },
  ];
  const offeredRates = rates.filter((rate) => rate.offered && rate.amount !== null);

  const specs: Array<{ icon: LucideIcon; label: string; value: string }> = [];
  if (vehicle.year !== null) {
    specs.push({ icon: CalendarRange, label: "Year", value: String(vehicle.year) });
  }
  if (categoryLabel) {
    specs.push({ icon: Tag, label: "Class", value: categoryLabel });
  }
  if (vehicle.colour) {
    specs.push({ icon: Palette, label: "Colour", value: vehicle.colour });
  }
  if (vehicle.fuelType) {
    specs.push({ icon: Fuel, label: "Fuel", value: vehicle.fuelType });
  }
  if (vehicle.mileageIsUnlimited) {
    specs.push({ icon: Gauge, label: "Mileage", value: "Unlimited" });
  } else if (vehicle.dailyMileage !== null) {
    specs.push({
      icon: Gauge,
      label: "Mileage",
      value: `${vehicle.dailyMileage.toLocaleString()}${distanceLabel ? ` ${distanceLabel}` : ""} / day`,
    });
  }
  /*
    The SECURITY DEPOSIT is deliberately absent from this grid.

    `vehicles.security_deposit` is only what the customer pays when the tenant
    runs `deposit_mode = 'per_vehicle'`; on a 'global' tenant the real figure is
    `tenants.global_deposit_amount` and the vehicle's column is ignored. This
    tenant is global with a zero amount, so printing the vehicle's $500 here
    would advertise a deposit the bill does not charge. `computeQuote` already
    resolves the mode, so the deposit is stated once, in the price block, by the
    only code that knows which number is real.
  */
  if (vehicle.excessMileageRate !== null && vehicle.excessMileageRate > 0) {
    specs.push({
      icon: CircleDashed,
      label: "Excess rate",
      value: `${formatCurrency(vehicle.excessMileageRate)} / ${distanceLabel ?? "unit"}`,
    });
  }
  // Null whenever the tenant hides plates — see `canRevealRegistration`.
  if (vehicle.registration) {
    specs.push({ icon: Hash, label: "Registration", value: vehicle.registration });
  }

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
