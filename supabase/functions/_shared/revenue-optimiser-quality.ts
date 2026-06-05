/**
 * Revenue Optimiser — data quality validators (Spec §13).
 *
 * Pure functions used by the backtest engine and the daily generate cron
 * to skip vehicles with malformed or missing data — protects the model from
 * garbage-in-garbage-out without hard-failing the whole run.
 */

export interface VehicleQualityCheck {
  vehicleId: string;
  isUsable: boolean;
  reason?: string;
}

export interface VehicleQualityInput {
  id: string;
  tenant_id: string | null;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  is_disposed: boolean | null;
  status: string | null;
  category: string | null;
}

/** Per-vehicle gate. Excludes broken rows from the recommendation engine. */
export function checkVehicleQuality(v: VehicleQualityInput): VehicleQualityCheck {
  if (!v.tenant_id) return { vehicleId: v.id, isUsable: false, reason: "missing_tenant" };
  if (v.is_disposed === true) return { vehicleId: v.id, isUsable: false, reason: "disposed" };
  if (v.status && ["Sold", "Retired", "Inactive"].includes(v.status)) {
    return { vehicleId: v.id, isUsable: false, reason: `inactive_status_${v.status}` };
  }
  // At least one rental tier must be priced for the engine to have anything to optimise.
  const hasAnyRate =
    (v.daily_rent != null && v.daily_rent > 0) ||
    (v.weekly_rent != null && v.weekly_rent > 0) ||
    (v.monthly_rent != null && v.monthly_rent > 0);
  if (!hasAnyRate) return { vehicleId: v.id, isUsable: false, reason: "no_rates_set" };
  return { vehicleId: v.id, isUsable: true };
}

export interface BookingQualityInput {
  id: string;
  vehicle_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  monthly_amount: number | null;
}

/** Per-booking gate for elasticity input. */
export function checkBookingQuality(b: BookingQualityInput): boolean {
  if (!b.vehicle_id || !b.start_date || !b.end_date) return false;
  // start <= end
  if (Date.parse(b.start_date) > Date.parse(b.end_date)) return false;
  // Only completed/active bookings inform elasticity — cancellations/pendings would distort it.
  if (!b.status || !["Closed", "Active"].includes(b.status)) return false;
  return true;
}

/** Sample-size gate per Spec §13.1 — need ≥12 bookings in 90d OR category fallback. */
export const MIN_BOOKINGS_PER_VEHICLE_90D = 12;
export const MIN_BOOKINGS_PER_CATEGORY_90D = 24;

/** Calibration gate per Spec §13.2 — tenant must have ≥30 days of data. */
export const MIN_TENANT_CALIBRATION_DAYS = 30;

/** Backtest period — replay last 6 months (Spec §6). */
export const BACKTEST_PERIOD_DAYS = 180;

/** Minimum delta to surface a recommendation (Spec §11.8) — skip trivial noise. */
export const MIN_RECOMMENDATION_DELTA_MONTHLY = 30;
