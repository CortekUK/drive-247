'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import type { PublicVehiclePhotoRow, VehicleImage } from '@/lib/vehicles/types';
import { normalizeVehicleImages } from '@/hooks/use-vehicles';

/**
 * The columns the gallery needs, plus the tenant boundary.
 *
 * The boundary is drawn through `vehicles!inner`, NOT through
 * `vehicle_photos.tenant_id`. That column is NULLABLE in the schema — filtering
 * on it directly would silently drop every photo row an older import left
 * unstamped, and the customer would see an empty gallery for a car that has
 * pictures. The owning vehicle's `tenant_id` is the authoritative answer, and
 * `!inner` makes the join a filter rather than an optional embed.
 *
 * (Live on staging all 20 photo rows happen to be stamped — which is exactly why
 * a `tenant_id` filter would look correct here and fail somewhere else.)
 */
const PHOTO_SELECT =
  'photo_url, redacted_url, redaction_status, display_order, vehicles!inner ( tenant_id )';

type PhotoQueryRow = PublicVehiclePhotoRow & {
  vehicles: { tenant_id: string | null };
};

export interface UseVehiclePhotosResult {
  /** Every image in display order, redaction already applied. */
  images: VehicleImage[];
  /** Convenience projection for simple carousels. */
  photoUrls: string[];
  primaryPhotoUrl: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * A vehicle's gallery, fetched on its own.
 *
 * `useVehicles` and `useVehicle` already return their photos via the joined
 * `vehicle_photos` embed, so the vehicle page does NOT need this to render its
 * hero image. This exists for the surfaces that hold a vehicle id but not the
 * row — a lightbox opened from a booking summary, a re-fetch after the operator
 * uploads a photo — and it returns the identical `VehicleImage[]` shape so the
 * same gallery component serves both.
 */
export function useVehiclePhotos(
  vehicleId: string | null | undefined,
): UseVehiclePhotosResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const id = typeof vehicleId === 'string' ? vehicleId.trim() : '';

  const query = useQuery({
    queryKey: ['vehicle-photos', tenant?.id, id],
    queryFn: async (): Promise<VehicleImage[]> => {
      if (!tenant?.id || !id) return [];

      const { data, error } = await supabase
        .from('vehicle_photos')
        .select(PHOTO_SELECT)
        .eq('vehicle_id', id)
        .eq('vehicles.tenant_id', tenant.id)
        .order('display_order', { ascending: true, nullsFirst: false })
        .overrideTypes<PhotoQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useVehiclePhotos] Failed to load photos', {
          tenantId: tenant.id,
          vehicleId: id,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load vehicle photos');
      }

      // Same normaliser the list uses, so a photo cannot be redacted in one
      // place and served raw in the other.
      return normalizeVehicleImages(data ?? [], tenant);
    },
    enabled: !!tenant && id !== '',
  });

  const images = useMemo(() => query.data ?? [], [query.data]);
  const photoUrls = useMemo(() => images.map((image) => image.url), [images]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    images,
    photoUrls,
    primaryPhotoUrl: images[0]?.url ?? null,
    isLoading:
      tenantLoading ||
      (!!tenant && id !== '' && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
