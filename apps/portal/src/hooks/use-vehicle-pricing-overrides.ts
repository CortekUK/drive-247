import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/use-audit-log';

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
  const { logAction } = useAuditLog();
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

      const { data, error } = await (supabase as any)
        .from('vehicle_pricing_overrides')
        .upsert(payload, { onConflict: 'vehicle_id,rule_type,holiday_id' })
        .select()
        .single();

      if (error) throw error;
      return data as VehiclePricingOverride;
    },
    onSuccess: (_data: VehiclePricingOverride, variables: VehiclePricingOverrideUpsert) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Override Saved', description: 'Vehicle pricing override updated.' });
      logAction({
        action: "settings_updated",
        entityType: "vehicle",
        entityId: variables.vehicle_id,
        details: { section: "pricing_override", rule_type: variables.rule_type, override_type: variables.override_type },
      });
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
    onSuccess: (_data: void, id: string) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Override Removed', description: 'Vehicle uses global pricing rule.' });
      logAction({
        action: "settings_updated",
        entityType: "vehicle",
        entityId: vehicleId || "unknown",
        details: { section: "pricing_override", action: "removed", override_id: id },
      });
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
    onSuccess: (_data: void, params: { ruleType: 'weekend' | 'holiday'; holidayId?: string | null }) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Reset', description: 'Vehicle now uses global pricing.' });
      logAction({
        action: "settings_updated",
        entityType: "vehicle",
        entityId: vehicleId || "unknown",
        details: { section: "pricing_override", action: "reset", rule_type: params.ruleType },
      });
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
