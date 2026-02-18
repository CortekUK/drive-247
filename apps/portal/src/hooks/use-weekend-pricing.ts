import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface WeekendPricingSettings {
  weekend_surcharge_percent: number;
  weekend_days: number[]; // JS day numbers: 0=Sun...6=Sat
}

const DEFAULTS: WeekendPricingSettings = {
  weekend_surcharge_percent: 0,
  weekend_days: [6, 0],
};

export const useWeekendPricing = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['weekend-pricing', tenant?.id],
    queryFn: async (): Promise<WeekendPricingSettings> => {
      if (!tenant?.id) return DEFAULTS;

      const { data, error } = await (supabase as any)
        .from('tenants')
        .select('weekend_surcharge_percent, weekend_days')
        .eq('id', tenant.id)
        .single();

      if (error) throw error;

      return {
        weekend_surcharge_percent: data?.weekend_surcharge_percent ?? 0,
        weekend_days: data?.weekend_days ?? [6, 0],
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
    placeholderData: DEFAULTS,
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<WeekendPricingSettings>) => {
      if (!tenant?.id) throw new Error('No tenant ID');

      const { error } = await (supabase as any)
        .from('tenants')
        .update(updates)
        .eq('id', tenant.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekend-pricing', tenant?.id] });
      toast({ title: 'Saved', description: 'Weekend pricing updated.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    settings: settings || DEFAULTS,
    isLoading,
    error,
    updateSettings: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
};
