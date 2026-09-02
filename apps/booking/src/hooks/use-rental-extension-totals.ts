import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Authoritative per-extension totals (Phase 5).
 *
 * Source of truth for: outstanding balance per extension, display status,
 * total charged, paid amount, Bonzah policy status. Reads from the
 * `rental_extension_totals` DB view so every app sees the same numbers
 * instead of re-summing ledger entries independently.
 */
export function useRentalExtensionTotals(rentalId: string | undefined) {
  return useQuery({
    queryKey: ['rental-extension-totals', rentalId],
    queryFn: async () => {
      if (!rentalId) return [];
      const { data, error } = await supabase
        .from('rental_extension_totals')
        .select('*')
        .eq('rental_id', rentalId)
        .order('sequence_number', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!rentalId,
  });
}

/**
 * Aggregated outstanding across all extensions on a rental.
 * Pending-approval rows are excluded (customer can't pay those yet).
 */
export function sumExtensionOutstanding(
  rows: { outstanding_amount: number | string | null; display_status: string | null }[] | undefined | null,
) {
  if (!rows) return 0;
  return rows
    .filter((r) => r.display_status !== 'pending_approval' && r.display_status !== 'cancelled' && r.display_status !== 'refunded')
    .reduce((sum, r) => sum + Number(r.outstanding_amount || 0), 0);
}
