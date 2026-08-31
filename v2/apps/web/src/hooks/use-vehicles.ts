'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant, type Tenant } from '@/contexts/TenantContext';
import {
  VEHICLE_PHOTO_COLUMNS,
  calendarDaysBetween,
  canRevealRegistration,
  customerPhotoUrl,
  displayRegistration,
  getUnlimitedMileagePrices,
  isUnlimitedMileage,
  vehicleDisplayLabel,
  vehicleDisplayName,
  vehiclePublicColumns,
} from '@/lib/domain';
import {
  toVehicleCategory,
  type PublicVehiclePhotoRow,
  type PublicVehicleRow,
  type PublicVehicleRowWithPhotos,
  type Vehicle,
  type VehicleCategory,
  type VehicleImage,
  VEHICLE_CATEGORIES,
} from '@/lib/vehicles/types';

/* ───────────────────────────── normalisation ───────────────────────────── */

/**
 * Turn the joined photo rows into the gallery a customer may see.
 *
 * Three things happen here that a component must never have to remember:
 *  - each URL goes through `customerPhotoUrl`, so a plate-hiding tenant serves
 *    the redacted copy where the operator published one;
 *  - `display_order` is NULLABLE, and PostgREST sorts nulls somewhere; the
 *    explicit sort pins them last so the hero image is deterministic;
 *  - duplicates are dropped, because the same file is often both the vehicle's
 *    `photo_url` and its first `vehicle_photos` row.
 */
