import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';

export interface OrgSettings {
  id?: string;
  org_id: string;
  company_name: string;
  timezone: string;
  currency_code: string;
  date_format: string;
  logo_url?: string;
  reminder_due_today: boolean;
  reminder_overdue_1d: boolean;
  reminder_overdue_multi: boolean;
  reminder_due_soon_2d: boolean;
  payment_mode: 'automated' | 'manual';
  booking_payment_mode: 'manual' | 'auto';
  tests_last_run_dashboard?: string;
  tests_last_result_dashboard?: any;
  tests_last_run_rental?: string;
  tests_last_result_rental?: any;
  tests_last_run_finance?: string;
  tests_last_result_finance?: any;
  created_at?: string;
  updated_at?: string;
  // Branding fields
  app_name?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  // Theme-specific colors
  light_primary_color?: string;
  light_secondary_color?: string;
  light_accent_color?: string;
  dark_primary_color?: string;
  dark_secondary_color?: string;
  dark_accent_color?: string;
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
  favicon_url?: string;
  light_background_color?: string;
  dark_background_color?: string;
  // Header/Footer colors
  light_header_footer_color?: string;
  dark_header_footer_color?: string;
}

// Custom hook for organisation settings
export const useOrgSettings = () => {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  // Fetch settings query with fallback defaults
  const {
    data: settings,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['org-settings'],
    queryFn: async (): Promise<OrgSettings> => {
      console.log('Fetching org settings...');
      
      try {
        const { data, error } = await supabase.functions.invoke('settings', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (error) {
          console.error('Settings edge function error:', error);
          throw new Error(`Settings API error: ${error.message}`);
        }

        if (!data) {
          console.error('No data returned from settings function');
          throw new Error('No settings data received');
        }

        console.log('Settings loaded successfully:', data);
        return data;
      } catch (err) {
        console.error('Settings fetch failed:', err);
        throw err;
      }
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: false, // Disable auto-refetch to avoid spam
    retry: (failureCount, error) => {
      console.log(`Settings fetch retry ${failureCount}:`, error);
      return failureCount < 2; // Only retry twice
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    // Add fallback default settings if fetch fails
    placeholderData: {
      org_id: 'placeholder',
      company_name: 'Fleet Management System',
      timezone: 'America/New_York',
      currency_code: 'USD',
      date_format: 'MM/DD/YYYY',
      reminder_due_today: true,
      reminder_overdue_1d: true,
      reminder_overdue_multi: true,
      reminder_due_soon_2d: false,
      payment_mode: 'automated',
      booking_payment_mode: 'manual',
      // Branding defaults
      app_name: 'Drive 917',
      primary_color: '#C6A256',
      secondary_color: '#C6A256',
      accent_color: '#C6A256',
      meta_title: 'Drive 917 - Portal',
      meta_description: 'Fleet management portal',
    } as OrgSettings,
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: Partial<OrgSettings>): Promise<OrgSettings> => {
      console.log('🔧 [SETTINGS] Updating settings with:', updates);
      console.log('🔧 [SETTINGS] Tenant context:', tenant?.id);
      console.log('🔧 [SETTINGS] Calling Edge Function...');
      
      // Include tenant_id from context for proper multi-tenant audit logging
      const requestBody = {
        ...updates,
        _tenant_id: tenant?.id, // Will be extracted by Edge Function for audit logging
      };
      
      const { data, error } = await supabase.functions.invoke('settings', {
        body: requestBody,
      });

      console.log('🔧 [SETTINGS] Edge Function response:', { data, error });

      if (error) {
        console.error('❌ [SETTINGS] Settings update error:', error);
        throw new Error(`Failed to update settings: ${error.message}`);
      }

      console.log('✅ [SETTINGS] Settings updated successfully! Response:', data);
      return data;
    },
    onSuccess: (data) => {
      console.log('✅ [SETTINGS] onSuccess - Cache updated');
      // Update the cache with new data
      queryClient.setQueryData(['org-settings'], data);
      
      // Invalidate related queries that might depend on settings
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      
      toast({
        title: "Settings Updated",
        description: "Organisation settings have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      console.error('Settings update error:', error);
      toast({
        title: "Error",
        description: `Failed to update settings: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Convenience methods for specific updates
  const updateCompanyProfile = (profile: {
    company_name: string;
    timezone: string;
    currency_code: string;
    date_format: string;
    logo_url?: string;
  }) => {
    return updateSettingsMutation.mutate(profile);
  };

  const updateReminderSettings = (reminders: {
    reminder_due_today?: boolean;
    reminder_overdue_1d?: boolean;
    reminder_overdue_multi?: boolean;
    reminder_due_soon_2d?: boolean;
  }) => {
    return updateSettingsMutation.mutate(reminders);
  };

  const toggleReminder = (reminderType: keyof Pick<OrgSettings, 'reminder_due_today' | 'reminder_overdue_1d' | 'reminder_overdue_multi' | 'reminder_due_soon_2d'>) => {
    console.log('🔔 [TOGGLE] toggleReminder called with:', reminderType);
    console.log('🔔 [TOGGLE] Current settings:', settings);
    
    if (!settings) {
      console.log('🔔 [TOGGLE] No settings available, returning early');
      return;
    }

    const newValue = !settings[reminderType];
    console.log('🔔 [TOGGLE] Toggling', reminderType, 'from', settings[reminderType], 'to', newValue);

    return updateSettingsMutation.mutate({
      [reminderType]: newValue
    });
  };

  const setPaymentMode = (mode: 'automated' | 'manual') => {
    return updateSettingsMutation.mutate({
      payment_mode: mode
    });
  };

  const setBookingPaymentMode = (mode: 'manual' | 'auto') => {
    return updateSettingsMutation.mutate({
      booking_payment_mode: mode
    });
  };

  const updateBranding = (branding: {
    app_name?: string;
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    light_primary_color?: string;
    light_secondary_color?: string;
    light_accent_color?: string;
    dark_primary_color?: string;
    dark_secondary_color?: string;
    dark_accent_color?: string;
    logo_url?: string;
    meta_title?: string;
    meta_description?: string;
    og_image_url?: string;
    favicon_url?: string;
    light_background_color?: string;
    dark_background_color?: string;
    light_header_footer_color?: string;
    dark_header_footer_color?: string;
  }) => {
    return updateSettingsMutation.mutateAsync(branding);
  };

  return {
    settings,
    isLoading,
    error,
    refetch,
    updateSettings: updateSettingsMutation.mutate,
    updateSettingsAsync: updateSettingsMutation.mutateAsync,
    updateCompanyProfile,
    updateReminderSettings,
    toggleReminder,
    setPaymentMode,
    setBookingPaymentMode,
    updateBranding,
    isUpdating: updateSettingsMutation.isPending,
  };
};