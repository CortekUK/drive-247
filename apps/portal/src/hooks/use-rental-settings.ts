import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export type WhatGetsSplit = 'rental_only' | 'rental_tax' | 'rental_tax_extras';

export interface InstallmentConfig {
  min_days_for_weekly: number;
  min_days_for_monthly: number;
  max_installments_weekly: number;
  max_installments_monthly: number;
  // Phase 3 additions
  charge_first_upfront: boolean;
  what_gets_split: WhatGetsSplit;
  grace_period_days: number;
  max_retry_attempts: number;
  retry_interval_days: number;
}

export interface RentalSettings {
  min_rental_days: number | null;
  min_rental_hours: number | null;
  max_rental_days: number | null;
  booking_lead_time_hours: number | null;
  minimum_rental_age: number | null;
  require_identity_verification: boolean | null;
  require_insurance_upload: boolean | null;
  tax_enabled: boolean | null;
  tax_percentage: number | null;
  service_fee_enabled: boolean | null;
  service_fee_amount: number | null;
  service_fee_type: 'percentage' | 'fixed_amount' | null;
  service_fee_value: number | null;
  deposit_mode: 'global' | 'per_vehicle' | null;
  global_deposit_amount: number | null;
  // Working hours settings
  working_hours_enabled: boolean | null;
  working_hours_open: string | null;
  working_hours_close: string | null;
  working_hours_always_open: boolean | null;
  // Installment settings
  installments_enabled: boolean | null;
  installment_config: InstallmentConfig | null;
  // Booking lead time display unit
  booking_lead_time_unit: 'hours' | 'days' | null;
  // Lockbox settings
  lockbox_enabled: boolean | null;
  lockbox_code_length: number | null;
  lockbox_notification_methods: string[] | null;
  lockbox_default_instructions: string | null;
}

const DEFAULT_RENTAL_SETTINGS: RentalSettings = {
  min_rental_days: 0,
  min_rental_hours: 1,
  max_rental_days: 90,
  booking_lead_time_hours: 24,
  minimum_rental_age: 18,
  require_identity_verification: true,
  require_insurance_upload: false,
  tax_enabled: false,
  tax_percentage: 0,
  service_fee_enabled: false,
  service_fee_amount: 0,
  service_fee_type: 'fixed_amount',
  service_fee_value: 0,
  deposit_mode: 'global',
  global_deposit_amount: 0,
  // Working hours defaults
  working_hours_enabled: true,
  working_hours_open: '09:00',
  working_hours_close: '17:00',
  working_hours_always_open: true,
  // Installment defaults
  installments_enabled: false,
  installment_config: {
    min_days_for_weekly: 7,
    min_days_for_monthly: 30,
    max_installments_weekly: 4,
    max_installments_monthly: 6,
    // Phase 3 defaults
    charge_first_upfront: true,
    what_gets_split: 'rental_tax',
    grace_period_days: 3,
    max_retry_attempts: 3,
    retry_interval_days: 1,
  },
  // Booking lead time display unit
  booking_lead_time_unit: 'hours',
  // Lockbox defaults
  lockbox_enabled: false,
  lockbox_code_length: null,
  lockbox_notification_methods: ['email'],
  lockbox_default_instructions: null,
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
          min_rental_hours,
          max_rental_days,
          booking_lead_time_hours,
          booking_lead_time_unit,
          minimum_rental_age,
          require_identity_verification,
          require_insurance_upload,
          tax_enabled,
          tax_percentage,
          service_fee_enabled,
          service_fee_amount,
          service_fee_type,
          service_fee_value,
          deposit_mode,
          global_deposit_amount,
          working_hours_enabled,
          working_hours_open,
          working_hours_close,
          working_hours_always_open,
          installments_enabled,
          installment_config,
          lockbox_enabled,
          lockbox_code_length,
          lockbox_notification_methods,
          lockbox_default_instructions
        `)
        .eq('id', tenant.id)
        .single();

      if (error) {
        console.error('[RentalSettings] Error fetching settings:', error);
        throw error;
      }

      console.log('[RentalSettings] Settings loaded:', data);

      // Map service_fee_amount to service_fee_value for backward compatibility
      const result = { ...DEFAULT_RENTAL_SETTINGS, ...data };
      if (result.service_fee_value === null || result.service_fee_value === undefined) {
        result.service_fee_value = result.service_fee_amount ?? 0;
      }
      // Parse lockbox_notification_methods from JSON if needed
      if (result.lockbox_notification_methods && !Array.isArray(result.lockbox_notification_methods)) {
        result.lockbox_notification_methods = result.lockbox_notification_methods as unknown as string[];
      }
      return result as RentalSettings;
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
          min_rental_hours,
          max_rental_days,
          booking_lead_time_hours,
          booking_lead_time_unit,
          minimum_rental_age,
          require_identity_verification,
          require_insurance_upload,
          tax_enabled,
          tax_percentage,
          service_fee_enabled,
          service_fee_amount,
          service_fee_type,
          service_fee_value,
          deposit_mode,
          global_deposit_amount,
          working_hours_enabled,
          working_hours_open,
          working_hours_close,
          working_hours_always_open,
          installments_enabled,
          installment_config,
          lockbox_enabled,
          lockbox_code_length,
          lockbox_notification_methods,
          lockbox_default_instructions
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
