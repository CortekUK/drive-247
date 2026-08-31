/**
 * The view-model every fleet surface renders.
 *
 * Why a view-model at all, when `@/lib/vehicles/types` already exports a
 * normalised `Vehicle`?
 *
 * Because the fleet page is rendered from TWO places and only one of them can
 * see `Vehicle`:
 *
 *  - the browser, from `useVehicles()` — a `'use client'` module, so
 *    `normalizeVehicle` is a client reference and cannot be called on the server;
 *  - the server, for the first paint of `/fleet` (see `fleet-seed.ts`), so the
 *    HTML that reaches a crawler — or a `curl` — carries the real cars instead
 *    of a skeleton.
 *
 * `FleetVehicle` is the narrow shape both paths converge on: everything the
 * grid, the list row and the filters need, and nothing else. It is plain JSON,
 * which is also what lets the server hand its list to the client component as a
 * prop.
 *
 * The two mappers below are the only places that know how to build one.
 */

import {
  customerPhotoUrl,
  displayRegistration,
  isUnlimitedMileage,
  vehicleDisplayName,
} from '@/lib/domain';
import {
  VEHICLE_CATEGORY_LABELS,
  toVehicleCategory,
  type PublicVehiclePhotoRow,
  type PublicVehicleRowWithPhotos,
  type Vehicle,
  type VehicleCategory,
} from '@/lib/vehicles/types';

/** A tenant-shaped object; only the plate flag matters here. */
type TenantLike = { hide_vehicle_registration?: boolean | null } | null | undefined;

/** Which rate the customer is currently looking at. */
export type RatePeriod = 'day' | 'week' | 'month';

export const RATE_PERIODS: readonly RatePeriod[] = ['day', 'week', 'month'];

export const RATE_PERIOD_TAB_LABEL: Record<RatePeriod, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

export const RATE_PERIOD_SUFFIX: Record<RatePeriod, string> = {
  day: 'per day',
  week: 'per week',
  month: 'per month',
};

/** Adverb form, for sentences like "Not offered weekly". */
export const RATE_PERIOD_ADVERB: Record<RatePeriod, string> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
};

/** How a mileage allowance is worded for each period. */
export const RATE_PERIOD_MILEAGE_SUFFIX: Record<RatePeriod, string> = {
  day: '/day',
  week: '/week',
  month: '/month',
};

export interface FleetVehicle {
  id: string;
  /** `vehicleDisplayName()` — never empty, never falls back to a hidden plate. */
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  /** null when the tenant hides plates. null means "omit the element". */
  registration: string | null;
  description: string | null;

  /** Validated against the DB CHECK constraint; null when unrecognised. */
  category: VehicleCategory | null;
  /** "SUV", "Economy"… or a tidied raw value for an off-constraint category. */
  categoryLabel: string | null;
  fuelType: string | null;

  dailyRent: number | null;
  weeklyRent: number | null;
  monthlyRent: number | null;

  dailyMileage: number | null;
  weeklyMileage: number | null;
  monthlyMileage: number | null;
  /** No tier sets a cap — the car is inherently unlimited, upgrade is moot. */
  mileageIsUnlimited: boolean;
  /** Operator sells the unlimited-mileage upgrade on this car. */
  unlimitedMileageAvailable: boolean;

  availableDaily: boolean;
  availableWeekly: boolean;
  availableMonthly: boolean;

  /** First photo by `display_order`, else the operator's thumbnail, else null. */
  photoUrl: string | null;
}

/** Tenant-wide display settings the cards need alongside the vehicles. */
export interface FleetSeed {
  currencyCode: string | null;
  distanceUnit: string | null;
  vehicles: FleetVehicle[];
}

const trimmed = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next === '' ? null : next;
};

/** "sports coupe" -> "Sports Coupe". Only used for off-constraint values. */
function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * The label a filter chip and a card badge both use.
 *
 * v1's fleet filter hardcoded six category names ("Ultra Luxury", "Executive",
 * …) that the DB CHECK constraint does not permit, so its category filter could
 * never match a vehicle. Labels are derived from the value here instead, which
 * is why they cannot go stale.
 */
export function categoryLabelFor(
  category: VehicleCategory | null,
  raw: string | null | undefined,
): string | null {
  if (category) return VEHICLE_CATEGORY_LABELS[category];
  const fallback = trimmed(raw);
  return fallback ? titleCase(fallback) : null;
}

