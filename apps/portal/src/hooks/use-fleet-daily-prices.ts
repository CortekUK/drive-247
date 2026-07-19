import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

/**
 * Fleet-wide per-day pricing for the calendar's Pricing mode.
 * Batch-loads every visible vehicle's base daily rate + any Turo-style manual
 * per-day prices in the visible date range, in two queries (not per-vehicle),
 * and exposes set/clear mutations. Manual prices override base + surcharges for
 * that day (see lib/calculate-rental-price.ts). Same `vehicle_daily_prices`
 * table the booking side reads, so a price set here applies at checkout too.
 */
export const useFleetDailyPrices = (
  vehicleIds: string[],
  rangeStartStr: string,
  rangeEndStr: string
) => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const idsKey = [...vehicleIds].sort().join(',');

  // Base daily rate per vehicle (the default a cell shows when no manual price).
  const baseKey = ['fleet-base-rates', tenant?.id, idsKey];
  const { data: baseRows, isLoading: loadingBase } = useQuery({
    queryKey: baseKey,
    queryFn: async (): Promise<{ id: string; daily_rent: number | null }[]> => {
      if (vehicleIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('vehicles')
        .select('id, daily_rent')
        .in('id', vehicleIds);
      if (error) throw error;
      return data || [];
    },
    enabled: vehicleIds.length > 0,
    staleTime: 60_000,
  });

  // Manual per-day prices for the visible fleet + range.
  const pricesKey = ['fleet-daily-prices', tenant?.id, idsKey, rangeStartStr, rangeEndStr];
  const { data: priceRows, isLoading: loadingPrices } = useQuery({
    queryKey: pricesKey,
    queryFn: async (): Promise<{ vehicle_id: string; date: string; price: number }[]> => {
      if (vehicleIds.length === 0) return [];
      const { data, error } = await (supabase as any)
        .from('vehicle_daily_prices')
        .select('vehicle_id, date, price')
        .in('vehicle_id', vehicleIds)
        .gte('date', rangeStartStr)
        .lte('date', rangeEndStr)
        .limit(5000); // well above fleet×range; avoids the PostgREST default-rows cap
      if (error) throw error;
      return (data || []).map((r: any) => ({ vehicle_id: r.vehicle_id, date: r.date, price: Number(r.price) }));
    },
    enabled: vehicleIds.length > 0 && !!rangeStartStr && !!rangeEndStr,
    staleTime: 30_000,
  });

  const baseRateMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of baseRows || []) m[r.id] = Number(r.daily_rent) || 0;
    return m;
  }, [baseRows]);

  // `${vehicleId}::${date}` -> manual price (only days with an override).
  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of priceRows || []) m[`${r.vehicle_id}::${r.date}`] = r.price;
    return m;
  }, [priceRows]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['fleet-daily-prices'] });
    // Per-vehicle detail card reads its own key — keep it in sync.
    queryClient.invalidateQueries({ queryKey: ['vehicle-daily-prices'] });
  };

  const setPricesMutation = useMutation({
    mutationFn: async ({ vehicleId, entries }: { vehicleId: string; entries: { date: string; price: number }[] }) => {
      if (!vehicleId || entries.length === 0) return;
      const payload = entries.map(e => ({ vehicle_id: vehicleId, date: e.date, price: e.price }));
      const { error } = await (supabase as any)
        .from('vehicle_daily_prices')
        .upsert(payload, { onConflict: 'vehicle_id,date' });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate();
      toast({
        title: 'Prices updated',
        description: vars.entries.length === 1
          ? `Custom price set for ${vars.entries[0].date}.`
          : `Custom price set for ${vars.entries.length} days.`,
      });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const clearPricesMutation = useMutation({
    mutationFn: async ({ vehicleId, dates }: { vehicleId: string; dates: string[] }) => {
      if (!vehicleId || dates.length === 0) return;
      const { error } = await (supabase as any)
        .from('vehicle_daily_prices')
        .delete()
        .eq('vehicle_id', vehicleId)
        .in('date', dates);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate();
      toast({
        title: 'Prices cleared',
        description: vars.dates.length === 1
          ? `${vars.dates[0]} reverts to default pricing.`
          : `${vars.dates.length} days revert to default pricing.`,
      });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  return {
    baseRateMap,
    priceMap,
    isLoading: loadingBase || loadingPrices,
    setPrices: setPricesMutation.mutateAsync,
    isSetting: setPricesMutation.isPending,
    clearPrices: clearPricesMutation.mutateAsync,
    isClearing: clearPricesMutation.isPending,
  };
};
