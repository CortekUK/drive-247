import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface UseExtensionConflictsParams {
  vehicleId?: string;
  currentEndDate?: string;
  newEndDate?: string;
  excludeRentalId?: string;
}

interface RentalConflict {
  id: string;
  start_date: string;
  end_date: string;
  customerName: string;
}

interface BlockedDateConflict {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
}

export function useExtensionConflicts({
  vehicleId,
  currentEndDate,
  newEndDate,
  excludeRentalId,
}: UseExtensionConflictsParams) {
  const { tenant } = useTenant();

  const enabled = !!tenant?.id && !!vehicleId && !!currentEndDate && !!newEndDate;

  // Extension period: day after current end → new end date
  const extensionStart = currentEndDate || '';
  const extensionEnd = newEndDate || '';

  const rentalConflictsQuery = useQuery({
    queryKey: ['extension-conflicts-rentals', tenant?.id, vehicleId, extensionStart, extensionEnd, excludeRentalId],
    queryFn: async () => {
      let query = supabase
        .from('rentals')
        .select('id, start_date, end_date, customers(name)')
        .eq('vehicle_id', vehicleId!)
        .eq('tenant_id', tenant!.id)
        .in('status', ['Active', 'Confirmed'])
        .lte('start_date', extensionEnd)
        .gte('end_date', extensionStart);

      if (excludeRentalId) {
        query = query.neq('id', excludeRentalId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((r: any) => ({
        id: r.id,
        start_date: r.start_date,
        end_date: r.end_date,
        customerName: r.customers?.name || 'Unknown',
      })) as RentalConflict[];
    },
    enabled,
  });

  const blockedDateConflictsQuery = useQuery({
    queryKey: ['extension-conflicts-blocked', tenant?.id, vehicleId, extensionStart, extensionEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocked_dates')
        .select('id, start_date, end_date, reason, vehicle_id')
        .eq('tenant_id', tenant!.id)
        .lte('start_date', extensionEnd)
        .gte('end_date', extensionStart)
        .or(`vehicle_id.is.null,vehicle_id.eq.${vehicleId}`);

      if (error) throw error;
      return (data || []) as BlockedDateConflict[];
    },
    enabled,
  });

  const rentalConflicts = rentalConflictsQuery.data || [];
  const blockedDateConflicts = blockedDateConflictsQuery.data || [];
  const hasConflicts = rentalConflicts.length > 0 || blockedDateConflicts.length > 0;
  const isChecking = rentalConflictsQuery.isLoading || blockedDateConflictsQuery.isLoading;

  return {
    rentalConflicts,
    blockedDateConflicts,
    hasConflicts,
    isChecking,
  };
}
