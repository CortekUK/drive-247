/**
 * Shared row and view types for the customer-facing vehicle data layer.
 *
 * Two layers live here and the split is deliberate:
 *
 *  - `PublicVehicleRow` / `PublicVehiclePhotoRow` are the SHAPES THAT COME BACK
 *    over PostgREST. They are `Pick`s over the generated `Database` types, so a
 *    column name that does not exist fails to compile rather than 400-ing the
 *    whole request at runtime. That matters more than usual here: PostgREST
 *    rejects the ENTIRE row when one column is unknown, so a single typo does
 *    not degrade one field — it takes the whole fleet page to an error state.
 *    (Confirmed live: `select('id, daily_rate')` returns 42703 and no rows.
 *    The column is `daily_rent`.)
 *
 *  - `Vehicle`, `PickupLocation` and `RentalExtra` are the NORMALISED shapes the
 *    UI renders. camelCase, nulls collapsed where a component would only have to
 *    do it again, photos already resolved through the redaction rules, and the
 *    plate already withheld when the tenant hides it.
 *
 * `Vehicle` keeps the original snake_case row on `.row` on purpose: every engine
 * in `@/lib/domain` (pricing, mileage, unlimited-mileage upgrade) takes the DB
 * shape, and re-mapping camelCase back to snake_case at each call site is how
 * the two drift apart.
 */

import type { Database } from '@/integrations/supabase/types';
import type { UnlimitedMileagePrices, VehicleRates } from '@/lib/domain';

type VehicleRow = Database['public']['Tables']['vehicles']['Row'];
type VehiclePhotoRow = Database['public']['Tables']['vehicle_photos']['Row'];
type PickupLocationRow = Database['public']['Tables']['pickup_locations']['Row'];
type RentalExtraRow = Database['public']['Tables']['rental_extras']['Row'];

/* ─────────────────────────── raw row shapes ─────────────────────────── */

/**
 * The columns a customer-facing vehicle query is allowed to read.
 *
 * This mirrors the allowlist inside `vehiclePublicColumns()` — the runtime
 * select string is ALWAYS built by that function, never by this type, so there
 * is one source of truth for what leaves the database. This `Pick` is the
 * compile-time half: it proves every one of those names is a real column and
 * gives the hooks a typed row to normalise.
 *
 * `reg` is optional because the allowlist appends it only when
 * `canRevealRegistration(tenant)` is true. A tenant that hides plates never has
 * the column sent to the browser at all — it is not fetched and then hidden.
 */
export type PublicVehicleRow = Pick<
  VehicleRow,
  | 'id'
  | 'tenant_id'
  | 'make'
  | 'model'
  | 'year'
  | 'colour'
  | 'color'
  | 'category'
  | 'description'
  | 'fuel_type'
  | 'status'
  | 'photo_url'
  | 'is_disposed'
  | 'is_paused'
  | 'pickup_location_id'
  | 'tesla_fleet_enabled'
  | 'daily_rent'
  | 'weekly_rent'
  | 'monthly_rent'
  | 'security_deposit'
  | 'excess_mileage_rate'
  | 'daily_mileage'
  | 'weekly_mileage'
  | 'monthly_mileage'
  | 'unlimited_mileage_available'
  | 'unlimited_mileage_price_daily'
  | 'unlimited_mileage_price_weekly'
  | 'unlimited_mileage_price_monthly'
  | 'available_daily'
  | 'available_weekly'
  | 'available_monthly'
> & {
  /** Present only when the tenant permits plates. See `vehiclePublicColumns`. */
  reg?: string | null;
};

/** The photo columns `VEHICLE_PHOTO_COLUMNS` selects. */
export type PublicVehiclePhotoRow = Pick<
  VehiclePhotoRow,
  'photo_url' | 'redacted_url' | 'redaction_status' | 'display_order'
>;

/** A vehicle row with its photos joined, as the list/detail queries return it. */
export type PublicVehicleRowWithPhotos = PublicVehicleRow & {
  /** PostgREST omits the key entirely for a vehicle with no photo rows. */
  vehicle_photos?: PublicVehiclePhotoRow[] | null;
};

export type PublicPickupLocationRow = Pick<
  PickupLocationRow,
  | 'id'
  | 'name'
  | 'address'
  | 'description'
  | 'delivery_fee'
  | 'is_pickup_enabled'
  | 'is_return_enabled'
  | 'sort_order'
>;

export type PublicRentalExtraRow = Pick<
  RentalExtraRow,
  | 'id'
  | 'name'
  | 'description'
  | 'price'
  | 'image_urls'
  | 'max_quantity'
  | 'pricing_type'
  | 'billing_type'
  | 'sort_order'
>;

/* ──────────────────────────── categories ───────────────────────────── */

/**
 * The only values `vehicles.category` may hold — enforced by a DB CHECK
 * constraint, so this union is the schema, not a guess. All six are present in
 * the seeded fleet.
 */
export const VEHICLE_CATEGORIES = [
  'economy',
  'sedan',
  'suv',
  'luxury',
  'van',
  'electric',
] as const;

export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

/** Customer-facing labels, so each filter UI does not invent its own casing. */
export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  economy: 'Economy',
  sedan: 'Sedan',
  suv: 'SUV',
  luxury: 'Luxury',
  van: 'Van',
  electric: 'Electric',
};

/**
 * Narrow a raw `category` string to the union, tolerating casing/whitespace.
 * Returns null for anything outside the CHECK constraint — which would mean the
 * constraint was dropped, so the honest answer is "uncategorised", not a crash.
 */
