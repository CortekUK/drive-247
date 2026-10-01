'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { usePendingBookings } from '@/hooks/use-pending-bookings';

/**
 * What customers are waiting on the operator for, for the "Requests" card on
 * the v2 dashboard (Sep 27 2026). The lean set, as agreed with Ghulam:
 *
 *   booking       a website booking whose card hold is waiting for approval —
 *                 the same source as the Pending bookings page, via its own
 *                 hook, so the two can never disagree
 *   extension     `rentals.is_extended = true` — the customer asked to extend;
 *                 `previous_end_date` carries the date they asked for (see
 *                 ExtendRentalDialog in the booking app)
 *   cancellation  `rentals.cancellation_requested = true`
 *
 * The extension and cancellation predicates are exactly the ones the rentals
 * list's request chips use (rentals-request-chips.tsx), so a count here and a
 * count there agree.
 *
 * TENANT ISOLATION: RLS is OFF on `rentals` (V2_PLAN §5). The query below
 * carries `.eq('tenant_id', tenant.id)` and is `enabled` only once a tenant is
 * resolved. Do not remove either.
 */

export type RequestKind = 'booking' | 'extension' | 'cancellation';

export interface CustomerRequest {
  id: string;
  kind: RequestKind;
  customerId: string | null;
  customerName: string;
  /** The customer's own photo, when they have one (rare: 2 of 629 today). */
  photoUrl: string | null;
  vehicleName: string;
  /** When it came in (or last changed), for "2h ago". */
  at: string | null;
  /** Booking: the dates wanted. Extension: the new end date. */
  from?: string | null;
  to?: string | null;
  /** Cancellation: the customer's reason, when they gave one. */
  reason?: string | null;
  href: string;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function carName(v: any): string {
  return [v?.make, v?.model].filter(Boolean).join(' ') || v?.reg || 'a car';
}

export function useCustomerRequests() {
  const { tenant } = useTenant();
  const bookings = usePendingBookings();

  const rentals = useQuery({
    queryKey: ['customer-requests', tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<CustomerRequest[]> => {
      const { data, error } = await supabaseUntyped
        .from('rentals')
        .select(
          'id, is_extended, cancellation_requested, cancellation_reason, end_date, previous_end_date, updated_at, ' +
            'customers!rentals_customer_id_fkey!inner(id, name, profile_photo_url), vehicles!rentals_vehicle_id_fkey!inner(reg, make, model)'
        )
        .eq('tenant_id', tenant!.id)
        .or('is_extended.eq.true,cancellation_requested.eq.true')
        .order('updated_at', { ascending: false })
        .limit(40);
      if (error) throw error;

      const out: CustomerRequest[] = [];
      for (const r of (data || []) as any[]) {
        const c = one<any>(r.customers);
        const base = {
          customerId: c?.id ?? null,
          customerName: c?.name || 'A customer',
          photoUrl: c?.profile_photo_url ?? null,
          vehicleName: carName(one<any>(r.vehicles)),
          at: r.updated_at ?? null,
          href: `/rentals/${r.id}`,
        };
        if (r.cancellation_requested) {
          out.push({ ...base, id: `cancel-${r.id}`, kind: 'cancellation', reason: r.cancellation_reason ?? null });
        }
        if (r.is_extended) {
          out.push({ ...base, id: `extend-${r.id}`, kind: 'extension', from: r.end_date, to: r.previous_end_date ?? null });
        }
      }
      return out;
    },
  });

  const bookingRequests: CustomerRequest[] = (bookings.data ?? []).map((b) => ({
    id: `booking-${b.id}`,
    kind: 'booking',
    customerId: b.customer?.id ?? b.customer_id ?? null,
    customerName: b.customer?.name || 'A customer',
    photoUrl: null,
    vehicleName: carName(b.vehicle),
    at: b.created_at,
    from: b.rental?.start_date ?? null,
    to: b.rental?.end_date ?? null,
    href: '/pending-bookings',
  }));

  // Newest first across all three kinds.
  const requests = [...bookingRequests, ...(rentals.data ?? [])].sort((a, b) =>
    (b.at ?? '').localeCompare(a.at ?? '')
  );

  return {
    requests,
    isLoading: bookings.isLoading || rentals.isLoading,
    isError: bookings.isError && rentals.isError,
  };
}
