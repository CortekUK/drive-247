import type { SupabaseClient } from '@supabase/supabase-js';

export interface RentalConflict {
  id: string;
  start_date: string;
  // null when the conflicting rental is open-ended (PAYG). Display layer should render as "Ongoing".
  end_date: string | null;
  status: string;
  customerName: string;
  is_pay_as_you_go?: boolean;
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
  // Query 1: Check for overlapping Pending/Active rentals on the same vehicle.
  // Open-ended PAYG rentals (end_date IS NULL) are also detected via the OR clause —
  // they occupy the vehicle until explicitly closed via finalize-payg-rental.
  let rentalQuery = supabase
    .from('rentals')
    .select('id, start_date, end_date, status, is_pay_as_you_go, payg_closed_at, customers(name)')
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

  // Filter out PAYG rentals that have been closed (defensive — payg_closed_at being set
  // means the rental is no longer occupying the vehicle even if status hasn't propagated yet).
  const rentalConflicts: RentalConflict[] = (rentalData || [])
    .filter((r: any) => !(r.is_pay_as_you_go && r.payg_closed_at))
    .map((r: any) => ({
      id: r.id,
      start_date: r.start_date,
      end_date: r.end_date,
      status: r.status,
      customerName: r.customers?.name || 'Unknown',
      is_pay_as_you_go: r.is_pay_as_you_go === true,
    }));

  return {
    rentalConflicts,
    hasConflicts: rentalConflicts.length > 0,
  };
}
