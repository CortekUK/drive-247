/**
 * Domain layer — the pure calculation engines behind the v2 booking flow.
 *
 * Everything under src/lib/domain is deliberately FREE of React, next/*, and
 * Supabase. Data in, numbers out. That is what makes the live sidebar bill
 * testable and what lets the same maths be re-run on the server later without
 * dragging a component tree along.
 *
 * Four of these files are ports of v1 (apps/booking/src/lib) and are kept in
 * lockstep with it by scripts-v2-guard/check-pricing-parity.sh. If a customer
 * price and a staff price ever disagree, that script tells you which copy
 * drifted. Do not "improve" the maths here in isolation.
 */

// ── Pricing engine ─────────────────────────────────────────────────────────
export {
  parseDateString,
  calculateRentalPriceBreakdown,
} from './calculate-rental-price';
export type {
  VehicleRates,
  TenantWeekendConfig,
  Holiday,
  VehicleOverride,
  VehicleDailyPrice,
  DayBreakdown,
  PricingTier,
  RentalPriceResult,
} from './calculate-rental-price';

// ── Mileage allowance ──────────────────────────────────────────────────────
export {
  getMileageTier,
  getTierMileage,
  calculateTotalMileageAllowance,
  isUnlimitedMileage,
  getUnlimitedMileagePrices,
  getUnlimitedMileageOption,
} from './mileage-utils';
export type {
  MileageTier,
  UnlimitedMileagePrices,
  UnlimitedMileageOption,
} from './mileage-utils';

// ── Rental extras ──────────────────────────────────────────────────────────
export { extraLineTotal, calcExtrasTotal } from './calculate-extras-total';
export type { PricedExtra } from './calculate-extras-total';

// ── Delivery pricing ───────────────────────────────────────────────────────
export {
  normalizeTiers,
  hasActiveTiers,
  getMaxDistanceKm,
  resolveDeliveryFee,
  getTierFeeRange,
  getEffectiveDeliveryRadius,
} from './delivery-tiers';
export type {
  DeliveryTier,
  DeliveryTierConfig,
  ResolvedDeliveryFee,
} from './delivery-tiers';

// ── Vehicle identity: what a customer may LEARN and may SEE ────────────────
// vehiclePublicColumns is an ALLOWLIST, not a convenience. Public vehicle
// queries must go through it — `select('*')` on `vehicles` ships lockbox_code,
// purchase_price and security_notes to anyone holding the anon key.
export {
  isRegistrationHidden,
  canRevealRegistration,
  vehiclePublicColumns,
  vehiclePublicColumnsNested,
  displayRegistration,
  vehicleDisplayName,
  vehicleDisplayLabel,
  canSearchByRegistration,
  customerPhotoUrl,
  canRedactPhotos,
  VEHICLE_PHOTO_COLUMNS,
} from './vehicle-identity';
export type { VehicleIdentity, VehiclePhoto } from './vehicle-identity';

// ── Date-only helpers (read the trap note in date-utils.ts) ────────────────
export {
  parseDateOnly,
  formatDateOnly,
  todayDateString,
  calendarDaysBetween,
} from './date-utils';
