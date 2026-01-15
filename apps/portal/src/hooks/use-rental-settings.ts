import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface RentalSettings {
  min_rental_days: number | null;
  max_rental_days: number | null;
  booking_lead_time_hours: number | null;
  minimum_rental_age: number | null;
  require_identity_verification: boolean | null;
  require_insurance_upload: boolean | null;
  tax_enabled: boolean | null;
  tax_percentage: number | null;
  service_fee_enabled: boolean | null;
  service_fee_amount: number | null;
  deposit_mode: 'global' | 'per_vehicle' | null;
  global_deposit_amount: number | null;
  // Working hours settings
  working_hours_enabled: boolean | null;
  working_hours_open: string | null;
  working_hours_close: string | null;
  working_hours_always_open: boolean | null;
}

const DEFAULT_RENTAL_SETTINGS: RentalSettings = {
  min_rental_days: 1,
  max_rental_days: 90,
  booking_lead_time_hours: 24,
  minimum_rental_age: 18,
  require_identity_verification: true,
  require_insurance_upload: false,
  tax_enabled: false,
  tax_percentage: 0,
  service_fee_enabled: false,
  service_fee_amount: 0,
  deposit_mode: 'global',
  global_deposit_amount: 0,
  // Working hours defaults
  working_hours_enabled: true,
  working_hours_open: '09:00',
  working_hours_close: '17:00',
  working_hours_always_open: false,
};

/**
 * Hook to manage tenant-specific rental settings
 *
 * This hook reads and writes rental settings to the `tenants` table,
 * enabling per-tenant customization for multi-tenant deployments.
 */
export const useRentalSettings = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch rental settings from tenants table
  const {
    data: settings,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['rental-settings', tenant?.id],
    queryFn: async (): Promise<RentalSettings> => {
      if (!tenant?.id) {
        console.log('[RentalSettings] No tenant ID, returning defaults');
        return DEFAULT_RENTAL_SETTINGS;
      }

      console.log(`[RentalSettings] Fetching settings for tenant: ${tenant.id}`);

      const { data, error } = await supabase
        .from('tenants')
        .select(`
          min_rental_days,
          max_rental_days,
          booking_lead_time_hours,
          minimum_rental_age,
          require_identity_verification,
          require_insurance_upload,
          tax_enabled,
          tax_percentage,
          service_fee_enabled,
          service_fee_amount,
          deposit_mode,
          global_deposit_amount,
          working_hours_enabled,
          working_hours_open,
          working_hours_close,
          working_hours_always_open
        `)
        .eq('id', tenant.id)
        .single();

      if (error) {
        console.error('[RentalSettings] Error fetching settings:', error);
        throw error;
      }

      console.log('[RentalSettings] Settings loaded:', data);
      return { ...DEFAULT_RENTAL_SETTINGS, ...data } as RentalSettings;
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000, // 30 seconds
    placeholderData: DEFAULT_RENTAL_SETTINGS,
  });

  // Update rental settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<RentalSettings>): Promise<RentalSettings> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      console.log(`[RentalSettings] Updating settings for tenant ${tenant.id}:`, updates);

      const { data, error } = await supabase
        .from('tenants')
        .update(updates)
        .eq('id', tenant.id)
        .select(`
          min_rental_days,
          max_rental_days,
          booking_lead_time_hours,
          minimum_rental_age,
          require_identity_verification,
          require_insurance_upload,
          tax_enabled,
          tax_percentage,
          service_fee_enabled,
          service_fee_amount,
          deposit_mode,
          global_deposit_amount,
          working_hours_enabled,
          working_hours_open,
          working_hours_close,
          working_hours_always_open
        `);

      if (error) {
        console.error('[RentalSettings] Update error:', error);
        throw error;
      }

      // Handle case where no rows were updated
      if (!data || data.length === 0) {
        console.warn('[RentalSettings] No rows updated, tenant may not exist');
        throw new Error('Tenant not found or no permission to update');
      }

      console.log('[RentalSettings] Settings updated:', data[0]);
      return { ...DEFAULT_RENTAL_SETTINGS, ...data[0] } as RentalSettings;
    },
    onSuccess: (data) => {
      // Update the cache with new data
      queryClient.setQueryData(['rental-settings', tenant?.id], data);

      toast({
        title: "Settings Updated",
        description: "Your rental settings have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      console.error('[RentalSettings] Update error:', error);
      toast({
        title: "Error",
        description: `Failed to update settings: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  return {
    settings: settings || DEFAULT_RENTAL_SETTINGS,
    isLoading,
    error,
    refetch,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending,
    tenantId: tenant?.id,
  };
};
