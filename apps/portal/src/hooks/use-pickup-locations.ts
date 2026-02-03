import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface PickupLocation {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  is_pickup_enabled: boolean;
  is_return_enabled: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePickupLocationInput {
  name: string;
  address: string;
  is_pickup_enabled?: boolean;
  is_return_enabled?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdatePickupLocationInput {
  id: string;
  name?: string;
  address?: string;
  is_pickup_enabled?: boolean;
  is_return_enabled?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export type LocationMode = 'fixed' | 'custom' | 'multiple' | 'area_around';

export interface LocationSettings {
  pickup_location_mode: LocationMode;
  return_location_mode: LocationMode;
  fixed_pickup_address: string | null;
  fixed_return_address: string | null;
  // Fields for area_around mode
  pickup_area_radius_km: number | null;
  return_area_radius_km: number | null;
  area_center_lat: number | null;
  area_center_lon: number | null;
}

const DEFAULT_LOCATION_SETTINGS: LocationSettings = {
  pickup_location_mode: 'custom',
  return_location_mode: 'custom',
  fixed_pickup_address: null,
  fixed_return_address: null,
  pickup_area_radius_km: 25,
  return_area_radius_km: 25,
  area_center_lat: null,
  area_center_lon: null,
};

/**
 * Hook to manage pickup/return locations for a tenant
 *
 * This hook provides:
 * - Location mode settings (fixed/custom/multiple)
 * - CRUD operations for predefined locations
 */
export const usePickupLocations = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // ============================================
  // Fetch location settings from tenants table
  // ============================================
  const {
    data: locationSettings,
    isLoading: isLoadingSettings,
    error: settingsError,
  } = useQuery({
    queryKey: ['location-settings', tenant?.id],
    queryFn: async (): Promise<LocationSettings> => {
      if (!tenant?.id) {
        return DEFAULT_LOCATION_SETTINGS;
      }

      const { data, error } = await supabase
        .from('tenants')
        .select(`
          pickup_location_mode,
          return_location_mode,
          fixed_pickup_address,
          fixed_return_address,
          pickup_area_radius_km,
          return_area_radius_km,
          area_center_lat,
          area_center_lon
        `)
        .eq('id', tenant.id)
        .single();

      if (error) {
        console.error('[PickupLocations] Error fetching settings:', error);
        throw error;
      }

      return {
        pickup_location_mode: (data?.pickup_location_mode as LocationMode) || 'custom',
        return_location_mode: (data?.return_location_mode as LocationMode) || 'custom',
        fixed_pickup_address: data?.fixed_pickup_address || null,
        fixed_return_address: data?.fixed_return_address || null,
        pickup_area_radius_km: data?.pickup_area_radius_km ?? 25,
        return_area_radius_km: data?.return_area_radius_km ?? 25,
        area_center_lat: data?.area_center_lat || null,
        area_center_lon: data?.area_center_lon || null,
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
    placeholderData: DEFAULT_LOCATION_SETTINGS,
  });

  // ============================================
  // Fetch predefined locations
  // ============================================
  const {
    data: locations,
    isLoading: isLoadingLocations,
    error: locationsError,
    refetch: refetchLocations,
  } = useQuery({
    queryKey: ['pickup-locations', tenant?.id],
    queryFn: async (): Promise<PickupLocation[]> => {
      if (!tenant?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from('pickup_locations')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[PickupLocations] Error fetching locations:', error);
        throw error;
      }

      return data as PickupLocation[];
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
  });

  // ============================================
  // Update location settings mutation
  // ============================================
  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<LocationSettings>): Promise<LocationSettings> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { data, error } = await supabase
        .from('tenants')
        .update({
          pickup_location_mode: updates.pickup_location_mode,
          return_location_mode: updates.return_location_mode,
          fixed_pickup_address: updates.fixed_pickup_address,
          fixed_return_address: updates.fixed_return_address,
          pickup_area_radius_km: updates.pickup_area_radius_km,
          return_area_radius_km: updates.return_area_radius_km,
          area_center_lat: updates.area_center_lat,
          area_center_lon: updates.area_center_lon,
        })
        .eq('id', tenant.id)
        .select(`
          pickup_location_mode,
          return_location_mode,
          fixed_pickup_address,
          fixed_return_address,
          pickup_area_radius_km,
          return_area_radius_km,
          area_center_lat,
          area_center_lon
        `)
        .single();

      if (error) {
        console.error('[PickupLocations] Settings update error:', error);
        throw error;
      }

      return {
        pickup_location_mode: (data?.pickup_location_mode as LocationMode) || 'custom',
        return_location_mode: (data?.return_location_mode as LocationMode) || 'custom',
        fixed_pickup_address: data?.fixed_pickup_address || null,
        fixed_return_address: data?.fixed_return_address || null,
        pickup_area_radius_km: data?.pickup_area_radius_km ?? 25,
        return_area_radius_km: data?.return_area_radius_km ?? 25,
        area_center_lat: data?.area_center_lat || null,
        area_center_lon: data?.area_center_lon || null,
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['location-settings', tenant?.id], data);
      toast({
        title: "Settings Updated",
        description: "Location settings have been saved successfully.",
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
    mutationFn: async (input: CreatePickupLocationInput): Promise<PickupLocation> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { data, error } = await supabase
        .from('pickup_locations')
        .insert({
          tenant_id: tenant.id,
          name: input.name,
          address: input.address,
          is_pickup_enabled: input.is_pickup_enabled ?? true,
          is_return_enabled: input.is_return_enabled ?? true,
          is_active: input.is_active ?? true,
          sort_order: input.sort_order ?? (locations?.length || 0),
        })
        .select()
        .single();

      if (error) {
        console.error('[PickupLocations] Create error:', error);
        throw error;
      }

      return data as PickupLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-locations', tenant?.id] });
      toast({
        title: "Location Added",
        description: "New pickup location has been added successfully.",
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
    mutationFn: async (input: UpdatePickupLocationInput): Promise<PickupLocation> => {
      const { id, ...updates } = input;

      const { data, error } = await supabase
        .from('pickup_locations')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[PickupLocations] Update error:', error);
        throw error;
      }

      return data as PickupLocation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-locations', tenant?.id] });
      toast({
        title: "Location Updated",
        description: "Pickup location has been updated successfully.",
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
        .from('pickup_locations')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[PickupLocations] Delete error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-locations', tenant?.id] });
      toast({
        title: "Location Deleted",
        description: "Pickup location has been removed.",
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
      // Update each location with its new sort_order
      const updates = orderedIds.map((id, index) => ({
        id,
        sort_order: index,
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('pickup_locations')
          .update({ sort_order: update.sort_order })
          .eq('id', update.id);

        if (error) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-locations', tenant?.id] });
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
    locationSettings: locationSettings || DEFAULT_LOCATION_SETTINGS,
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
    pickupLocations: (locations || []).filter(l => l.is_active && l.is_pickup_enabled),
    returnLocations: (locations || []).filter(l => l.is_active && l.is_return_enabled),
  };
};
