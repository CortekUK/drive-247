import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface VehicleExtra {
  id: string;
  extra_id: string;
  vehicle_id: string;
  price: number;
  extra_name: string;
  extra_description: string | null;
  extra_image_urls: string[];
  extra_is_active: boolean;
  extra_max_quantity: number | null;
}

export const useVehicleExtras = (vehicleId: string) => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const { data: vehicleExtras, isLoading } = useQuery({
    queryKey: ['vehicle-extras', tenant?.id, vehicleId],
    queryFn: async (): Promise<VehicleExtra[]> => {
      if (!tenant?.id || !vehicleId) return [];

      const { data, error } = await supabase
        .from('rental_extras_vehicle_pricing')
        .select('id, extra_id, vehicle_id, price, rental_extras(name, description, image_urls, is_active, max_quantity)')
        .eq('vehicle_id', vehicleId);

      if (error) {
        console.error('[VehicleExtras] Error fetching:', error);
        throw error;
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        extra_id: row.extra_id,
        vehicle_id: row.vehicle_id,
        price: Number(row.price),
        extra_name: row.rental_extras?.name || '',
        extra_description: row.rental_extras?.description || null,
        extra_image_urls: row.rental_extras?.image_urls || [],
        extra_is_active: row.rental_extras?.is_active ?? true,
        extra_max_quantity: row.rental_extras?.max_quantity ?? null,
      }));
    },
    enabled: !!tenant?.id && !!vehicleId,
    staleTime: 30 * 1000,
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ extraId, price }: { extraId: string; price: number }) => {
      const { error } = await supabase
        .from('rental_extras_vehicle_pricing')
        .upsert(
          { extra_id: extraId, vehicle_id: vehicleId, price },
          { onConflict: 'extra_id,vehicle_id' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-extras', tenant?.id, vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['rental-extras', tenant?.id] });
      toast({ title: 'Price Updated', description: 'Vehicle extra price has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to update price: ${error.message}`, variant: 'destructive' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (extraId: string) => {
      const { error } = await supabase
        .from('rental_extras_vehicle_pricing')
        .delete()
        .eq('extra_id', extraId)
        .eq('vehicle_id', vehicleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-extras', tenant?.id, vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['rental-extras', tenant?.id] });
      toast({ title: 'Extra Removed', description: 'Vehicle extra has been removed.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: `Failed to remove extra: ${error.message}`, variant: 'destructive' });
    },
  });

  return {
    vehicleExtras: vehicleExtras || [],
    isLoading,
    upsertVehicleExtraPrice: upsertMutation.mutateAsync,
    isUpserting: upsertMutation.isPending,
    removeVehicleExtraPrice: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
  };
};
