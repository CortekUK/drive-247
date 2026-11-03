'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@nw/integrations/supabase/client';

export type SecondaryDriverStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface SecondaryDriver {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  verification_status: SecondaryDriverStatus;
  link_expired: boolean;
}

interface SecondaryDriverState {
  can_manage: boolean;
  drivers: SecondaryDriver[];
  email_sent?: boolean;
}

export interface SecondaryDriverInput {
  name: string;
  email: string;
  phone: string;
}

/** The notice both Northwind portals show, so the wording cannot drift between them. */
export const SECONDARY_DRIVER_NOTICE =
  'The agreement and insurance cover the primary driver only. A secondary driver is not authorized to drive this vehicle under the agreement.';

async function call(body: Record<string, unknown>): Promise<SecondaryDriverState> {
  const { data, error } = await supabase.functions.invoke('customer-secondary-driver', { body });
  if (error) throw new Error('We could not reach the server. Please try again.');
  if (!data?.success) throw new Error(data?.error || 'Something went wrong. Please try again.');
  return data as SecondaryDriverState;
}

/** A renter's secondary driver. Everything goes through the edge function, which checks ownership. */
export function useSecondaryDriver(rentalId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['customer-secondary-driver', rentalId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => call({ action: 'list', rental_id: rentalId }),
    refetchOnWindowFocus: true,
    // The driver verifies on their own device, so watch for the result.
    refetchInterval: (q) =>
      q.state.data?.drivers.some((d) => d.verification_status === 'pending') ? 15000 : false,
  });

  const onSuccess = (state: SecondaryDriverState) => {
    queryClient.setQueryData(queryKey, state);
  };

  const add = useMutation({
    mutationFn: (input: SecondaryDriverInput) => call({ action: 'add', rental_id: rentalId, ...input }),
    onSuccess,
  });
  const resend = useMutation({
    mutationFn: (driverId: string) => call({ action: 'resend', rental_id: rentalId, driver_id: driverId }),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: (driverId: string) => call({ action: 'remove', rental_id: rentalId, driver_id: driverId }),
    onSuccess,
  });

  return {
    canManage: query.data?.can_manage === true,
    drivers: query.data?.drivers ?? [],
    add,
    resend,
    remove,
  };
}
