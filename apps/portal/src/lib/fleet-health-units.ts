import type { DistanceUnit } from "@/lib/format-utils";

/**
 * Distance handling for Fleet Health.
 *
 * WHY THIS EXISTS
 *
 * `vehicle_odometer_readings.reading` and `vehicle_maintenance_rules.interval_miles`
 * are plain integers. Nothing in the database records what unit a number was
 * typed in — `vehicle_odometer_readings.unit` defaults to 'mi' and the client
 * never set it, so a kilometre reading was stored indistinguishable from a mile
 * reading and read back labelled "mi".
 *
 * Two designs were possible: store each tenant's raw number and carry the unit
 * alongside it, or convert once at the UI boundary and keep ONE canonical unit
 * in the database. This module implements the second, because the first leaves
 * cross-tenant maths wrong in a way no label can fix — `vehicle_daily_burn`
 * takes a platform-wide median across every tenant, and a median over a mix of
 * miles and kilometres is not a distance at all.
 *
 * So: **everything in the database is miles.** The operator sees, and types,
 * their own unit. Conversion happens here and nowhere else.
 *
 * Today this is a no-op for every live tenant — all 50 are on miles, so
 * `toStoredMiles` is the identity function and no existing row changes meaning.
 * It starts mattering with the first kilometre tenant.
 */

/** 1 mile in kilometres. The international mile, exact by definition. */
export const KM_PER_MILE = 1.609344;

/**
 * The unit every reading is stored in.
 *
 * `vehicle_odometer_readings.unit` has a CHECK constraint of ('mi','km'), so
 * this is written explicitly rather than left to the column default — a default
 * is a silent assumption, and this one was wrong for four months.
 */
export const STORED_UNIT = "mi" as const;

/**
 * Convert a number the operator typed, in their tenant's unit, into the miles
 * that go into the database.
 *
 * Returns a rounded integer because both target columns are integers; rounding
 * here rather than at the call site keeps the round-trip stable (a value shown
 * as 10,000 km stores as 6,214 mi and displays as 10,000 km again).
 */
export function toStoredMiles(value: number, unit: DistanceUnit): number {
  if (!Number.isFinite(value)) return value;
  return unit === "km" ? Math.round(value / KM_PER_MILE) : Math.round(value);
}

/**
 * Convert a stored miles value into the tenant's display unit.
 *
 * Null and undefined pass straight through: "no reading yet" is a real state
 * and must not become 0, which is itself a legitimate odometer value.
 */
export function fromStoredMiles(
  value: number | null | undefined,
  unit: DistanceUnit,
): number | null | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  return unit === "km" ? Math.round(value * KM_PER_MILE) : value;
}

/**
 * Convert a reading that was stored under an explicit unit into miles.
 *
 * Rows written before this module existed carry unit='mi' and are already
 * canonical, so this only does work for a row that genuinely recorded 'km'.
 */
export function readingToMiles(reading: number, storedUnit: string | null | undefined): number {
  return storedUnit === "km" ? Math.round(reading / KM_PER_MILE) : reading;
}