export function normalizeVehicleImages(
  photos: readonly PublicVehiclePhotoRow[] | null | undefined,
  tenant: Tenant | null,
): VehicleImage[] {
  if (!photos || photos.length === 0) return [];

  const ordered = [...photos].sort((a, b) => {
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  const seen = new Set<string>();
  const images: VehicleImage[] = [];

  for (const photo of ordered) {
    const url = customerPhotoUrl(photo, tenant);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({ url, displayOrder: photo.display_order ?? images.length });
  }

  return images;
}

/**
 * Map one allowlisted row to the shape the grid and the vehicle page render.
 *
 * The tenant is required, not optional: `vehicleDisplayName` and
 * `displayRegistration` both consult it, and passing null there means "we do
 * not know yet", which correctly withholds the plate. Callers must therefore
 * only run this once the tenant has resolved — which is what `enabled: !!tenant`
 * on every query below guarantees.
 */
export function normalizeVehicle(
  row: PublicVehicleRowWithPhotos,
  tenant: Tenant | null,
): Vehicle {
  const { vehicle_photos: joinedPhotos, ...bare } = row;
  const plain: PublicVehicleRow = bare;

  const images = normalizeVehicleImages(joinedPhotos, tenant);
  // `photo_url` is the operator's chosen thumbnail and is often set on vehicles
  // that have no `vehicle_photos` rows at all. Falling back to it is the
  // difference between a fleet card with a picture and one with a grey box.
  const fallbackPhoto =
    typeof plain.photo_url === 'string' && plain.photo_url.trim() !== ''
      ? plain.photo_url
      : null;

  const resolvedImages =
    images.length > 0
      ? images
      : fallbackPhoto
        ? [{ url: fallbackPhoto, displayOrder: 0 }]
        : [];

  return {
    id: plain.id,
    tenantId: plain.tenant_id,

    make: plain.make,
    model: plain.model,
    year: plain.year,
    // The schema carries both spellings; operators fill in whichever their
    // portal build wrote. Preferring `colour` matches the seeded data.
    colour: plain.colour ?? plain.color,
    displayName: vehicleDisplayName(plain, tenant),
    displayLabel: vehicleDisplayLabel(plain, tenant),
    registration: displayRegistration(plain, tenant),
    description: plain.description,

    category: toVehicleCategory(plain.category),
    categoryRaw: plain.category,
    fuelType: plain.fuel_type,

    status: plain.status,
    isPaused: plain.is_paused === true,
    isDisposed: plain.is_disposed === true,
    pickupLocationId: plain.pickup_location_id,
    teslaFleetEnabled: plain.tesla_fleet_enabled === true,

    dailyRent: plain.daily_rent,
    weeklyRent: plain.weekly_rent,
    monthlyRent: plain.monthly_rent,
    securityDeposit: plain.security_deposit,
    excessMileageRate: plain.excess_mileage_rate,
    rates: {
      daily_rent: plain.daily_rent ?? 0,
      weekly_rent: plain.weekly_rent ?? 0,
      monthly_rent: plain.monthly_rent ?? 0,
    },

    dailyMileage: plain.daily_mileage,
    weeklyMileage: plain.weekly_mileage,
    monthlyMileage: plain.monthly_mileage,
    mileageIsUnlimited: isUnlimitedMileage(plain),
    unlimitedMileageAvailable: plain.unlimited_mileage_available === true,
    unlimitedMileagePrices: getUnlimitedMileagePrices(plain),

    availableDaily: plain.available_daily !== false,
    availableWeekly: plain.available_weekly !== false,
    availableMonthly: plain.available_monthly !== false,

    primaryPhotoUrl: resolvedImages[0]?.url ?? null,
    images: resolvedImages,
    photoUrls: resolvedImages.map((image) => image.url),

    row: plain,
  };
}

/* ───────────────────────────── duration tier ───────────────────────────── */

/** Which `available_*` flag governs a booking of this length. */
export type DurationTier = 'daily' | 'weekly' | 'monthly';

const TIER_COLUMN: Record<DurationTier, 'available_daily' | 'available_weekly' | 'available_monthly'> =
  {
    daily: 'available_daily',
    weekly: 'available_weekly',
    monthly: 'available_monthly',
  };

/**
 * Resolve the duration tier for a chosen range, or null when no range is set.
 *
 * Null is load-bearing: the fleet page lists the whole fleet before the customer
 * has picked anything, and filtering on `available_daily` at that point would
 * silently hide every monthly-only vehicle from a page whose whole job is to
 * show the fleet.
 */
export function resolveDurationTier(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  monthlyTierDays: number,
): DurationTier | null {
  if (!startDate || !endDate) return null;
  const days = calendarDaysBetween(startDate, endDate);
  if (days >= monthlyTierDays) return 'monthly';
  if (days >= 7) return 'weekly';
  return 'daily';
}

/* ────────────────────────────── the hook ───────────────────────────────── */

export interface UseVehiclesOptions {
  /**
   * Restrict to vehicles assigned to this pickup location, PLUS unassigned ones
   * (a null `pickup_location_id` means "collectable from any location").
   */
  pickupLocationId?: string | null;
  /** Together with `endDate`, restricts to vehicles bookable for that duration. */
  startDate?: string | null;
  endDate?: string | null;
  /** Escape hatch for callers that must defer the query. Defaults to true. */
  enabled?: boolean;
}

/** Cheap facets derived from the loaded rows, for building filter controls. */
export interface VehicleFacets {
  /** Categories actually present, in the canonical order of the DB constraint. */
  categories: VehicleCategory[];
  /** Distinct fuel types, alphabetical. */
  fuelTypes: string[];
  /** Distinct makes, alphabetical. */
  makes: string[];
  /** Daily-rate span across the result, or null when nothing is priced. */
  dailyRentRange: { min: number; max: number } | null;
}

export interface UseVehiclesResult {
  vehicles: Vehicle[];
  facets: VehicleFacets;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const EMPTY_FACETS: VehicleFacets = {
  categories: [],
  fuelTypes: [],
  makes: [],
  dailyRentRange: null,
};

function buildFacets(vehicles: readonly Vehicle[]): VehicleFacets {
  if (vehicles.length === 0) return EMPTY_FACETS;

  const categories = new Set<VehicleCategory>();
  const fuelTypes = new Set<string>();
  const makes = new Set<string>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const vehicle of vehicles) {
    if (vehicle.category) categories.add(vehicle.category);

    const fuel = vehicle.fuelType?.trim();
    if (fuel) fuelTypes.add(fuel);

    const make = vehicle.make?.trim();
    if (make) makes.add(make);

    const rent = vehicle.dailyRent;
    if (typeof rent === 'number' && Number.isFinite(rent)) {
      if (rent < min) min = rent;
      if (rent > max) max = rent;
    }
  }

  return {
    categories: VEHICLE_CATEGORIES.filter((category) => categories.has(category)),
    fuelTypes: [...fuelTypes].sort((a, b) => a.localeCompare(b)),
    makes: [...makes].sort((a, b) => a.localeCompare(b)),
    dailyRentRange:
      min === Number.POSITIVE_INFINITY ? null : { min, max },
  };
}

/**
 * The tenant's bookable fleet, ready to render.
 *
 * What is filtered SERVER-side and why:
 *  - `tenant_id` — the isolation boundary. `vehicles` has RLS off and a
 *    table-level `anon` grant, so this filter is the only thing separating two
 *    operators' fleets. It is not an optimisation.
 *  - `status ilike available|rented` — a rented car stays listed because it may
 *    be free on other dates; `use-vehicle-availability` decides that. Anything
 *    else (Maintenance, Sold, …) is off the market entirely. `ilike` because
 *    rows exist saved both "Available" and "available".
 *  - `is_paused = false` — the operator has taken the car off the road. Held
 *    server-side so it holds whether or not dates have been chosen.
 *  - `is_disposed IS NOT TRUE` — `NOT TRUE` rather than `= false`, because the
 *    column is nullable and `= false` drops every row that never had it set.
 *
 * NOT filtered here: date availability. That is a separate concern with its own
 * hook, so the grid can render the whole fleet and grey out the unavailable
 * rather than making cars vanish as the customer moves a date.
 */
export function useVehicles(options: UseVehiclesOptions = {}): UseVehiclesResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { pickupLocationId = null, startDate = null, endDate = null, enabled = true } = options;

  const monthlyTierDays = tenant?.monthly_tier_days ?? 30;
  const durationTier = resolveDurationTier(startDate, endDate, monthlyTierDays);
  // The select list itself changes with this flag, so it belongs in the key: a
  // tenant flipping "hide registration" must not be served the cached response
  // that still carries plates.
  const showsRegistration = canRevealRegistration(tenant);

  const query = useQuery({
    queryKey: [
      'vehicles',
      tenant?.id,
      showsRegistration,
      durationTier,
      pickupLocationId,
    ],
    queryFn: async (): Promise<Vehicle[]> => {
      if (!tenant?.id) return [];

      let request = supabase
        .from('vehicles')
        // Allowlist, never `select('*')`. Verified live: `*` on this table
        // returns lockbox_code, purchase_price, security_notes, owner_id and vin
        // to anyone holding the public anon key.
        .select(vehiclePublicColumns(tenant, VEHICLE_PHOTO_COLUMNS))
        .eq('tenant_id', tenant.id)
        .or('status.ilike.available,status.ilike.rented')
        .eq('is_paused', false)
        .not('is_disposed', 'is', true);

      if (durationTier) {
        request = request.eq(TIER_COLUMN[durationTier], true);
      }

      if (pickupLocationId) {
        request = request.or(
          `pickup_location_id.is.null,pickup_location_id.eq.${pickupLocationId}`,
        );
      }

      const { data, error } = await request
        .order('display_order', {
          referencedTable: 'vehicle_photos',
          ascending: true,
          nullsFirst: false,
        })
        // A stable, cheap default the grid can re-sort client-side. Nulls last
        // so unpriced vehicles do not lead the page.
        .order('daily_rent', { ascending: true, nullsFirst: false })
        .order('make', { ascending: true, nullsFirst: false })
        .order('model', { ascending: true, nullsFirst: false })
        .overrideTypes<PublicVehicleRowWithPhotos[], { merge: false }>();

      if (error) {
        // The message names the offending column, which is the fastest way to
        // diagnose a typo or a missing `anon` grant — PostgREST rejects the
        // WHOLE row for one bad name, so this is never a partial failure.
        console.error('[useVehicles] Failed to load vehicles', {
          tenantId: tenant.id,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load vehicles');
      }

      return (data ?? []).map((row) => normalizeVehicle(row, tenant));
    },
    enabled: enabled && !!tenant,
  });

  const vehicles = useMemo(() => query.data ?? [], [query.data]);
  const facets = useMemo(() => buildFacets(vehicles), [vehicles]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    vehicles,
    facets,
    // The tenant round-trip is part of this hook's load from a caller's point of
    // view: until it lands, `enabled` is false and React Query reports idle, so
    // reading `isPending` alone would flash an empty fleet before the first fetch.
    isLoading:
      tenantLoading || (!!tenant && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
