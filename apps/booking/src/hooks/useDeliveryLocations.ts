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
  is_pickup_enabled: boolean;
  is_return_enabled: boolean;
  is_active: boolean;
  sort_order: number;
}

/**
 * Hook to fetch delivery/pickup locations for the booking app.
 *
 * Returns active locations from the pickup_locations table with delivery fees,
 * along with filtered lists for pickup-enabled and return-enabled locations.
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
        .from('pickup_locations')
        .select('id, tenant_id, name, address, delivery_fee, is_pickup_enabled, is_return_enabled, is_active, sort_order')
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

  const allLocations = locations || [];

  return {
    locations: allLocations,
    // Filtered lists for pickup and return
    pickupLocations: allLocations.filter(l => l.is_pickup_enabled),
    returnLocations: allLocations.filter(l => l.is_return_enabled),
    isLoading,
    error,
  };
}
