import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Read-only customer view of an auto-extension (weekly billing) rental.
 *
 * Returns the rental's `auto_extend_*` configuration plus the per-period rows
 * from the `rental_extension_totals` DB view — the exact same source of truth
 * the admin/portal side reads, so the customer sees a fully synced schedule.
 *
 * RLS lets a customer read their own rental + its extensions.
 */

export interface AutoExtendRental {
  id: string;
  start_date: string | null;
  end_date: string | null;
  original_end_date: string | null;
  monthly_amount: number | null;
  auto_extend_enabled: boolean | null;
  auto_extend_charge_mode: 'pay_link' | 'auto_charge' | null;
  auto_extend_period_unit: 'Daily' | 'Weekly' | 'Monthly' | null;
  auto_extend_next_charge_at: string | null;
  auto_extend_status: 'active' | 'awaiting_payment' | 'paused' | 'ended' | null;
  auto_extend_charge_count: number | null;
  auto_extend_paused: boolean | null;
}

export interface ExtensionTotalRow {
  id: string;
  rental_id: string;
  sequence_number: number;
  previous_end_date: string | null;
  new_end_date: string | null;
  total_amount: number | string | null;
  paid_amount: number | string | null;
  outstanding_amount: number | string | null;
  display_status:
    | 'paid'
    | 'awaiting_payment'
    | 'partial'
    | 'cancelled'
    | 'refunded'
    | 'pending_approval'
    | null;
  checkout_url: string | null;
  stripe_checkout_session_id: string | null;
  created_at: string | null;
  paid_at: string | null;
}

export interface CustomerAutoExtension {
  rental: AutoExtendRental | null;
  extensions: ExtensionTotalRow[];
}

export function useCustomerAutoExtension(rentalId: string | undefined) {
  return useQuery<CustomerAutoExtension>({
    queryKey: ['customer-auto-extension', rentalId],
    queryFn: async () => {
      if (!rentalId) return { rental: null, extensions: [] };

      const [rentalRes, extensionsRes] = await Promise.all([
        (supabase as any)
          .from('rentals')
          .select(
            `id, start_date, end_date, original_end_date, monthly_amount,
             auto_extend_enabled, auto_extend_charge_mode, auto_extend_period_unit,
             auto_extend_next_charge_at, auto_extend_status, auto_extend_charge_count,
             auto_extend_paused`
          )
          .eq('id', rentalId)
          .single(),
        (supabase as any)
          .from('rental_extension_totals')
          .select('*')
          .eq('rental_id', rentalId)
          .order('sequence_number', { ascending: true }),
      ]);

      if (rentalRes.error) throw rentalRes.error;

      return {
        rental: (rentalRes.data as AutoExtendRental) ?? null,
        extensions: (extensionsRes.data as ExtensionTotalRow[]) ?? [],
      };
    },
    enabled: !!rentalId,
  });
}
