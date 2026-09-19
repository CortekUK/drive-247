/**
 * Search, sort and facet logic for the fleet grid. Pure functions — no React,
 * no Supabase — so the behaviour is inspectable without a browser.
 *
 * Everything here is derived from the vehicles that were actually returned.
 * That is the fix for the real bug in v1's fleet filter: its category pills
 * were hardcoded to "Ultra Luxury", "Executive", "Luxury SUV", "Sport Coupe",
 * "Convertible" and "Group Transport", while `vehicles.category` carries a
 * CHECK constraint permitting only economy | sedan | suv | luxury | van |
 * electric. Not one pill could ever match a row, so the filter silently emptied
 * the page. A facet list that is computed from the data cannot drift from it.
 */

import type { FleetVehicle } from './fleet-vehicle';

/* ─────────────────────────────── sorting ─────────────────────────────── */

export type FleetSort = 'recommended' | 'price_low' | 'price_high' | 'year_new';

export const FLEET_SORTS: readonly { value: FleetSort; label: string }[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price_low', label: 'Price: low to high' },
  { value: 'price_high', label: 'Price: high to low' },
  { value: 'year_new', label: 'Model year: newest' },
];

export const DEFAULT_SORT: FleetSort = 'recommended';

export function isFleetSort(value: string): value is FleetSort {
  return FLEET_SORTS.some((option) => option.value === value);
}

/** Alphabetical fallback, so every sort below is deterministic. */
function byName(a: FleetVehicle, b: FleetVehicle): number {
  return a.name.localeCompare(b.name);
}

/**
 * Nulls always sort last, whichever direction the caller asked for. A vehicle
 * the operator has not priced must not lead a "cheapest first" page.
 */
function compareNullable(
  a: number | null,
  b: number | null,
  direction: 'asc' | 'desc',
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

export function sortVehicles(
  vehicles: readonly FleetVehicle[],
  sort: FleetSort,
): FleetVehicle[] {
  const next = [...vehicles];

  switch (sort) {
    case 'price_low':
      next.sort((a, b) => compareNullable(a.dailyRent, b.dailyRent, 'asc') || byName(a, b));
      break;
    case 'price_high':
      next.sort((a, b) => compareNullable(a.dailyRent, b.dailyRent, 'desc') || byName(a, b));
      break;
    case 'year_new':
      next.sort((a, b) => compareNullable(a.year, b.year, 'desc') || byName(a, b));
      break;
    case 'recommended':
      // v1's "Recommended" is alphabetical by "make model", which is what
      // `name` already is. Kept identical so the default ordering matches the
      // app customers use today.
      next.sort(byName);
      break;
  }

  return next;
}

/* ────────────────────────────── filtering ────────────────────────────── */

export interface FleetFilters {
  search: string;
  /** `VehicleCategory` values — always the DB value, never a label. */
  categories: string[];
  /** Fuel types, compared case-insensitively. */
  fuels: string[];
  makes: string[];
  /** Daily-rate bounds. null on either side means "no bound applied". */
  minPrice: number | null;
  maxPrice: number | null;
  /** Only cars where the operator sells the unlimited-mileage upgrade. */
  unlimitedOnly: boolean;
}

export const EMPTY_FILTERS: FleetFilters = {
  search: '',
  categories: [],
  fuels: [],
  makes: [],
  minPrice: null,
  maxPrice: null,
  unlimitedOnly: false,
};

/** Which dimension a facet count is being computed for; see `buildFleetFacets`. */
type Dimension = 'search' | 'categories' | 'fuels' | 'makes' | 'price' | 'unlimited';

const lower = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

/**
 * Everything a search query may match.
 *
 * The plate is included ONLY when it is present — and `FleetVehicle.registration`
 * is already null for a tenant with `hide_vehicle_registration`, because it came
 * from `displayRegistration()`. That is the whole of the rule "search `reg` only
 * when `canSearchByRegistration(tenant)`": a searchable hidden field is not
 * hidden, since typing a plate and watching one car appear confirms that plate.
 */
function haystack(vehicle: FleetVehicle): string {
  return [
    vehicle.name,
    vehicle.make,
    vehicle.model,
    vehicle.colour,
    vehicle.categoryLabel,
    vehicle.fuelType,
    vehicle.registration,
    vehicle.year == null ? null : String(vehicle.year),
  ]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ')
    .toLowerCase();
}

/**
 * Every whitespace-separated token must appear somewhere, so "tesla white" and
 * "white tesla" both work and neither needs the customer to guess field order.
 */
function matchesSearch(vehicle: FleetVehicle, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === '') return true;
  const text = haystack(vehicle);
  return query.split(/\s+/).every((token) => text.includes(token));
}

