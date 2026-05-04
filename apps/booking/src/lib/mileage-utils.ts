export type MileageTier = 'daily' | 'weekly' | 'monthly';

interface VehicleMileage {
  daily_mileage?: number | null;
  weekly_mileage?: number | null;
  monthly_mileage?: number | null;
}

/** Determine mileage tier based on rental days (matches pricing tier logic). */
export function getMileageTier(rentalDays: number, monthlyTierDays: number = 30): MileageTier {
  if (rentalDays >= monthlyTierDays) return 'monthly';
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
 * weekly (7 to monthlyTierDays-1): (days/7) × weekly_mileage
 * monthly (>= monthlyTierDays): (days/monthlyTierDays) × monthly_mileage
 * Returns null if the tier has unlimited mileage.
 */
export function calculateTotalMileageAllowance(vehicle: VehicleMileage, rentalDays: number, monthlyTierDays: number = 30): number | null {
  const tier = getMileageTier(rentalDays, monthlyTierDays);
  const perUnit = getTierMileage(vehicle, tier);
  if (perUnit === null) return null;

  switch (tier) {
    case 'daily': return rentalDays * perUnit;
    case 'weekly': return Math.ceil(rentalDays / 7) * perUnit;
    case 'monthly': return Math.ceil(rentalDays / monthlyTierDays) * perUnit;
  }
}

/** Check if all mileage tiers are unlimited (all null). */
export function isUnlimitedMileage(vehicle: VehicleMileage): boolean {
  return vehicle.daily_mileage == null && vehicle.weekly_mileage == null && vehicle.monthly_mileage == null;
}

interface UnlimitedUpgradeVehicle extends VehicleMileage {
  unlimited_mileage_available?: boolean | null;
  unlimited_mileage_price_per_day?: number | string | null;
}

export interface UnlimitedMileageOption {
  /** Should the customer be shown the opt-in at checkout? */
  available: boolean;
  /** Per-day upcharge (0 when not available). */
  pricePerDay: number;
}

/**
 * Decide whether the unlimited-mileage upgrade should be exposed to the
 * customer for this vehicle. Vehicles that are inherently unlimited (no tier
 * limits set) skip the upgrade — it would be redundant.
 */
export function getUnlimitedMileageOption(vehicle: UnlimitedUpgradeVehicle): UnlimitedMileageOption {
  if (isUnlimitedMileage(vehicle)) return { available: false, pricePerDay: 0 };
  const enabled = vehicle.unlimited_mileage_available === true;
  const raw = vehicle.unlimited_mileage_price_per_day;
  const price = typeof raw === 'number' ? raw : raw != null ? Number(raw) : 0;
  if (!enabled || !Number.isFinite(price) || price <= 0) {
    return { available: false, pricePerDay: 0 };
  }
  return { available: true, pricePerDay: price };
}
