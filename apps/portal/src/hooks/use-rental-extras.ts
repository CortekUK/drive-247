import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface VehiclePricing {
  id: string;
  vehicle_id: string;
  price: number;
  vehicle_reg?: string;
  vehicle_make?: string;
  vehicle_model?: string;
}

export interface RentalExtra {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price: number;
  pricing_type: 'global' | 'per_vehicle';
  image_urls: string[];
  is_active: boolean;
  max_quantity: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Computed: total quantity booked across all rentals */
  booked_quantity: number;
  /** Computed: remaining stock (max_quantity - booked). null for toggle extras */
  remaining_stock: number | null;
  /** Computed: per-vehicle pricing rows (only for per_vehicle extras) */
  vehicle_pricing: VehiclePricing[];
}

export interface CreateRentalExtraInput {
  name: string;
  description?: string | null;
  price: number;
  pricing_type?: 'global' | 'per_vehicle';
  vehicle_pricing?: { vehicle_id: string; price: number }[];
  image_urls?: string[];
  is_active?: boolean;
  max_quantity?: number | null;
  sort_order?: number;
}

export interface UpdateRentalExtraInput {
  id: string;
  name?: string;
  description?: string | null;
  price?: number;
  pricing_type?: 'global' | 'per_vehicle';
  vehicle_pricing?: { vehicle_id: string; price: number }[];
  image_urls?: string[];
  is_active?: boolean;
  max_quantity?: number | null;
  sort_order?: number;
}

export const useRentalExtras = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const {
    data: extras,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['rental-extras', tenant?.id],
    queryFn: async (): Promise<RentalExtra[]> => {
      if (!tenant?.id) return [];

      // Fetch extras
      const { data, error } = await supabase
        .from('rental_extras')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('[RentalExtras] Error fetching extras:', error);
        throw error;
      }

      // Fetch booked quantities for quantity-based extras
      const quantityExtras = (data || []).filter((e: any) => e.max_quantity !== null);
      let bookedMap: Record<string, number> = {};

      if (quantityExtras.length > 0) {
        const { data: selections } = await supabase
          .from('rental_extras_selections')
          .select('extra_id, quantity')
          .in('extra_id', quantityExtras.map((e: any) => e.id));

        if (selections) {
          for (const sel of selections) {
            bookedMap[sel.extra_id] = (bookedMap[sel.extra_id] || 0) + sel.quantity;
          }
        }
      }

      // Fetch vehicle pricing for per_vehicle extras
      const perVehicleExtras = (data || []).filter((e: any) => e.pricing_type === 'per_vehicle');
      let vehiclePricingMap: Record<string, VehiclePricing[]> = {};

      if (perVehicleExtras.length > 0) {
        const { data: pricingRows } = await supabase
          .from('rental_extras_vehicle_pricing')
          .select('id, extra_id, vehicle_id, price, vehicles(reg, make, model)')
          .in('extra_id', perVehicleExtras.map((e: any) => e.id));

        if (pricingRows) {
          for (const row of pricingRows as any[]) {
            if (!vehiclePricingMap[row.extra_id]) {
              vehiclePricingMap[row.extra_id] = [];
            }
            vehiclePricingMap[row.extra_id].push({
              id: row.id,
              vehicle_id: row.vehicle_id,
              price: Number(row.price),
              vehicle_reg: row.vehicles?.reg,
              vehicle_make: row.vehicles?.make,
              vehicle_model: row.vehicles?.model,
            });
          }
        }
      }

      return (data || []).map((extra: any) => ({
        ...extra,
        image_urls: extra.image_urls || [],
        booked_quantity: bookedMap[extra.id] || 0,
        remaining_stock: extra.max_quantity !== null
          ? Math.max(0, extra.max_quantity - (bookedMap[extra.id] || 0))
          : null,
        vehicle_pricing: vehiclePricingMap[extra.id] || [],
      })) as RentalExtra[];
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
  });

  const createExtraMutation = useMutation({
    mutationFn: async (input: CreateRentalExtraInput): Promise<RentalExtra> => {
      if (!tenant?.id) throw new Error('No tenant ID available');

      const { data, error } = await supabase
        .from('rental_extras')
        .insert({
          tenant_id: tenant.id,
          name: input.name,
          description: input.description ?? null,
          price: input.price,
          pricing_type: input.pricing_type ?? 'global',
          image_urls: input.image_urls ?? [],
          is_active: input.is_active ?? true,
          max_quantity: input.max_quantity ?? null,
          sort_order: input.sort_order ?? (extras?.length || 0),
        })
        .select()
        .single();

      if (error) {
        console.error('[RentalExtras] Create error:', error);
        throw error;
      }

      // Insert vehicle pricing rows if per_vehicle
      if (input.pricing_type === 'per_vehicle' && input.vehicle_pricing?.length) {
        const { error: vpError } = await supabase
          .from('rental_extras_vehicle_pricing')
          .insert(
            input.vehicle_pricing.map((vp) => ({
              extra_id: data.id,
              vehicle_id: vp.vehicle_id,
              price: vp.price,
            }))
          );
        if (vpError) {
          console.error('[RentalExtras] Vehicle pricing insert error:', vpError);
        }
      }

      return data as RentalExtra;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rental-extras', tenant?.id] });
      toast({
        title: 'Extra Added',
        description: 'New rental extra has been added successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message.includes('unique')
          ? 'An extra with this name already exists.'
          : `Failed to add extra: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const updateExtraMutation = useMutation({
    mutationFn: async (input: UpdateRentalExtraInput): Promise<RentalExtra> => {
      const { id, vehicle_pricing, ...updates } = input;

      const { data, error } = await supabase
        .from('rental_extras')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[RentalExtras] Update error:', error);
        throw error;
      }

      // If vehicle_pricing is provided, replace all rows
      if (vehicle_pricing !== undefined) {
        // Delete existing rows
        await supabase
          .from('rental_extras_vehicle_pricing')
          .delete()
          .eq('extra_id', id);

        // Insert new rows if per_vehicle
        if (updates.pricing_type === 'per_vehicle' && vehicle_pricing.length > 0) {
          const { error: vpError } = await supabase
            .from('rental_extras_vehicle_pricing')
            .insert(
              vehicle_pricing.map((vp) => ({
                extra_id: id,
                vehicle_id: vp.vehicle_id,
                price: vp.price,
              }))
            );
          if (vpError) {
            console.error('[RentalExtras] Vehicle pricing update error:', vpError);
          }
        }
      }

      return data as RentalExtra;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rental-extras', tenant?.id] });
      toast({
        title: 'Extra Updated',
        description: 'Rental extra has been updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message.includes('unique')
          ? 'An extra with this name already exists.'
          : `Failed to update extra: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  const deleteExtraMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('rental_extras')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[RentalExtras] Delete error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rental-extras', tenant?.id] });
      toast({
        title: 'Extra Deleted',
        description: 'Rental extra has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to delete extra: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  return {
    extras: extras || [],
    activeExtras: (extras || []).filter((e) => e.is_active),
    isLoading,
    error,
    createExtra: createExtraMutation.mutateAsync,
    isCreating: createExtraMutation.isPending,
    updateExtra: updateExtraMutation.mutateAsync,
    isUpdating: updateExtraMutation.isPending,
    deleteExtra: deleteExtraMutation.mutateAsync,
    isDeleting: deleteExtraMutation.isPending,
  };
};
