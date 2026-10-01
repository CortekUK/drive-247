'use client';

import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, subMonths } from 'date-fns';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

/**
 * The data behind the two sections under the fold of the v2 dashboard
 * (Sep 27 2026): the busy-days heatmap and where bookings come from.
 *
 * TENANT ISOLATION: RLS is OFF on `rentals`, `vehicles` and `payments`
 * (V2_PLAN §5). Every query below carries `.eq('tenant_id', tenant.id)` and
 * the hooks are `enabled` only once a tenant is resolved.
 */

// ── Busy days ───────────────────────────────────────────────────────────────

export interface BusyDay {
  /** yyyy-MM-dd */
  date: string;
  /** Cars out on rent that day. */
  rented: number;
}

export interface BusyDays {
  /** Every day from the first of the month two months back, to today. */
  days: BusyDay[];
  /** Cars in the fleet (not disposed), the denominator for every day. */
  fleet: number;
  today: string;
}

/** The first day the heatmap shows: the 1st of the month, two months back. */
export function busyWindowStart(now = new Date()): Date {
  return startOfMonth(subMonths(now, 2));
}

export function useBusyDays() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['busy-days', tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BusyDays> => {
      const now = new Date();
      const from = format(busyWindowStart(now), 'yyyy-MM-dd');
      const today = format(now, 'yyyy-MM-dd');

      const [fleet, rentals] = await Promise.all([
        supabaseUntyped
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .neq('status', 'Disposed'),
        supabaseUntyped
          .from('rentals')
          .select('vehicle_id, start_date, end_date')
          .eq('tenant_id', tenant!.id)
          .neq('status', 'Cancelled')
          .lte('start_date', today)
          .gte('end_date', from)
          .limit(5000),
      ]);
      if (fleet.error) throw fleet.error;
      if (rentals.error) throw rentals.error;

      // One set of cars per day, so two rentals on one car count once.
      const perDay = new Map<string, Set<string>>();
      for (const r of (rentals.data || []) as any[]) {
        if (!r.start_date || !r.end_date) continue;
        const start = r.start_date < from ? from : r.start_date;
        const end = r.end_date > today ? today : r.end_date;
        for (let d = new Date(`${start}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
          const key = d.toISOString().slice(0, 10);
          if (key > end) break;
          if (!perDay.has(key)) perDay.set(key, new Set());
          perDay.get(key)!.add(r.vehicle_id ?? `${key}-${Math.random()}`);
        }
      }

      const days: BusyDay[] = [];
      for (let d = new Date(`${from}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (key > today) break;
        days.push({ date: key, rented: perDay.get(key)?.size ?? 0 });
      }
      return { days, fleet: fleet.count ?? 0, today };
    },
  });
}

// ── Booking sources ─────────────────────────────────────────────────────────

export type BookingSource = 'website' | 'team' | 'turo';

export interface BookingSources {
  counts: Record<BookingSource, number>;
  /** How far back the counts go. */
  days: number;
}

export const SOURCE_WINDOW_DAYS = 90;

/**
 * Where each booking of the last 90 days came from. As the data can tell it:
 *   turo     `rentals.source = 'turo_import'` or a Turo reservation id
 *   website  a payment on it marked `booking_source = 'website'`
 *   team     everything else — added in the portal (phone, walk-in); the data
 *            cannot tell those two apart, so they are one slice
 */
export function useBookingSources() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['booking-sources', tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BookingSources> => {
      const since = new Date(Date.now() - SOURCE_WINDOW_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabaseUntyped
        .from('rentals')
        .select('id, source, turo_reservation_id, payments(booking_source)')
        .eq('tenant_id', tenant!.id)
        .neq('status', 'Cancelled')
        .gte('created_at', since)
        .limit(5000);
      if (error) throw error;

      const counts: Record<BookingSource, number> = { website: 0, team: 0, turo: 0 };
      for (const r of (data || []) as any[]) {
        if (r.source === 'turo_import' || r.turo_reservation_id) counts.turo += 1;
        else if ((r.payments || []).some((p: any) => p.booking_source === 'website')) counts.website += 1;
        else counts.team += 1;
      }
      return { counts, days: SOURCE_WINDOW_DAYS };
    },
  });
}
