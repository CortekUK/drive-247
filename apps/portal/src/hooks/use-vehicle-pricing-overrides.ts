import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface VehiclePricingOverride {
  id: string;
  vehicle_id: string;
  rule_type: 'weekend' | 'holiday';
  holiday_id: string | null;
  override_type: 'fixed_price' | 'custom_percent' | 'excluded';
  fixed_price: number | null;
  custom_percent: number | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  holiday_name?: string;
}

export type VehiclePricingOverrideUpsert = {
  vehicle_id: string;
  rule_type: 'weekend' | 'holiday';
  holiday_id?: string | null;
  override_type: 'fixed_price' | 'custom_percent' | 'excluded';
  fixed_price?: number | null;
  custom_percent?: number | null;
};

export const useVehiclePricingOverrides = (vehicleId?: string) => {
  const queryClient = useQueryClient();
  const queryKey = ['vehicle-pricing-overrides', vehicleId];

  const { data: overrides, isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<VehiclePricingOverride[]> => {
      if (!vehicleId) return [];

      // Fetch overrides
      const { data, error } = await (supabase as any)
        .from('vehicle_pricing_overrides')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('rule_type', { ascending: true });

      if (error) throw error;
      return (data || []) as VehiclePricingOverride[];
    },
    enabled: !!vehicleId,
    staleTime: 30_000,
  });

  const upsertMutation = useMutation({
    mutationFn: async (override: VehiclePricingOverrideUpsert) => {
      // Use upsert with the unique constraint (vehicle_id, rule_type, holiday_id)
      const payload = {
        vehicle_id: override.vehicle_id,
        rule_type: override.rule_type,
        holiday_id: override.holiday_id ?? null,
        override_type: override.override_type,
        fixed_price: override.override_type === 'fixed_price' ? override.fixed_price : null,
        custom_percent: override.override_type === 'custom_percent' ? override.custom_percent : null,
      };

      // A weekend override has no holiday_id, and the unique key treats NULLs as
      // distinct, so an upsert never finds the existing weekend row: it inserted
      // a second one and the old answer kept winning. Update the car's own
      // weekend row when there is one; the holiday path still upserts.
      if (payload.holiday_id === null) {
        const { data: existing, error: findError } = await (supabase as any)
          .from('vehicle_pricing_overrides')
          .select('id')
          .eq('vehicle_id', payload.vehicle_id)
          .eq('rule_type', payload.rule_type)
          .is('holiday_id', null);
        if (findError) throw findError;
        const ids = ((existing ?? []) as { id: string }[]).map((r) => r.id);
        if (ids.length > 0) {
          const { data, error } = await (supabase as any)
            .from('vehicle_pricing_overrides')
            .update(payload)
            .eq('id', ids[0])
            .select()
            .single();
          if (error) throw error;
          // Any older duplicates from before this fix would otherwise still win.
          if (ids.length > 1) {
            await (supabase as any).from('vehicle_pricing_overrides').delete().in('id', ids.slice(1));
          }
          return data as VehiclePricingOverride;
        }
        const { data, error } = await (supabase as any)
          .from('vehicle_pricing_overrides')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        return data as VehiclePricingOverride;
      }

      const { data, error } = await (supabase as any)
        .from('vehicle_pricing_overrides')
        .upsert(payload, { onConflict: 'vehicle_id,rule_type,holiday_id' })
        .select()
        .single();

      if (error) throw error;
      return data as VehiclePricingOverride;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Override Saved', description: 'Vehicle pricing override updated.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('vehicle_pricing_overrides')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Override Removed', description: 'Vehicle uses global pricing rule.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  // Delete by rule_type + holiday_id (reset to inherit)
  const resetMutation = useMutation({
    mutationFn: async (params: { ruleType: 'weekend' | 'holiday'; holidayId?: string | null }) => {
      let query = (supabase as any)
        .from('vehicle_pricing_overrides')
        .delete()
        .eq('vehicle_id', vehicleId)
        .eq('rule_type', params.ruleType);

      if (params.ruleType === 'holiday' && params.holidayId) {
        query = query.eq('holiday_id', params.holidayId);
      } else if (params.ruleType === 'weekend') {
        query = query.is('holiday_id', null);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Reset', description: 'Vehicle now uses global pricing.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    overrides: overrides || [],
    isLoading,
    error,
    upsertOverride: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
    deleteOverride: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    resetOverride: resetMutation.mutateAsync,
    isResetting: resetMutation.isPending,
  };
};
