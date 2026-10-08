import { useQuery } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useTenant } from '@/contexts/TenantContext';

/** A booking the signed-in customer started on this site and has not finished. */
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

/**
 * The customer's unfinished bookings, for "Continue your booking" in the portal.
 * Read through customer_unfinished_bookings(), which matches on the account's
 * own email and this tenant; the abandoned_bookings table itself stays closed.
 * Failure is quiet: this is a convenience, never a reason for the page to break.
 */
export function useUnfinishedBookings() {
  const { customerUser } = useCustomerAuthStore();
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['customer-unfinished-bookings', tenant?.id, customerUser?.customer_id],
    queryFn: async (): Promise<UnfinishedBooking[]> => {
      const { data, error } = await supabaseUntyped.rpc('customer_unfinished_bookings', { p_tenant_id: tenant!.id });
      if (error) {
        console.warn('Unfinished bookings unavailable:', error.message);
        return [];
      }
      return (data ?? []) as UnfinishedBooking[];
    },
    enabled: !!tenant?.id && !!customerUser?.customer_id,
  });
}
