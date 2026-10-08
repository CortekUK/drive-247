/**
 * The customer's unfinished bookings, for "Continue your booking" on the
 * portal's bookings page — the V2 twin of src/hooks/use-unfinished-bookings.ts,
 * keyed off this site's own auth and tenant reads.
 *
 * Read through customer_unfinished_bookings(), which matches on the account's
 * own email and this tenant; the abandoned_bookings table itself stays closed.
 * Failure is quiet: this is a convenience, never a reason for the page to break.
 */

import { useQuery } from '@tanstack/react-query';

import { supabase } from '@nw/integrations/supabase/client';
import { useCustomer } from '@nw/hooks/use-customer';
import { useTenant } from '@nw/contexts/TenantContext';

export interface UnfinishedBooking {
  id: string;
  site: 'v1' | 'v2';
  stage: string;
  vehicle_id: string | null;
  vehicle_name: string | null;
  pickup_date: string | null;
  dropoff_date: string | null;
  last_activity_at: string;
  /** Opens the booking where they left it — the recovery email's ?resume= link. */
  resume_path: string;
}

export function useUnfinishedBookings() {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  return useQuery({
    queryKey: ['customer-unfinished-bookings', tenantId, customerId],
    queryFn: async (): Promise<UnfinishedBooking[]> => {
      // Not in the generated types yet; the call is the same either way.
      const { data, error } = await (supabase as any).rpc('customer_unfinished_bookings', {
        p_tenant_id: tenantId,
      });
      if (error) {
        console.warn('Unfinished bookings unavailable:', error.message);
        return [];
      }
      return (data ?? []) as UnfinishedBooking[];
    },
    enabled: !!tenantId && !!customerId,
  });
}
