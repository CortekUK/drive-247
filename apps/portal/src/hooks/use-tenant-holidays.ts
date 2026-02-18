import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface TenantHoliday {
  id: string;
  tenant_id: string;
  name: string;
  start_date: string;
  end_date: string;
  surcharge_percent: number;
  excluded_vehicle_ids: string[];
  recurs_annually: boolean;
  created_at: string;
  updated_at: string;
}

export type TenantHolidayInsert = Omit<TenantHoliday, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>;
export type TenantHolidayUpdate = Partial<TenantHolidayInsert> & { id: string };

export const useTenantHolidays = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ['tenant-holidays', tenant?.id];

  const { data: holidays, isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<TenantHoliday[]> => {
      if (!tenant?.id) return [];

      const { data, error } = await (supabase as any)
        .from('tenant_holidays')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('start_date', { ascending: true });

      if (error) throw error;
      return (data || []) as TenantHoliday[];
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async (holiday: TenantHolidayInsert) => {
      if (!tenant?.id) throw new Error('No tenant ID');

      const { data, error } = await (supabase as any)
        .from('tenant_holidays')
        .insert({ ...holiday, tenant_id: tenant.id })
        .select()
        .single();

      if (error) throw error;
      return data as TenantHoliday;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Holiday Added', description: 'Holiday pricing rule created.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: TenantHolidayUpdate) => {
      const { data, error } = await (supabase as any)
        .from('tenant_holidays')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as TenantHoliday;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Holiday Updated', description: 'Holiday pricing rule updated.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('tenant_holidays')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: 'Holiday Deleted', description: 'Holiday pricing rule removed.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    holidays: holidays || [],
    isLoading,
    error,
    addHoliday: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    updateHoliday: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deleteHoliday: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
};
