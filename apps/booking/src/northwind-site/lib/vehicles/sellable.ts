/**
 * Whether a car has anything to sell online.
 *
 * A car with no daily rate cannot be quoted (every price, the weekly and monthly
 * ones included, is worked out from it), and a car with every hire length
 * switched off has no length to quote. Both were still listed on the fleet and
 * could reach checkout at $0. The operator's portal already calls these cars
 * hidden; this makes the booking site agree.
 *
 * Kept apart from availability-rules.ts on purpose: that file has a generated,
 * parity-checked twin used by Trax.
 */
export function isSellableOnline(vehicle: {
  dailyRent: number | string | null | undefined;
  availableDaily: boolean;
  availableWeekly: boolean;
  availableMonthly: boolean;
}): boolean {
  const daily = Number(vehicle.dailyRent);
  return Number.isFinite(daily) && daily > 0 && (vehicle.availableDaily || vehicle.availableWeekly || vehicle.availableMonthly);
}
