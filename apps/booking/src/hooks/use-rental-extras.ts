import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface RentalExtra {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_urls: string[];
  max_quantity: number | null;
  /** Computed: remaining stock for quantity-based extras */
  remaining_stock: number | null;
}

export const useRentalExtras = () => {
  const { tenant } = useTenant();

  const {
    data: extras,
    isLoading,
  } = useQuery({
    queryKey: ['rental-extras', tenant?.id],
    queryFn: async (): Promise<RentalExtra[]> => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('rental_extras')
        .select('id, name, description, price, image_urls, max_quantity')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
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

      return (data || []).map((extra: any) => ({
        ...extra,
        image_urls: extra.image_urls || [],
        remaining_stock: extra.max_quantity !== null
          ? Math.max(0, extra.max_quantity - (bookedMap[extra.id] || 0))
          : null,
      })) as RentalExtra[];
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
  });

  return {
    extras: extras || [],
    isLoading,
  };
};
