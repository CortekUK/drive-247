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
 * Allowance is pro-rata by day (rounded to a whole number):
 * daily (<7d): days × daily_mileage
 * weekly (7 to monthlyTierDays-1): (weekly_mileage / 7) × days
 * monthly (>= monthlyTierDays): (monthly_mileage / monthlyTierDays) × days
 * Returns null if the tier has unlimited mileage.
 */
export function calculateTotalMileageAllowance(vehicle: VehicleMileage, rentalDays: number, monthlyTierDays: number = 30): number | null {
  const tier = getMileageTier(rentalDays, monthlyTierDays);
  const perUnit = getTierMileage(vehicle, tier);
  if (perUnit === null) return null;

  switch (tier) {
    case 'daily': return Math.round(rentalDays * perUnit);
    case 'weekly': return Math.round((perUnit / 7) * rentalDays);
    case 'monthly': return Math.round((perUnit / monthlyTierDays) * rentalDays);
  }
}

/** Check if all mileage tiers are unlimited (all null). */
export function isUnlimitedMileage(vehicle: VehicleMileage): boolean {
  return vehicle.daily_mileage == null && vehicle.weekly_mileage == null && vehicle.monthly_mileage == null;
}

interface UnlimitedUpgradeVehicle extends VehicleMileage {
  unlimited_mileage_available?: boolean | null;
  unlimited_mileage_price_daily?: number | string | null;
  unlimited_mileage_price_weekly?: number | string | null;
  unlimited_mileage_price_monthly?: number | string | null;
}

export interface UnlimitedMileagePrices {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

export interface UnlimitedMileageOption {
  /** Should the upgrade be exposed for this booking? */
  available: boolean;
  /** Which tier this booking falls into. */
  tier: MileageTier;
  /** Flat amount charged for the upgrade on this booking (0 when not available). */
  flatAmount: number;
}

const toNumberOrNull = (raw: number | string | null | undefined): number | null => {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Read the three configured tier prices off a vehicle row. */
export function getUnlimitedMileagePrices(vehicle: UnlimitedUpgradeVehicle): UnlimitedMileagePrices {
  return {
    daily: toNumberOrNull(vehicle.unlimited_mileage_price_daily),
    weekly: toNumberOrNull(vehicle.unlimited_mileage_price_weekly),
    monthly: toNumberOrNull(vehicle.unlimited_mileage_price_monthly),
  };
}

/**
 * Decide whether the unlimited-mileage upgrade should be exposed for this
 * vehicle/booking. Vehicles that are inherently unlimited (no tier limits set)
 * skip the upgrade.
 */
export function getUnlimitedMileageOption(
  vehicle: UnlimitedUpgradeVehicle,
  rentalDays: number,
  monthlyTierDays: number = 30,
): UnlimitedMileageOption {
  const tier = getMileageTier(Math.max(1, rentalDays), monthlyTierDays);
  if (isUnlimitedMileage(vehicle)) return { available: false, tier, flatAmount: 0 };
  if (vehicle.unlimited_mileage_available !== true) return { available: false, tier, flatAmount: 0 };
  const prices = getUnlimitedMileagePrices(vehicle);
  const flat = prices[tier];
  if (flat == null) return { available: false, tier, flatAmount: 0 };
  return { available: true, tier, flatAmount: flat };
}
