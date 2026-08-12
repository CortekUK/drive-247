'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface StatementCategory {
  category: string;
  /** Underlying ledger category ('Fine', 'Rental', …). `category` is the
   *  display label, which for a fine is its own type. Optional so an
   *  older cached response still type-checks. */
  baseCategory?: string;
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
 * Consolidated Statement of Account for a given customer, across ALL their
 * rentals — the OPERATOR view (customer detail page).
 *
 * Calls the same `get-customer-statement` edge function the customer portal
 * uses, in OPERATOR mode: the function resolves the caller as an app_user from
 * the JWT and only returns the statement if the requested customer belongs to
 * the operator's tenant (cross-tenant reads are rejected server-side). Amounts
 * come from the ledger, not rentals.payment_status.
 */
export function useCustomerStatement(customerId: string | null | undefined, enabled = true) {
  const { tenant } = useTenant();

  return useQuery<StatementData>({
    queryKey: ['customer-statement', tenant?.id, customerId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-customer-statement', {
        body: { tenantId: tenant?.id, customerId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as StatementData;
    },
    enabled: enabled && !!tenant?.id && !!customerId,
    staleTime: 60_000,
  });
}
