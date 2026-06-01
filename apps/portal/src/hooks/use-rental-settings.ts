import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export type WhatGetsSplit = 'rental_only' | 'rental_tax' | 'rental_tax_extras';

export interface InstallmentConfig {
  minimum_days_weekly: number;
  minimum_days_monthly: number;
  minimum_days_semiweekly: number;
  weekly_installments_limit: number;
  monthly_installments_limit: number;
  semiweekly_installments_limit: number;
  limiting_amount_per_day_weekly: number;
  limiting_amount_per_day_monthly: number;
  limiting_amount_per_day_semiweekly: number;
  charge_first_upfront: boolean;
  what_gets_split: WhatGetsSplit;
  grace_period_days: number;
  max_retry_attempts: number;
  retry_interval_days: number;
  // Backward compat (old keys, read-only)
  min_days_for_weekly?: number;
  min_days_for_monthly?: number;
  max_installments_weekly?: number;
  max_installments_monthly?: number;
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
  security_deposit_enabled: boolean | null;
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
  lockbox_send_offset_minutes: number | null;
  // Verification
  verification_document_type: string | null;
  // Monthly tier threshold
  monthly_tier_days: number | null;
  // Buffer time between rentals (minutes)
  buffer_time_minutes: number | null;
  // Return reminder settings
  return_reminder_enabled: boolean | null;
  return_reminder_hours: number | null;
  // Pay As You Go
  pay_as_you_go_enabled: boolean | null;
  payg_reminder_interval_days: number | null;
  payg_grace_period_days: number | null;
  payg_max_reminders: number | null;
  payg_preauth_days: number | null;
  payg_max_duration_days: number | null;
  payg_upfront_required: boolean | null;
  // Auto-extension (prepaid rolling rentals)
  auto_extend_enabled: boolean | null;
  auto_extend_default_charge_mode: 'auto_charge' | 'pay_link' | null;
  auto_extend_default_lead_hours: number | null;
  auto_extend_grace_hours: number | null;
  auto_extend_max_retries: number | null;
  // Blog
  blog_enabled: boolean | null;
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
  security_deposit_enabled: true,
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
    minimum_days_weekly: 7,
    minimum_days_monthly: 30,
    minimum_days_semiweekly: 7,
    weekly_installments_limit: 4,
    monthly_installments_limit: 6,
    semiweekly_installments_limit: 8,
    limiting_amount_per_day_weekly: 0,
    limiting_amount_per_day_monthly: 0,
    limiting_amount_per_day_semiweekly: 0,
    charge_first_upfront: true,
    what_gets_split: 'rental_only',
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
  lockbox_send_offset_minutes: null,
  // Verification
  verification_document_type: 'driving_license',
  // Monthly tier threshold
  monthly_tier_days: 30,
  // Buffer time between rentals
  buffer_time_minutes: 0,
  // Return reminder
  return_reminder_enabled: false,
  return_reminder_hours: 24,
  // Pay As You Go
  pay_as_you_go_enabled: false,
  payg_reminder_interval_days: 4,
  payg_grace_period_days: 2,
  payg_max_reminders: 10,
  payg_preauth_days: 2,
  payg_max_duration_days: 90,
  payg_upfront_required: false,
  // Auto-extension (prepaid rolling rentals)
  auto_extend_enabled: false,
  auto_extend_default_charge_mode: 'pay_link',
  auto_extend_default_lead_hours: 0,
  auto_extend_grace_hours: 48,
  auto_extend_max_retries: 3,
  // Blog
  blog_enabled: false,
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

      // Use SELECT * so the query works even before the PAYG migration is pushed.
      // Missing PAYG columns simply won't be in the response — the ?? fallbacks in
      // the sync effect handle defaults. After migration + type regen, can switch back
      // to an explicit column list for type safety.
      const { data, error } = await supabaseUntyped
        .from('tenants')
        .select('*')
        .eq('id', tenant.id)
        .single();

      if (error) {
        console.error('[RentalSettings] Error fetching settings:', error);
        throw error;
      }

      console.log('[RentalSettings] Settings loaded:', data);

      // Detect whether the PAYG migration has been pushed by checking if the raw
      // DB row contains one of the new columns (before we spread defaults over it).
      const paygMigrationReady = data != null && 'payg_reminder_interval_days' in data;

      // Map service_fee_amount to service_fee_value for backward compatibility
      const result = { ...DEFAULT_RENTAL_SETTINGS, ...data, _paygMigrationReady: paygMigrationReady };
      if (result.service_fee_value === null || result.service_fee_value === undefined) {
        result.service_fee_value = result.service_fee_amount ?? 0;
      }
      // Parse lockbox_notification_methods from JSON if needed
      if (result.lockbox_notification_methods && !Array.isArray(result.lockbox_notification_methods)) {
        result.lockbox_notification_methods = result.lockbox_notification_methods as unknown as string[];
      }
      return result as unknown as RentalSettings;
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

      // SELECT * so updates work even before the PAYG migration is pushed.
      // The update itself only sends keys that exist — unknown keys are silently
      // ignored by PostgREST, so updating PAYG-only fields before the migration is
      // harmless (they'll 400 only if the column truly doesn't exist, caught below).
      const { data, error } = await supabaseUntyped
        .from('tenants')
        .update(updates as any)
        .eq('id', tenant.id)
        .select('*');

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
      const paygMigrationReady = data[0] != null && 'payg_reminder_interval_days' in data[0];
      return { ...DEFAULT_RENTAL_SETTINGS, ...data[0], _paygMigrationReady: paygMigrationReady } as unknown as RentalSettings;
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
