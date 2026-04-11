import { useQuery } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface PaygAccrual {
  id: string;
  rental_id: string;
  accrual_day_index: number;
  accrual_window_start: string;
  accrual_window_end: string;
  daily_rate: number;
  tax_amount: number;
  service_fee_amount: number;
  is_partial: boolean;
  hours_covered: number;
  created_at: string;
}

export interface PaygLedgerData {
  accruals: PaygAccrual[];
  totalRental: number;
  totalTax: number;
  totalServiceFee: number;
  totalCharged: number;
  totalOutstanding: number;
  daysActive: number;
}

/**
 * Fetches the PAYG daily accrual ledger + outstanding balance for a rental.
 * Only meaningful for rentals where is_pay_as_you_go = true.
 */
export const usePaygLedger = (rentalId: string | undefined, isPayg: boolean) => {
  const { tenant } = useTenant();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['payg-ledger', tenant?.id, rentalId],
    queryFn: async (): Promise<PaygLedgerData> => {
      if (!rentalId || !tenant?.id) {
        return { accruals: [], totalRental: 0, totalTax: 0, totalServiceFee: 0, totalCharged: 0, totalOutstanding: 0, daysActive: 0 };
      }

      // Fetch accruals ordered by day index
      const { data: accruals, error: accrualErr } = await supabaseUntyped
        .from('payg_accruals')
        .select('id, rental_id, accrual_day_index, accrual_window_start, accrual_window_end, daily_rate, tax_amount, service_fee_amount, is_partial, hours_covered, created_at')
        .eq('rental_id', rentalId)
        .eq('tenant_id', tenant.id)
        .order('accrual_day_index', { ascending: true });

      if (accrualErr) throw accrualErr;

      const rows = (accruals || []) as PaygAccrual[];

      // Compute totals from accruals
      let totalRental = 0;
      let totalTax = 0;
      let totalServiceFee = 0;
      for (const row of rows) {
        totalRental += Number(row.daily_rate) || 0;
        totalTax += Number(row.tax_amount) || 0;
        totalServiceFee += Number(row.service_fee_amount) || 0;
      }
      const totalCharged = totalRental + totalTax + totalServiceFee;

      // Fetch outstanding balance from ledger_entries
      const { data: ledgerData, error: ledgerErr } = await supabaseUntyped
        .from('ledger_entries')
        .select('remaining_amount')
        .eq('rental_id', rentalId)
        .eq('type', 'Charge')
        .gt('remaining_amount', 0);

      if (ledgerErr) throw ledgerErr;

      const totalOutstanding = (ledgerData || []).reduce(
        (sum: number, row: any) => sum + (Number(row.remaining_amount) || 0),
        0,
      );

      return {
        accruals: rows,
        totalRental: Math.round(totalRental * 100) / 100,
        totalTax: Math.round(totalTax * 100) / 100,
        totalServiceFee: Math.round(totalServiceFee * 100) / 100,
        totalCharged: Math.round(totalCharged * 100) / 100,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        daysActive: rows.length,
      };
    },
    enabled: !!rentalId && !!tenant?.id && isPayg,
    staleTime: 15_000, // 15s — accruals change every 15min via cron
  });

  return {
    ledger: data || { accruals: [], totalRental: 0, totalTax: 0, totalServiceFee: 0, totalCharged: 0, totalOutstanding: 0, daysActive: 0 },
    isLoading,
    error,
    refetch,
  };
};
