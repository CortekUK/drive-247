'use client';

/**
 * The signed-in customer's saved cards, through the `customer-cards` edge
 * function — list, add (a SetupIntent), make default, remove.
 *
 * The function resolves WHICH customer from the caller's JWT, so nothing here
 * sends a customer id; the tenant id only says which site's account to use.
 * The cards live on the tenant's charge account (the one its bookings and
 * instalment plans charge), which is why a card added here is the card used.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';

export interface CustomerCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  name: string | null;
  isDefault: boolean;
}

export interface CardSetup {
  clientSecret: string;
  publishableKey: string;
  connectAccountId: string | null;
}

const FUNCTION = 'customer-cards';

/** The function's own `error` string (written for the customer) when there is one. */
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCTION, { body });
  if (error) {
    let message = 'We could not reach the card service. Please try again.';
    try {
      const context = (error as { context?: Response }).context;
      const parsed = context ? ((await context.json()) as { error?: unknown }) : null;
      if (parsed && typeof parsed.error === 'string') message = parsed.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return data as T;
}

export function useCustomerCards() {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id ?? null;
  const key = ['customer-cards', tenantId, customerId];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await call<{ cards: CustomerCard[] }>({ action: 'list', tenantId })).cards,
    enabled: !!tenantId && !!customerId,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customer-cards', tenantId] });

  const setDefault = useMutation({
    mutationFn: (paymentMethodId: string) => call({ action: 'set-default', tenantId, paymentMethodId }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (paymentMethodId: string) => call({ action: 'remove', tenantId, paymentMethodId }),
    onSuccess: invalidate,
  });

  const startSetup = () => call<CardSetup>({ action: 'setup', tenantId });

  return {
    cards: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
    setDefault,
    remove,
    startSetup,
  };
}
