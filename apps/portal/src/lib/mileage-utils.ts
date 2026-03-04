export type MileageTier = 'daily' | 'weekly' | 'monthly';

interface VehicleMileage {
  daily_mileage?: number | null;
  weekly_mileage?: number | null;
  monthly_mileage?: number | null;
}

/** Determine mileage tier based on rental days (matches pricing tier logic). */
export function getMileageTier(rentalDays: number): MileageTier {
  if (rentalDays > 30) return 'monthly';
  if (rentalDays >= 7) return 'weekly';
  return 'daily';
}

/** Get the per-unit mileage allowance for a tier. Returns null if unlimited. */
export function getTierMileage(vehicle: VehicleMileage, tier: MileageTier): number | null {
  switch (tier) {
    case 'daily': return vehicle.daily_mileage ?? null;
    case 'weekly': return vehicle.weekly_mileage ?? null;
    case 'monthly': return vehicle.monthly_mileage ?? null;
  }
}

/**
 * Calculate total mileage allowance for a rental.
 * daily (<7d): days × daily_mileage
 * weekly (7-30d): (days/7) × weekly_mileage
 * monthly (>30d): (days/30) × monthly_mileage
 * Returns null if the tier has unlimited mileage.
 */
export function calculateTotalMileageAllowance(vehicle: VehicleMileage, rentalDays: number): number | null {
  const tier = getMileageTier(rentalDays);
  const perUnit = getTierMileage(vehicle, tier);
  if (perUnit === null) return null;

  switch (tier) {
    case 'daily': return rentalDays * perUnit;
    case 'weekly': return Math.ceil(rentalDays / 7) * perUnit;
    case 'monthly': return Math.ceil(rentalDays / 30) * perUnit;
  }
}

/** Check if all mileage tiers are unlimited (all null). */
export function isUnlimitedMileage(vehicle: VehicleMileage): boolean {
  return vehicle.daily_mileage == null && vehicle.weekly_mileage == null && vehicle.monthly_mileage == null;
}
