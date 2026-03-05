import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface UseExtensionConflictsParams {
  vehicleId?: string;
  currentEndDate?: string;
  newEndDate?: string;
  excludeRentalId?: string;
}

export function useExtensionConflicts({
  vehicleId,
  currentEndDate,
  newEndDate,
  excludeRentalId,
}: UseExtensionConflictsParams) {
  const { tenant } = useTenant();

  const enabled = !!tenant?.id && !!vehicleId && !!currentEndDate && !!newEndDate;

  const extensionStart = currentEndDate || '';
  const extensionEnd = newEndDate || '';

  const rentalConflictsQuery = useQuery({
    queryKey: ['extension-conflicts-rentals', tenant?.id, vehicleId, extensionStart, extensionEnd, excludeRentalId],
    queryFn: async () => {
      let query = supabase
        .from('rentals')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId!)
        .eq('tenant_id', tenant!.id)
        .in('status', ['Active', 'Confirmed'])
        .lte('start_date', extensionEnd)
        .gte('end_date', extensionStart);

      if (excludeRentalId) {
        query = query.neq('id', excludeRentalId);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    enabled,
  });

  const blockedDateConflictsQuery = useQuery({
    queryKey: ['extension-conflicts-blocked', tenant?.id, vehicleId, extensionStart, extensionEnd],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('blocked_dates')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id)
        .lte('start_date', extensionEnd)
        .gte('end_date', extensionStart)
        .or(`vehicle_id.is.null,vehicle_id.eq.${vehicleId}`);

      if (error) throw error;
      return count || 0;
    },
    enabled,
  });

  const conflictCount = (rentalConflictsQuery.data || 0) + (blockedDateConflictsQuery.data || 0);
  const hasConflicts = conflictCount > 0;
  const isChecking = rentalConflictsQuery.isLoading || blockedDateConflictsQuery.isLoading;

  return {
    hasConflicts,
    conflictCount,
    isChecking,
  };
}
