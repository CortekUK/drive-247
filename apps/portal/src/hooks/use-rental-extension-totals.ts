import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

/**
 * Authoritative per-extension totals (Phase 5).
 *
 * Source of truth for: outstanding balance per extension, display status,
 * total charged, paid amount, Bonzah policy status. Reads from the
 * `rental_extension_totals` DB view so every consumer sees the same numbers
 * instead of re-summing ledger entries independently.
 */
export function useRentalExtensionTotals(rentalId: string | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['rental-extension-totals', tenant?.id, rentalId],
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
    enabled: !!tenant && !!rentalId,
  });
}
