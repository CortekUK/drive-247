import {
  CalendarRange,
  CircleDashed,
  Fuel,
  Gauge,
  Hash,
  Palette,
  Tag,
} from "lucide-react-nw";
import type { LucideIcon } from "lucide-react-nw";

import { VEHICLE_CATEGORY_LABELS, type Vehicle } from "@nw/lib/vehicles/types";

/**
 * What the booking page says about a vehicle — its class, the rates it is
 * offered at, and the spec grid — as data. `vehicle-overview.tsx` (current
 * site) and `@nw/site-v2/booking/vehicle-overview` both draw from this, so the
 * two can differ in look but never in which facts they show.
 *
 * Everything comes off the allowlisted row that `vehiclePublicColumns()`
 * produced, so there is nothing here a customer is not entitled to see.
 */

export interface VehicleRate {
  label: string;
  amount: number | null;
  offered: boolean;
}

export interface VehicleSpec {
  icon: LucideIcon;
  label: string;
  value: string;
}

export interface VehicleFacts {
  categoryLabel: string | null;
  /** Only the rates the vehicle is actually offered at, in day/week/month order. */
  offeredRates: VehicleRate[];
  specs: VehicleSpec[];
}

export function describeVehicle(
  vehicle: Vehicle,
  {
    formatCurrency,
    distanceLabel,
  }: { formatCurrency: (amount: number) => string; distanceLabel: string | null },
): VehicleFacts {
  const categoryLabel = vehicle.category
    ? VEHICLE_CATEGORY_LABELS[vehicle.category]
    : (vehicle.categoryRaw ?? null);

  const rates: VehicleRate[] = [
    { label: "per day", amount: vehicle.dailyRent, offered: vehicle.availableDaily },
    { label: "per week", amount: vehicle.weeklyRent, offered: vehicle.availableWeekly },
    { label: "per month", amount: vehicle.monthlyRent, offered: vehicle.availableMonthly },
  ];
  const offeredRates = rates.filter((rate) => rate.offered && rate.amount !== null);

  const specs: VehicleSpec[] = [];
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

  return { categoryLabel, offeredRates, specs };
}
