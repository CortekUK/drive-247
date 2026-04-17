import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface PaymentAllocation {
  id: string;
  payment_id: string;
  amount_applied: number;
  payment_date: string;
  payment_method: string | null;
  payment_amount: number;
}

export interface RentalCharge {
  id: string;
  entry_date: string;
  due_date: string | null;
  amount: number;
  remaining_amount: number;
  category: string;
  reference: string | null;
  extension_id: string | null;
  allocations: PaymentAllocation[];
  rental_start_date: string | null;
}

export const useRentalCharges = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['rental-charges', tenant?.id, rentalId],
    queryFn: async (): Promise<RentalCharge[]> => {
      if (!rentalId) return [];

      let chargesQuery = supabase
        .from('ledger_entries')
        .select(`*, rentals!rental_id(start_date)`)
        .eq('rental_id', rentalId)
        .eq('type', 'Charge')
        .order('due_date', { ascending: false });

      if (tenant?.id) chargesQuery = chargesQuery.eq('tenant_id', tenant.id);

      const { data: charges, error: chargesError } = await chargesQuery;
      if (chargesError) throw chargesError;

      const chargeIds = (charges || []).map((c) => c.id);
      if (chargeIds.length === 0) return [];

      let applicationsQuery = supabase
        .from('payment_applications')
        .select(`*, payments(payment_date, method, amount, payment_type)`)
        .in('charge_entry_id', chargeIds);

      if (tenant?.id) applicationsQuery = applicationsQuery.eq('tenant_id', tenant.id);

      const { data: applications, error: appError } = await applicationsQuery;
      if (appError) throw appError;

      return (charges || []).map((charge: any) => ({
        id: charge.id,
        entry_date: charge.entry_date,
        due_date: charge.due_date,
        amount: charge.amount,
        remaining_amount: charge.remaining_amount,
        category: charge.category,
        reference: charge.reference || null,
        extension_id: charge.extension_id || null,
        rental_start_date: charge.rentals?.start_date || null,
        allocations: (applications || [])
          .filter((app: any) => app.charge_entry_id === charge.id)
          .map((app: any) => ({
            id: app.id,
            payment_id: app.payment_id,
            amount_applied: app.amount_applied,
            payment_date: app.payments.payment_date,
            payment_method: app.payments.method,
            payment_amount: app.payments.amount,
          })),
      }));
    },
    enabled: !!tenant && !!rentalId,
  });
};
