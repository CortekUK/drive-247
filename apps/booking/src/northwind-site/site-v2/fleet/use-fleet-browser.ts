'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTenant } from '@nw/contexts/TenantContext';
import { useVehicles } from '@nw/hooks/use-vehicles';
import {
  EMPTY_TRIP_INTENT,
  readTripIntentFromLocation,
  stripTripIntent,
  type TripIntent,
} from '@nw/lib/booking/trip-intent';
import { canSearchByRegistration } from '@nw/lib/domain';

import { formatMoney, formatResultCount } from '@nw/components/fleet/format';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  activeFilters,
  buildFleetFacets,
  countActiveFilters,
  filterVehicles,
  sortVehicles,
  type ActiveFilter,
  type FleetFilters,
  type FleetSort,
} from '@nw/components/fleet/fleet-filters';
import { toFleetVehicle, type FleetSeed, type FleetVehicle, type RatePeriod } from '@nw/components/fleet/fleet-vehicle';
import { useFleetView } from '@nw/components/fleet/use-fleet-view';

const NO_VEHICLES: FleetVehicle[] = [];

/**
 * The fleet browser's state, with no markup — the same wiring as v1's
 * `components/fleet/fleet-browser.tsx` (seed-until-live source, facets, sort,
 * period, trip intent read after mount, plate-aware search placeholder), over
 * the same logic modules. The v2 browser is markup on top of this.
 *
 * The reasoning behind each choice is documented in the v1 file; it is not
 * repeated here so the two cannot drift into different explanations. (v1 could
 * adopt this hook unchanged.)
 */
export function useFleetBrowser(seed: FleetSeed | null) {
  const { tenant } = useTenant();
  const { vehicles, isLoading, isError, error, refetch } = useVehicles();

  const [filters, setFilters] = useState<FleetFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<FleetSort>(DEFAULT_SORT);
  const [period, setPeriod] = useState<RatePeriod>('day');
  const { view, setView } = useFleetView();

  // Seeded empty on server and first client pass; read from the URL after mount.
  const [tripIntent, setTripIntent] = useState<TripIntent>(EMPTY_TRIP_INTENT);
  useEffect(() => {
    setTripIntent(readTripIntentFromLocation());
  }, []);

  const clearTripIntent = useCallback(() => {
    setTripIntent(EMPTY_TRIP_INTENT);
    if (typeof window === 'undefined') return;
    const { pathname, search, hash } = window.location;
    window.history.replaceState(null, '', `${pathname}${stripTripIntent(search)}${hash}`);
  }, []);

  const live = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);
  const source = live.length > 0 ? live : (seed?.vehicles ?? NO_VEHICLES);

  const currencyCode = tenant?.currency_code ?? seed?.currencyCode ?? null;
  const distanceUnit = tenant?.distance_unit ?? seed?.distanceUnit ?? null;

  const facets = useMemo(() => buildFleetFacets(source, filters), [source, filters]);
  const results = useMemo(() => sortVehicles(filterVehicles(source, filters), sort), [source, filters, sort]);

  const chips = useMemo(
    () =>
      activeFilters(filters, facets.priceBounds, {
        category: (value) => facets.categories.find((facet) => facet.value === value)?.label ?? value,
        price: (min, max) => `${formatMoney(min, currencyCode)} – ${formatMoney(max, currencyCode)} / day`,
      }),
    [filters, facets, currencyCode],
  );

  const activeFilterCount = countActiveFilters(filters, facets.priceBounds);
  const clearAll = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const removeChip = useCallback((chip: ActiveFilter) => setFilters((current) => chip.remove(current)), []);
  const setSearch = useCallback((value: string) => setFilters((current) => ({ ...current, search: value })), []);

  const searchPlaceholder = canSearchByRegistration(tenant)
    ? 'Search brand, model, colour or reg…'
    : 'Search brand, model, or colour…';

  return {
    filters,
    setFilters,
    setSearch,
    sort,
    setSort,
    period,
    setPeriod,
    view,
    setView,
    tripIntent,
    clearTripIntent,
    source,
    results,
    facets,
    chips,
    activeFilterCount,
    clearAll,
    removeChip,
    currencyCode,
    distanceUnit,
    searchPlaceholder,
    resultLabel: formatResultCount(results.length, source.length),
    error,
    refetch,
    showSkeleton: isLoading && source.length === 0,
    showError: isError && source.length === 0,
    fleetIsEmpty: !isLoading && !isError && source.length === 0,
  };
}
