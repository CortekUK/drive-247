import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

/**
 * Turo-style per-day, per-vehicle manual prices.
 * A row = an operator-set price for `vehicle_id` on `date` (YYYY-MM-DD).
 * When set, this price overrides the tier rate AND all weekend/holiday
 * surcharges for that day (see calculate-rental-price.ts `dailyPrices`).
 */
export interface VehicleDailyPriceRow {
  id: string;
  vehicle_id: string;
  date: string; // YYYY-MM-DD
  price: number;
  created_at: string;
  updated_at: string;
}

export const useVehicleDailyPrices = (vehicleId?: string) => {
  const queryClient = useQueryClient();
  const queryKey = ['vehicle-daily-prices', vehicleId];

  const { data: prices, isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<VehicleDailyPriceRow[]> => {
      if (!vehicleId) return [];
      const { data, error } = await (supabase as any)
        .from('vehicle_daily_prices')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('date', { ascending: true });
      if (error) throw error;
      // Postgres numeric arrives as a JSON string over PostgREST — coerce so
      // downstream math (and the engine's `dailyPrices`) sees real numbers.
      return ((data || []) as VehicleDailyPriceRow[]).map(r => ({ ...r, price: Number(r.price) }));
    },
    enabled: !!vehicleId,
    staleTime: 30_000,
  });

  // date -> price lookup for O(1) calendar rendering.
  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of prices || []) m[p.date] = Number(p.price);
    return m;
  }, [prices]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    // Keep the fleet calendar's Pricing grid in sync when edited from here.
    queryClient.invalidateQueries({ queryKey: ['fleet-daily-prices'] });
  };

  // Upsert one or many day prices (unique on vehicle_id,date).
  const setPricesMutation = useMutation({
    mutationFn: async (entries: { date: string; price: number }[]) => {
      if (!vehicleId || entries.length === 0) return;
      const payload = entries.map(e => ({
        vehicle_id: vehicleId,
        date: e.date,
        price: e.price,
      }));
      const { error } = await (supabase as any)
        .from('vehicle_daily_prices')
        .upsert(payload, { onConflict: 'vehicle_id,date' });
      if (error) throw error;
    },
    onSuccess: (_d, entries) => {
      invalidate();
      toast({
        title: 'Prices updated',
        description: entries.length === 1
          ? `Custom price set for ${entries[0].date}.`
          : `Custom price set for ${entries.length} days.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  // Clear one or many day prices (revert to default/tier pricing).
  const clearPricesMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      if (!vehicleId || dates.length === 0) return;
      const { error } = await (supabase as any)
        .from('vehicle_daily_prices')
        .delete()
        .eq('vehicle_id', vehicleId)
        .in('date', dates);
      if (error) throw error;
    },
    onSuccess: (_d, dates) => {
      invalidate();
      toast({
        title: 'Prices cleared',
        description: dates.length === 1
          ? `${dates[0]} reverts to default pricing.`
          : `${dates.length} days revert to default pricing.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    prices: prices || [],
    priceMap,
    isLoading,
    error,
    setPrices: setPricesMutation.mutateAsync,
    isSetting: setPricesMutation.isPending,
    clearPrices: clearPricesMutation.mutateAsync,
    isClearing: clearPricesMutation.isPending,
  };
};