export function toVehicleCategory(raw: string | null | undefined): VehicleCategory | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return (VEHICLE_CATEGORIES as readonly string[]).includes(key)
    ? (key as VehicleCategory)
    : null;
}

/* ─────────────────────────── normalised views ──────────────────────── */

/** One gallery image, already resolved through the plate-redaction rules. */
export interface VehicleImage {
  /** The URL a CUSTOMER should see — redacted copy where one was published. */
  url: string;
  /** `display_order` from the row; missing orders sort last. */
  displayOrder: number;
}

/**
 * A vehicle as the fleet grid and the vehicle page render it.
 *
 * Every field here is either directly renderable or directly consumable by a
 * `@/lib/domain` engine. Nothing in here needs a second null-check in JSX
 * except the genuinely-optional descriptive fields.
 */
export interface Vehicle {
  id: string;
  tenantId: string | null;

  // ── Identity ──
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  /**
   * `vehicleDisplayName()` — never empty, and never falls back to the plate for
   * a tenant that hides plates. Safe as a heading.
   */
  displayName: string;
  /** Name plus plate when the tenant permits it; never leaves empty brackets. */
  displayLabel: string;
  /** The plate, or null when the tenant hides it. null means omit the element. */
  registration: string | null;
  description: string | null;

  // ── Classification ──
  /** Validated against the DB CHECK constraint; null when unrecognised. */
  category: VehicleCategory | null;
  /** The untouched column value, for the rare case the union loses something. */
  categoryRaw: string | null;
  fuelType: string | null;

  // ── Operational state ──
  status: string | null;
  isPaused: boolean;
  isDisposed: boolean;
  pickupLocationId: string | null;
  teslaFleetEnabled: boolean;

  // ── Pricing ──
  dailyRent: number | null;
  weeklyRent: number | null;
  monthlyRent: number | null;
  securityDeposit: number | null;
  excessMileageRate: number | null;
  /**
   * Hand straight to `calculateRentalPriceBreakdown`. Nulls are coerced to 0
   * because the engine already treats a missing rate as 0 — doing it here keeps
   * the call sites free of `?? 0` noise.
   */
  rates: VehicleRates;

  // ── Mileage allowance ──
  dailyMileage: number | null;
  weeklyMileage: number | null;
  monthlyMileage: number | null;
  /**
   * True when NO tier sets a cap — the vehicle is inherently unlimited and the
   * paid upgrade must not be offered (it would sell something already included).
   */
  mileageIsUnlimited: boolean;
  /** Operator has enabled the paid unlimited-mileage upgrade for this vehicle. */
  unlimitedMileageAvailable: boolean;
  unlimitedMileagePrices: UnlimitedMileagePrices;

  // ── Which durations this vehicle may be booked for ──
  availableDaily: boolean;
  availableWeekly: boolean;
  availableMonthly: boolean;

  // ── Imagery ──
  /** First photo by `display_order`, else the vehicle's own `photo_url`. */
  primaryPhotoUrl: string | null;
  /** Every gallery image in display order, deduplicated. */
  images: VehicleImage[];
  /** Convenience projection of `images` for simple carousels. */
  photoUrls: string[];

  /**
   * The raw allowlisted row. Pass this to the `@/lib/domain` engines, which all
   * take the snake_case DB shape (`VehicleRates`, `VehicleMileage`,
   * `UnlimitedUpgradeVehicle`). Never `select('*')` it into existence.
   */
  row: PublicVehicleRow;
}

/** A tenant pickup / return point. */
export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  description: string | null;
  /** Flat fee added when this location is chosen. 0 for the free depot. */
  deliveryFee: number;
  isPickupEnabled: boolean;
  isReturnEnabled: boolean;
  sortOrder: number;
}

/**
 * 'per_day' bills unit price x rental days; anything else bills once.
 * ORTHOGONAL to `pricingType` — that decides WHERE the price comes from.
 */
export type ExtraBillingType = 'per_day' | 'per_trip';

/** 'per_vehicle' extras only exist for vehicles with an explicit price row. */
export type ExtraPricingType = 'global' | 'per_vehicle';

/** An optional add-on the booking sidebar offers. */
export interface RentalExtra {
  id: string;
  name: string;
  description: string | null;
  /** Resolved price: the per-vehicle override where one exists, else global. */
  price: number;
  billingType: ExtraBillingType;
  pricingType: ExtraPricingType;
  /** True when `price` came from a `rental_extras_vehicle_pricing` row. */
  hasVehicleSpecificPrice: boolean;
  imageUrls: string[];
  /** Hard cap per booking. null = no cap. */
  maxQuantity: number | null;
  /**
   * Units left for the requested window, or null when unlimited OR when no date
   * range was supplied (nothing to overlap against). Do not clamp with this —
   * clamp with `bookableQuantity`, which resolves the ambiguity.
   */
  remainingStock: number | null;
  /**
   * The cap the quantity stepper should enforce right now: remaining stock when
   * known, else the hard cap, else null for "no limit".
   */
  bookableQuantity: number | null;
}

/* ─────────────────────────── availability ──────────────────────────── */

/** Why a vehicle cannot be booked for the requested window. */
export type UnavailableReason =
  /** An open rental holds the car across the window (or it is overdue and still out). */
  | 'rented'
  /** The operator blocked this specific vehicle for dates overlapping the window. */
  | 'blocked'
  /** A tenant-wide block (vehicle_id IS NULL) covers the window. */
  | 'tenant_blocked'
  /** Pickup falls inside the turnaround buffer after a completed rental. */
  | 'buffer';

/** A date range the customer has chosen, as two `date`-column strings. */
export interface DateRange {
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' */
  endDate: string;
}