function matchesDimension(
  vehicle: FleetVehicle,
  filters: FleetFilters,
  dimension: Dimension,
): boolean {
  switch (dimension) {
    case 'search':
      return matchesSearch(vehicle, filters.search);
    case 'categories':
      return (
        filters.categories.length === 0 ||
        (vehicle.category !== null && filters.categories.includes(vehicle.category))
      );
    case 'fuels': {
      if (filters.fuels.length === 0) return true;
      const fuel = lower(vehicle.fuelType);
      return fuel !== '' && filters.fuels.some((value) => lower(value) === fuel);
    }
    case 'makes': {
      if (filters.makes.length === 0) return true;
      const make = lower(vehicle.make);
      return make !== '' && filters.makes.some((value) => lower(value) === make);
    }
    case 'price': {
      if (filters.minPrice == null && filters.maxPrice == null) return true;
      // An unpriced vehicle cannot satisfy a price bound; excluding it is the
      // honest answer to "under $100".
      if (vehicle.dailyRent == null) return false;
      if (filters.minPrice != null && vehicle.dailyRent < filters.minPrice) return false;
      if (filters.maxPrice != null && vehicle.dailyRent > filters.maxPrice) return false;
      return true;
    }
    case 'unlimited':
      return !filters.unlimitedOnly || vehicle.unlimitedMileageAvailable;
  }
}

const ALL_DIMENSIONS: readonly Dimension[] = [
  'search',
  'categories',
  'fuels',
  'makes',
  'price',
  'unlimited',
];

/**
 * @param except  a dimension to ignore, used to compute "how many more would
 *                this facet add" counts. Undefined applies every dimension.
 */
function matchesAll(
  vehicle: FleetVehicle,
  filters: FleetFilters,
  except?: Dimension,
): boolean {
  return ALL_DIMENSIONS.every(
    (dimension) => dimension === except || matchesDimension(vehicle, filters, dimension),
  );
}

export function filterVehicles(
  vehicles: readonly FleetVehicle[],
  filters: FleetFilters,
): FleetVehicle[] {
  return vehicles.filter((vehicle) => matchesAll(vehicle, filters));
}

/* ──────────────────────────────── facets ─────────────────────────────── */

export interface Facet {
  /** The value written into `FleetFilters` — the DB value, not the label. */
  value: string;
  label: string;
  /** How many vehicles this option would leave visible if it were ticked. */
  count: number;
}

export interface PriceBounds {
  min: number;
  max: number;
}

export interface FleetFacets {
  categories: Facet[];
  fuels: Facet[];
  makes: Facet[];
  /** Derived from the real fleet — never a hardcoded 0–1000 slider. */
  priceBounds: PriceBounds | null;
  /** Vehicles offering the unlimited-mileage upgrade, under the other filters. */
  unlimitedCount: number;
}

const EMPTY_FACETS: FleetFacets = {
  categories: [],
  fuels: [],
  makes: [],
  priceBounds: null,
  unlimitedCount: 0,
};

/** Canonical category order — matches the DB CHECK constraint's own order. */
const CATEGORY_ORDER = ['economy', 'sedan', 'suv', 'luxury', 'van', 'electric'];

function orderCategories(a: Facet, b: Facet): number {
  const ai = CATEGORY_ORDER.indexOf(a.value);
  const bi = CATEGORY_ORDER.indexOf(b.value);
  if (ai !== bi) return (ai < 0 ? CATEGORY_ORDER.length : ai) - (bi < 0 ? CATEGORY_ORDER.length : bi);
  return a.label.localeCompare(b.label);
}

/**
 * Tally one dimension against the vehicles that survive EVERY OTHER dimension.
 *
 * This is the difference between a filter panel that helps and one that traps:
 * with plain totals, ticking "Electric" leaves "Van (2)" on screen, and ticking
 * it too returns nothing. Counting cross-dimensionally means every number on
 * screen is the number of cars you would actually see.
 */
function tally(
  vehicles: readonly FleetVehicle[],
  filters: FleetFilters,
  dimension: Dimension,
  keyOf: (vehicle: FleetVehicle) => { value: string; label: string } | null,
): Facet[] {
  const counts = new Map<string, Facet>();

  for (const vehicle of vehicles) {
    const key = keyOf(vehicle);
    if (!key) continue;

    const existing = counts.get(key.value);
    const visible = matchesAll(vehicle, filters, dimension);

    if (existing) {
      if (visible) existing.count += 1;
    } else {
      counts.set(key.value, { value: key.value, label: key.label, count: visible ? 1 : 0 });
    }
  }

  return [...counts.values()];
}

