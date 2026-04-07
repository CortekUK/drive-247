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
        .in('status', ['Active', 'Pending'])
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

  // Check if extending would violate buffer time with the next rental
  const bufferMinutes = (tenant as any)?.buffer_time_minutes || 0;
  const bufferConflictQuery = useQuery({
    queryKey: ['extension-conflicts-buffer', tenant?.id, vehicleId, extensionEnd, excludeRentalId, bufferMinutes],
    queryFn: async () => {
      if (bufferMinutes <= 0) return 0;

      const { data, error } = await supabase
        .from('rentals')
        .select('id, start_date')
        .eq('vehicle_id', vehicleId!)
        .eq('tenant_id', tenant!.id)
        .in('status', ['Active', 'Pending'])
        .gt('start_date', extensionEnd);

      if (error) throw error;
      if (!data?.length) return 0;

      const bufferMs = bufferMinutes * 60 * 1000;
      const newEnd = new Date(`${extensionEnd}T23:59:00`);
      const bufferDeadline = new Date(newEnd.getTime() + bufferMs);

      return data
        .filter(r => r.id !== excludeRentalId)
        .filter(r => new Date(r.start_date) < bufferDeadline)
        .length;
    },
    enabled: enabled && bufferMinutes > 0,
  });

  const conflictCount = (rentalConflictsQuery.data || 0) + (blockedDateConflictsQuery.data || 0) + (bufferConflictQuery.data || 0);
  const hasConflicts = conflictCount > 0;
  const isChecking = rentalConflictsQuery.isLoading || blockedDateConflictsQuery.isLoading || bufferConflictQuery.isLoading;

  return {
    hasConflicts,
    conflictCount,
    isChecking,
  };
}