/** Map the client-side normalised `Vehicle` onto the fleet view-model. */
export function toFleetVehicle(vehicle: Vehicle): FleetVehicle {
  return {
    id: vehicle.id,
    name: vehicle.displayName,
    make: trimmed(vehicle.make),
    model: trimmed(vehicle.model),
    year: vehicle.year,
    colour: trimmed(vehicle.colour),
    registration: vehicle.registration,
    description: trimmed(vehicle.description),

    category: vehicle.category,
    categoryLabel: categoryLabelFor(vehicle.category, vehicle.categoryRaw),
    fuelType: trimmed(vehicle.fuelType),

    dailyRent: vehicle.dailyRent,
    weeklyRent: vehicle.weeklyRent,
    monthlyRent: vehicle.monthlyRent,

    dailyMileage: vehicle.dailyMileage,
    weeklyMileage: vehicle.weeklyMileage,
    monthlyMileage: vehicle.monthlyMileage,
    mileageIsUnlimited: vehicle.mileageIsUnlimited,
    unlimitedMileageAvailable: vehicle.unlimitedMileageAvailable,

    availableDaily: vehicle.availableDaily,
    availableWeekly: vehicle.availableWeekly,
    availableMonthly: vehicle.availableMonthly,

    photoUrl: vehicle.primaryPhotoUrl,
  };
}

/**
 * The hero image a customer may see, from the joined photo rows.
 *
 * `display_order` is nullable and PostgREST sorts nulls wherever it likes, so
 * the order is pinned here rather than trusted. Every candidate goes through
 * `customerPhotoUrl`, so a plate-hiding tenant serves the redacted copy on the
 * server exactly as it does in the browser.
 */
function primaryPhotoUrl(
  photos: readonly PublicVehiclePhotoRow[] | null | undefined,
  tenant: TenantLike,
): string | null {
  if (!photos || photos.length === 0) return null;

  const ordered = [...photos].sort((a, b) => {
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  for (const photo of ordered) {
    const url = customerPhotoUrl(photo, tenant);
    if (url) return url;
  }
  return null;
}

/**
 * Map a raw allowlisted row onto the view-model, for the server-rendered first
 * paint. Deliberately goes through the same `@/lib/domain` helpers the client
 * normaliser uses, so a plate that is withheld in the browser is also withheld
 * in the HTML.
 */
export function fleetVehicleFromRow(
  row: PublicVehicleRowWithPhotos,
  tenant: TenantLike,
): FleetVehicle {
  const { vehicle_photos: photos, ...plain } = row;
  const category = toVehicleCategory(plain.category);

  return {
    id: plain.id,
    name: vehicleDisplayName(plain, tenant),
    make: trimmed(plain.make),
    model: trimmed(plain.model),
    year: plain.year,
    // The schema carries both spellings; the seeded rows fill in `colour`.
    colour: trimmed(plain.colour ?? plain.color),
    registration: displayRegistration(plain, tenant),
    description: trimmed(plain.description),

    category,
    categoryLabel: categoryLabelFor(category, plain.category),
    fuelType: trimmed(plain.fuel_type),

    dailyRent: plain.daily_rent,
    weeklyRent: plain.weekly_rent,
    monthlyRent: plain.monthly_rent,

    dailyMileage: plain.daily_mileage,
    weeklyMileage: plain.weekly_mileage,
    monthlyMileage: plain.monthly_mileage,
    mileageIsUnlimited: isUnlimitedMileage(plain),
    unlimitedMileageAvailable: plain.unlimited_mileage_available === true,

    availableDaily: plain.available_daily !== false,
    availableWeekly: plain.available_weekly !== false,
    availableMonthly: plain.available_monthly !== false,

    photoUrl: primaryPhotoUrl(photos, tenant) ?? trimmed(plain.photo_url),
  };
}

export interface PeriodRate {
  /** The rate for this period, or null when the operator never priced it. */
  amount: number | null;
  /** False when the operator does not let this car be booked for this long. */
  offered: boolean;
}

/**
 * The rate for a period, straight off the row.
 *
 * Note what this does NOT do: v1's fleet prototype multiplied the daily rate by
 * 6 and 22 to invent weekly and monthly prices. Real rows carry all three
 * (89 / 534 / 1958 on the seeded Tesla), and they are not multiples of each
 * other — an invented weekly price is a wrong price.
 */
export function rateForPeriod(vehicle: FleetVehicle, period: RatePeriod): PeriodRate {
  switch (period) {
    case 'day':
      return { amount: vehicle.dailyRent, offered: vehicle.availableDaily };
    case 'week':
      return { amount: vehicle.weeklyRent, offered: vehicle.availableWeekly };
    case 'month':
      return { amount: vehicle.monthlyRent, offered: vehicle.availableMonthly };
  }
}

/**
 * The mileage allowance for a period. `null` means unlimited — matching
 * `getTierMileage()` in the domain layer, where an unset cap is the way an
 * operator expresses "no limit".
 */
export function mileageForPeriod(
  vehicle: FleetVehicle,
  period: RatePeriod,
): number | null {
  switch (period) {
    case 'day':
      return vehicle.dailyMileage;
    case 'week':
      return vehicle.weeklyMileage;
    case 'month':
      return vehicle.monthlyMileage;
  }
}

/** Where a card or row links to. One place, so the two cannot disagree. */
export function vehicleHref(vehicle: FleetVehicle): string {
  return `/booking/${vehicle.id}`;
}