export function buildFleetFacets(
  vehicles: readonly FleetVehicle[],
  filters: FleetFilters,
): FleetFacets {
  if (vehicles.length === 0) return EMPTY_FACETS;

  const categories = tally(vehicles, filters, 'categories', (vehicle) =>
    vehicle.category ? { value: vehicle.category, label: vehicle.categoryLabel ?? vehicle.category } : null,
  ).sort(orderCategories);

  const fuels = tally(vehicles, filters, 'fuels', (vehicle) =>
    vehicle.fuelType ? { value: vehicle.fuelType, label: vehicle.fuelType } : null,
  ).sort((a, b) => a.label.localeCompare(b.label));

  const makes = tally(vehicles, filters, 'makes', (vehicle) =>
    vehicle.make ? { value: vehicle.make, label: vehicle.make } : null,
  ).sort((a, b) => a.label.localeCompare(b.label));

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let unlimitedCount = 0;

  for (const vehicle of vehicles) {
    const rent = vehicle.dailyRent;
    if (rent != null && Number.isFinite(rent)) {
      if (rent < min) min = rent;
      if (rent > max) max = rent;
    }
    if (vehicle.unlimitedMileageAvailable && matchesAll(vehicle, filters, 'unlimited')) {
      unlimitedCount += 1;
    }
  }

  return {
    categories,
    fuels,
    makes,
    priceBounds:
      min === Number.POSITIVE_INFINITY ? null : { min: Math.floor(min), max: Math.ceil(max) },
    unlimitedCount,
  };
}

/* ───────────────────────────── active filters ────────────────────────── */

export interface ActiveFilter {
  /** Stable key for React and for the remove handler. */
  id: string;
  label: string;
  /** Removing this chip yields these filters. */
  remove: (filters: FleetFilters) => FleetFilters;
}

const withoutValue = (values: string[], value: string): string[] =>
  values.filter((entry) => entry !== value);

/**
 * The removable chips shown above the results.
 *
 * A price filter only counts as active when it is actually narrower than the
 * fleet — dragging a handle to the end of its track is the same as not
 * filtering, and a chip reading "$50 – $650" of a $50–$650 fleet is noise.
 */
export function activeFilters(
  filters: FleetFilters,
  bounds: PriceBounds | null,
  labelFor: { category: (value: string) => string; price: (min: number, max: number) => string },
): ActiveFilter[] {
  const chips: ActiveFilter[] = [];

  if (filters.search.trim() !== '') {
    chips.push({
      id: 'search',
      label: `“${filters.search.trim()}”`,
      remove: (current) => ({ ...current, search: '' }),
    });
  }

  for (const value of filters.categories) {
    chips.push({
      id: `category:${value}`,
      label: labelFor.category(value),
      remove: (current) => ({ ...current, categories: withoutValue(current.categories, value) }),
    });
  }

  for (const value of filters.makes) {
    chips.push({
      id: `make:${value}`,
      label: value,
      remove: (current) => ({ ...current, makes: withoutValue(current.makes, value) }),
    });
  }

  for (const value of filters.fuels) {
    chips.push({
      id: `fuel:${value}`,
      label: value,
      remove: (current) => ({ ...current, fuels: withoutValue(current.fuels, value) }),
    });
  }

  if (isPriceNarrowed(filters, bounds)) {
    const min = filters.minPrice ?? bounds?.min ?? 0;
    const max = filters.maxPrice ?? bounds?.max ?? 0;
    chips.push({
      id: 'price',
      label: labelFor.price(min, max),
      remove: (current) => ({ ...current, minPrice: null, maxPrice: null }),
    });
  }

  if (filters.unlimitedOnly) {
    chips.push({
      id: 'unlimited',
      label: 'Unlimited mileage available',
      remove: (current) => ({ ...current, unlimitedOnly: false }),
    });
  }

  return chips;
}

export function isPriceNarrowed(filters: FleetFilters, bounds: PriceBounds | null): boolean {
  if (filters.minPrice == null && filters.maxPrice == null) return false;
  if (!bounds) return true;
  const min = filters.minPrice ?? bounds.min;
  const max = filters.maxPrice ?? bounds.max;
  return min > bounds.min || max < bounds.max;
}

/** How many chips the mobile "Filters" button should advertise. */
export function countActiveFilters(filters: FleetFilters, bounds: PriceBounds | null): number {
  return (
    (filters.search.trim() === '' ? 0 : 1) +
    filters.categories.length +
    filters.makes.length +
    filters.fuels.length +
    (isPriceNarrowed(filters, bounds) ? 1 : 0) +
    (filters.unlimitedOnly ? 1 : 0)
  );
}
