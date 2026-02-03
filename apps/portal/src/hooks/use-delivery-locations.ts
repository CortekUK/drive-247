import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

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
  created_at: string;
  updated_at: string;
}

export interface CreateDeliveryLocationInput {
  name: string;
  address: string;
  delivery_fee?: number;
  collection_fee?: number;
  is_delivery_enabled?: boolean;
  is_collection_enabled?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdateDeliveryLocationInput {
  id: string;
  name?: string;
  address?: string;
  delivery_fee?: number;
  collection_fee?: number;
  is_delivery_enabled?: boolean;
  is_collection_enabled?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface DeliverySettings {
  delivery_enabled: boolean;
  collection_enabled: boolean;
}

const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  delivery_enabled: false,
  collection_enabled: false,
};

/**
 * Hook to manage delivery/collection locations and settings for a tenant
 *
 * This hook provides:
 * - Global delivery/collection service toggles
 * - CRUD operations for delivery/collection locations
 */
export const useDeliveryLocations = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // ============================================
  // Fetch delivery settings from tenants table
  // ============================================
  const {
    data: deliverySettings,
    isLoading: isLoadingSettings,
    error: settingsError,
  } = useQuery({
    queryKey: ['delivery-settings', tenant?.id],
    queryFn: async (): Promise<DeliverySettings> => {
      if (!tenant?.id) {
        return DEFAULT_DELIVERY_SETTINGS;
      }

      const { data, error } = await supabase
        .from('tenants')
        .select('delivery_enabled, collection_enabled')
        .eq('id', tenant.id)
        .single();

      if (error) {
        console.error('[DeliveryLocations] Error fetching settings:', error);
        throw error;
      }

      return {
        delivery_enabled: data?.delivery_enabled ?? false,
        collection_enabled: data?.collection_enabled ?? false,
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
    placeholderData: DEFAULT_DELIVERY_SETTINGS,
  });

  // ============================================
  // Fetch delivery locations
  // ============================================
  const {
    data: locations,
    isLoading: isLoadingLocations,
    error: locationsError,
    refetch: refetchLocations,
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
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[DeliveryLocations] Error fetching locations:', error);
        throw error;
      }

      return data as DeliveryLocation[];
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
  });

  // ============================================
  // Update delivery settings mutation
  // ============================================
  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<DeliverySettings>): Promise<DeliverySettings> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { data, error } = await supabase
        .from('tenants')
        .update({
          delivery_enabled: updates.delivery_enabled,
          collection_enabled: updates.collection_enabled,
        })
        .eq('id', tenant.id)
        .select('delivery_enabled, collection_enabled')
        .single();

      if (error) {
        console.error('[DeliveryLocations] Settings update error:', error);
        throw error;
      }

      return {
        delivery_enabled: data?.delivery_enabled ?? false,
        collection_enabled: data?.collection_enabled ?? false,
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['delivery-settings', tenant?.id], data);
      toast({
        title: "Settings Updated",
        description: "Delivery & collection settings have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to update settings: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // ============================================
  // Create location mutation
  // ============================================
  const createLocationMutation = useMutation({
    mutationFn: async (input: CreateDeliveryLocationInput): Promise<DeliveryLocation> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { data, error } = await supabase
        .from('delivery_locations')
        .insert({
          tenant_id: tenant.id,
          name: input.name,
          address: input.address,
          delivery_fee: input.delivery_fee ?? 0,
          collection_fee: input.collection_fee ?? 0,
          is_delivery_enabled: input.is_delivery_enabled ?? true,
          is_collection_enabled: input.is_collection_enabled ?? true,
          is_active: input.is_active ?? true,
          sort_order: input.sort_order ?? (locations?.length || 0),
        })
        .select()
        .single();

      if (error) {
        console.error('[DeliveryLocations] Create error:', error);
        throw error;
      }

      return data as DeliveryLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-locations', tenant?.id] });
      toast({
        title: "Location Added",
        description: "New delivery location has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message.includes('unique')
          ? "A location with this name already exists."
          : `Failed to add location: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // ============================================
  // Update location mutation
  // ============================================
  const updateLocationMutation = useMutation({
    mutationFn: async (input: UpdateDeliveryLocationInput): Promise<DeliveryLocation> => {
      const { id, ...updates } = input;

      const { data, error } = await supabase
        .from('delivery_locations')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[DeliveryLocations] Update error:', error);
        throw error;
      }

      return data as DeliveryLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-locations', tenant?.id] });
      toast({
        title: "Location Updated",
        description: "Delivery location has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message.includes('unique')
          ? "A location with this name already exists."
          : `Failed to update location: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // ============================================
  // Delete location mutation
  // ============================================
  const deleteLocationMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('delivery_locations')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[DeliveryLocations] Delete error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-locations', tenant?.id] });
      toast({
        title: "Location Deleted",
        description: "Delivery location has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to delete location: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // ============================================
  // Reorder locations mutation
  // ============================================
  const reorderLocationsMutation = useMutation({
    mutationFn: async (orderedIds: string[]): Promise<void> => {
      const updates = orderedIds.map((id, index) => ({
        id,
        sort_order: index,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('delivery_locations')
          .update({ sort_order: update.sort_order })
          .eq('id', update.id);

        if (error) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-locations', tenant?.id] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: `Failed to reorder locations: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  return {
    // Settings
    deliverySettings: deliverySettings || DEFAULT_DELIVERY_SETTINGS,
    isLoadingSettings,
    settingsError,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdatingSettings: updateSettingsMutation.isPending,

    // Locations
    locations: locations || [],
    isLoadingLocations,
    locationsError,
    refetchLocations,

    // CRUD operations
    createLocation: createLocationMutation.mutateAsync,
    isCreating: createLocationMutation.isPending,
    updateLocation: updateLocationMutation.mutateAsync,
    isUpdating: updateLocationMutation.isPending,
    deleteLocation: deleteLocationMutation.mutateAsync,
    isDeleting: deleteLocationMutation.isPending,
    reorderLocations: reorderLocationsMutation.mutateAsync,
    isReordering: reorderLocationsMutation.isPending,

    // Helpers
    tenantId: tenant?.id,
    activeLocations: (locations || []).filter(l => l.is_active),
    deliveryLocations: (locations || []).filter(l => l.is_active && l.is_delivery_enabled),
    collectionLocations: (locations || []).filter(l => l.is_active && l.is_collection_enabled),
  };
};
