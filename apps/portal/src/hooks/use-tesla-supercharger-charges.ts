import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface SuperchargerCharge {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  rental_id: string | null;
  charge_date: string;
  location: string | null;
  kwh_used: number | null;
  amount: number;
  currency: string;
  tesla_charge_id: string | null;
  status: 'pending' | 'charged' | 'waived' | 'partially_charged';
  charged_amount: number | null;
  ledger_entry_id: string | null;
  created_at: string;
}

export function useTeslaSuperchargerCharges(rentalId: string | undefined) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['tesla-supercharger-charges', tenant?.id, rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tesla_supercharger_charges')
        .select('*')
        .eq('rental_id', rentalId!)
        .order('charge_date', { ascending: false });

      if (error) throw error;
      return (data || []) as SuperchargerCharge[];
    },
    enabled: !!tenant?.id && !!rentalId,
  });

  const charges = query.data || [];
  const totalAmount = charges.reduce((sum, c) => sum + Number(c.amount), 0);
  const totalCharged = charges
    .filter(c => c.status === 'charged')
    .reduce((sum, c) => sum + Number(c.charged_amount || c.amount), 0);
  const chargeCount = charges.length;
  const pendingCount = charges.filter(c => c.status === 'pending').length;

  // Waive a charge
  const waiveCharge = useMutation({
    mutationFn: async (chargeId: string) => {
      const { error } = await supabase
        .from('tesla_supercharger_charges')
        .update({ status: 'waived', charged_amount: 0 })
        .eq('id', chargeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-supercharger-charges', tenant?.id, rentalId] });
    },
  });

  // Mark a charge as billed (after payment is recorded)
  const markCharged = useMutation({
    mutationFn: async ({ chargeId, chargedAmount }: { chargeId: string; chargedAmount: number }) => {
      const { error } = await supabase
        .from('tesla_supercharger_charges')
        .update({ status: 'charged', charged_amount: chargedAmount })
        .eq('id', chargeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-supercharger-charges', tenant?.id, rentalId] });
    },
  });

  // Sync/refresh charges from Tesla
  const syncCharges = useMutation({
    mutationFn: async (vehicleId?: string) => {
      const { data, error } = await supabase.functions.invoke('sync-tesla-charges', {
        body: { rentalId, vehicleId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-supercharger-charges', tenant?.id, rentalId] });
    },
  });

  return {
    charges,
    totalAmount,
    totalCharged,
    chargeCount,
    pendingCount,
    isLoading: query.isLoading,
    waiveCharge,
    markCharged,
    syncCharges,
    refetch: query.refetch,
  };
}
