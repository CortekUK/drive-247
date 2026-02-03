'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface DeliveryLocation {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  delivery_fee: number;
  collection_fee: number;
  is_delivery_enabled: boolean;
  is_collection_enabled: boolean;
  is_active: boolean;
  sort_order: number;
}

/**
 * Hook to fetch delivery/collection locations for the booking app.
 *
 * Returns only active locations, split into:
 * - deliveryLocations: Locations where is_delivery_enabled = true
 * - collectionLocations: Locations where is_collection_enabled = true
 */
export function useDeliveryLocations() {
  const { tenant } = useTenant();

  const {
    data: locations,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['delivery-locations', tenant?.id],
    queryFn: async (): Promise<DeliveryLocation[]> => {
      if (!tenant?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from('delivery_locations')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[useDeliveryLocations] Error fetching locations:', error);
        throw error;
      }

      return data as DeliveryLocation[];
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Filter locations by service type
  const deliveryLocations = (locations || []).filter(
    (loc) => loc.is_delivery_enabled
  );
  const collectionLocations = (locations || []).filter(
    (loc) => loc.is_collection_enabled
  );

  return {
    locations: locations || [],
    deliveryLocations,
    collectionLocations,
    isLoading,
    error,
  };
}
