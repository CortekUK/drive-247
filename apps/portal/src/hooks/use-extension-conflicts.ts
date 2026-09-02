import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { parseLocalDate } from '@/lib/date-utils';

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

interface BufferConflict {
  rentalId: string;
  start_date: string;
  customerName: string;
  bufferDeadline: string;
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
        .in('status', ['Active', 'Pending'])
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

  // Check if extending would violate buffer time with the next rental
  const bufferMinutes = (tenant as any)?.buffer_time_minutes || 0;
  const bufferConflictQuery = useQuery({
    queryKey: ['extension-conflicts-buffer', tenant?.id, vehicleId, newEndDate, excludeRentalId, bufferMinutes],
    queryFn: async () => {
      if (bufferMinutes <= 0) return [];

      // Find the next rental after the new end date
      const { data, error } = await supabase
        .from('rentals')
        .select('id, start_date, end_date, customers(name)')
        .eq('vehicle_id', vehicleId!)
        .eq('tenant_id', tenant!.id)
        .in('status', ['Active', 'Pending'])
        .gt('start_date', extensionEnd);

      if (error) throw error;
      if (!data?.length) return [];

      const bufferMs = bufferMinutes * 60 * 1000;
      const newEnd = new Date(`${extensionEnd}T23:59:00`);
      const bufferDeadline = new Date(newEnd.getTime() + bufferMs);

      return data
        .filter((r: any) => r.id !== excludeRentalId)
        .filter((r: any) => parseLocalDate(r.start_date) < bufferDeadline)
        .map((r: any) => ({
          rentalId: r.id,
          start_date: r.start_date,
          customerName: (r as any).customers?.name || 'Unknown',
          bufferDeadline: bufferDeadline.toISOString(),
        })) as BufferConflict[];
    },
    enabled: enabled && bufferMinutes > 0,
  });

  const rentalConflicts = rentalConflictsQuery.data || [];
  const bufferConflicts = bufferConflictQuery.data || [];
  const hasConflicts = rentalConflicts.length > 0 || bufferConflicts.length > 0;
  const isChecking = rentalConflictsQuery.isLoading || bufferConflictQuery.isLoading;

  return {
    rentalConflicts,
    bufferConflicts,
    hasConflicts,
    isChecking,
  };
}
