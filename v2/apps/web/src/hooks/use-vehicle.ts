'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  VEHICLE_PHOTO_COLUMNS,
  canRevealRegistration,
  vehiclePublicColumns,
} from '@/lib/domain';
import type { PublicVehicleRowWithPhotos, Vehicle } from '@/lib/vehicles/types';
import { normalizeVehicle } from '@/hooks/use-vehicles';

/**
 * Postgres' "invalid input syntax for type uuid".
 *
 * A route like `/fleet/hello` hands us a path segment that is not a UUID.
 * PostgREST answers that with an ERROR, not an empty result — so without this,
 * a mistyped URL would render the red "something went wrong" state instead of
 * the 404 it actually is. A string that cannot be a vehicle id is definitively
 * not a vehicle.
 */
const INVALID_UUID = '22P02';

export interface UseVehicleResult {
  /** The vehicle, or null while loading / when it does not exist. */
  vehicle: Vehicle | null;
  isLoading: boolean;
  /**
   * TRUE only when the lookup SUCCEEDED and matched nothing — the page should
   * render a real 404. Deliberately distinct from `isError`: a network failure
   * must not tell a customer the car does not exist, and a genuinely deleted car
   * must not show a retry button that will never succeed.
   */
  notFound: boolean;
  /** A transport / query failure. Mutually exclusive with `notFound`. */
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * One vehicle, in the same normalised shape the fleet grid renders.
 *
 * Scoped to the tenant on purpose. A vehicle id belonging to ANOTHER operator
 * resolves to `notFound` rather than rendering that operator's car on this
 * tenant's site — `vehicles` has RLS off and a table-level `anon` grant, so the
 * `tenant_id` filter is the whole boundary.
 *
 * The `status` / `is_paused` / `is_disposed` conditions from the fleet list are
 * NOT repeated here. A direct link to a car the operator has since paused should
 * say so — which the caller can read off `vehicle.isPaused` / `vehicle.status` —
 * rather than claiming the vehicle never existed.
 */
export function useVehicle(vehicleId: string | null | undefined): UseVehicleResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const id = typeof vehicleId === 'string' ? vehicleId.trim() : '';
  const showsRegistration = canRevealRegistration(tenant);

  const query = useQuery({
    queryKey: ['vehicle', tenant?.id, id, showsRegistration],
    queryFn: async (): Promise<Vehicle | null> => {
      if (!tenant?.id || !id) return null;

      const { data, error } = await supabase
        .from('vehicles')
        // Allowlist, never `select('*')` — see lib/domain/vehicle-identity.ts.
        .select(vehiclePublicColumns(tenant, VEHICLE_PHOTO_COLUMNS))
        .eq('tenant_id', tenant.id)
        .eq('id', id)
        .order('display_order', {
          referencedTable: 'vehicle_photos',
          ascending: true,
          nullsFirst: false,
        })
        // maybeSingle, not single: "no such vehicle" is an ANSWER, and `single`
        // turns it into PGRST116, which would be indistinguishable from a real
        // failure at the call site.
        .maybeSingle()
        .overrideTypes<PublicVehicleRowWithPhotos, { merge: false }>();

      if (error) {
        if (error.code === INVALID_UUID) return null;
        console.error('[useVehicle] Failed to load vehicle', {
          tenantId: tenant.id,
          vehicleId: id,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load vehicle');
      }

      if (!data) return null;
      return normalizeVehicle(data, tenant);
    },
    enabled: !!tenant && id !== '',
    // A missing vehicle is a settled answer, not a flaky one. Retrying it three
    // times only delays the 404 the customer is waiting for.
    retry: 1,
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const canQuery = !!tenant && id !== '';
  // The tenant round-trip is part of this hook's load: until it lands `enabled`
  // is false and React Query reports idle, so `isPending` alone would settle on
  // "no vehicle" before the first fetch ever ran.
  const isLoading =
    tenantLoading || (canQuery && query.isPending && query.fetchStatus !== 'idle');

  return {
    vehicle: query.data ?? null,
    isLoading,
    // Derived from "everything settled and still nothing" rather than from
    // `isSuccess` alone. That closes the dead state where the id is empty or the
    // tenant never resolved: the query never runs, so it is neither pending nor
    // successful, and the page would render a blank forever.
    notFound: !isLoading && !query.isError && (query.data ?? null) === null,
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
