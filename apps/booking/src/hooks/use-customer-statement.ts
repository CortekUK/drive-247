'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useTenant } from '@/contexts/TenantContext';

export interface StatementCategory {
  category: string;
  charged: number;
  paid: number;
  outstanding: number;
}

export interface StatementGroup {
  rentalId: string | null;
  rentalNumber: string;
  startDate: string | null;
  endDate: string | null;
  vehicle: { make: string | null; model: string | null; reg: string | null };
  categories: StatementCategory[];
  charged: number;
  paid: number;
  outstanding: number;
  refunds: number;
}

export interface StatementData {
  customer: { name: string; email: string; phone: string };
  groups: StatementGroup[];
  grand: {
    charged: number;
    paid: number;
    outstanding: number;
    refunds: number;
    tax: number;
    fines: number;
  };
  generatedAt: string;
}

/**
 * Consolidated Statement of Account for the logged-in customer, across ALL
 * their rentals in the current tenant.
 *
 * Data comes from the `get-customer-statement` edge function, which resolves
 * the customer from the JWT server-side — the client never passes a customer_id
 * (RLS is off on the ledger, so a client-side filter would not be a real
 * boundary). Amounts are computed from the ledger (remaining_amount), which is
 * the authoritative balance — not rentals.payment_status.
 */
export function useCustomerStatement(enabled = true) {
  const { customerUser } = useCustomerAuthStore();
  const { tenant } = useTenant();

  return useQuery<StatementData>({
    queryKey: ['customer-statement', tenant?.id, customerUser?.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-customer-statement', {
        body: { tenantId: tenant?.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as StatementData;
    },
    enabled: enabled && !!tenant?.id && !!customerUser?.customer_id,
    staleTime: 60_000,
  });
}
