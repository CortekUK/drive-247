import type { SupabaseClient } from '@supabase/supabase-js';

export interface RentalConflict {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  customerName: string;
}

export interface ConflictResult {
  rentalConflicts: RentalConflict[];
  hasConflicts: boolean;
}

/**
 * Imperatively check for vehicle rental conflicts before creating a new rental.
 * Returns detailed conflict info for the conflict resolution dialog.
 */
export async function checkRentalConflicts(
  supabase: SupabaseClient,
  tenantId: string,
  vehicleId: string,
  startDate: string,
  endDate: string,
  excludeRentalId?: string,
): Promise<ConflictResult> {
  // Query 1: Check for overlapping Pending/Active rentals on the same vehicle
  let rentalQuery = supabase
    .from('rentals')
    .select('id, start_date, end_date, status, customers(name)')
    .eq('vehicle_id', vehicleId)
    .eq('tenant_id', tenantId)
    .in('status', ['Pending', 'Active'])
    .lte('start_date', endDate)
    .or(`end_date.gte.${startDate},end_date.is.null`);

  if (excludeRentalId) {
    rentalQuery = rentalQuery.neq('id', excludeRentalId);
  }

  const { data: rentalData, error: rentalError } = await rentalQuery;
  if (rentalError) throw rentalError;

  const rentalConflicts: RentalConflict[] = (rentalData || []).map((r: any) => ({
    id: r.id,
    start_date: r.start_date,
    end_date: r.end_date,
    status: r.status,
    customerName: r.customers?.name || 'Unknown',
  }));

  return {
    rentalConflicts,
    hasConflicts: rentalConflicts.length > 0,
  };
}
