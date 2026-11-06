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
  certificatesExpired?: boolean;
}): boolean {
  const daily = Number(vehicle.dailyRent);
  return (
    Number.isFinite(daily) &&
    daily > 0 &&
    (vehicle.availableDaily || vehicle.availableWeekly || vehicle.availableMonthly) &&
    vehicle.certificatesExpired !== true
  );
}

/** Today as yyyy-mm-dd in the customer's own calendar. */
function todayKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * True when the inspection or the registration date is set and already past.
 * The portal shows the same car "Off the road"; the booking site must agree.
 */
export function certificatesExpired(row: { mot_due_date?: string | null; tax_due_date?: string | null }, now = new Date()): boolean {
  const today = todayKey(now);
  const past = (d: string | null | undefined) => !!d && String(d).slice(0, 10) < today;
  return past(row.mot_due_date) || past(row.tax_due_date);
}
