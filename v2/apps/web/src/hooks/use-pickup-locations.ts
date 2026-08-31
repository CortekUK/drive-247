'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import type { PickupLocation, PublicPickupLocationRow } from '@/lib/vehicles/types';

/**
 * Explicit column list, as everywhere else. `pickup_locations` is small enough
 * that `*` looks harmless, but the habit is the point: the next column added to
 * this table is private by default rather than published by default.
 */
const LOCATION_SELECT =
  'id, name, address, description, delivery_fee, is_pickup_enabled, is_return_enabled, sort_order';

function normalizeLocation(row: PublicPickupLocationRow): PickupLocation {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    description: row.description,
    // NOT NULL DEFAULT 0 in the schema, but PostgREST can hand back a numeric as
    // a string depending on the column type, and a string here would render as
    // "$045" once concatenated into a total.
    deliveryFee: Number(row.delivery_fee) || 0,
    isPickupEnabled: row.is_pickup_enabled !== false,
    isReturnEnabled: row.is_return_enabled !== false,
    sortOrder: row.sort_order ?? 0,
  };
}

export interface UsePickupLocationsResult {
  /** Every active location, in the operator's chosen order. */
  locations: PickupLocation[];
  /** Locations the customer may collect from. */
  pickupLocations: PickupLocation[];
  /** Locations the customer may return to — often, but not always, the same. */
  returnLocations: PickupLocation[];
  /** Lookup by id, for resolving a stored selection back to a name and fee. */
  byId: ReadonlyMap<string, PickupLocation>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * The tenant's active pickup / return points.
 *
 * Only `is_active` rows are fetched: a location the operator retired must not
 * be selectable, and filtering it out server-side means a stale cache cannot
 * resurrect it. Pickup and return are split because the two flags are
 * independent — an airport desk that hands cars over but does not take them back
 * is a real configuration, and offering it as a return point would strand the
 * customer at the end of the rental.
 *
 * `delivery_fee` rides along because the sidebar bill needs it the moment a
 * location is picked; `resolveDeliveryFee` in `@/lib/domain` handles the
 * distance-tiered case separately.
 */
export function usePickupLocations(): UsePickupLocationsResult {
  const { tenant, isLoading: tenantLoading } = useTenant();

  const query = useQuery({
    queryKey: ['pickup-locations', tenant?.id],
    queryFn: async (): Promise<PickupLocation[]> => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('pickup_locations')
        .select(LOCATION_SELECT)
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false })
        // Second key so two locations sharing a sort_order do not swap places
        // between renders — a select whose options reorder under the cursor.
        .order('name', { ascending: true })
        .overrideTypes<PublicPickupLocationRow[], { merge: false }>();

      if (error) {
        console.error('[usePickupLocations] Failed to load locations', {
          tenantId: tenant.id,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load pickup locations');
      }

      return (data ?? []).map(normalizeLocation);
    },
    enabled: !!tenant,
  });

  const locations = useMemo(() => query.data ?? [], [query.data]);

  const pickupLocations = useMemo(
    () => locations.filter((location) => location.isPickupEnabled),
    [locations],
  );
  const returnLocations = useMemo(
    () => locations.filter((location) => location.isReturnEnabled),
    [locations],
  );
  const byId = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    locations,
    pickupLocations,
    returnLocations,
    byId,
    isLoading:
      tenantLoading || (!!tenant && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
