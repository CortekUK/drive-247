"use client";

import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

/**
 * "Booking on hold" while the operator's Drive247 subscription is paused
 * (portal Billing → Pause, 1 or 2 months).
 *
 * The rest of the site stays up: visitors can still read about the operator,
 * and existing customers can still sign in and pay what they owe. What stops
 * is NEW reservations:
 *   - every page shows a notice strip, "Booking on hold for N days";
 *   - the pages that start a booking (the booking flow, the custom site's
 *     "Book" page, the rental application) show the notice in their place.
 *
 * The database refuses new rentals and customers for a paused tenant anyway
 * (trigger block_insert_while_paused); this is the polite face of that rule.
 * The pause is read through get_tenant_booking_pause(), which says only whether
 * bookings are on hold and until when.
 */

/** First path segments that start a new reservation. */
const BOOKING_ROUTES = new Set(['booking', 'book', 'apply']);

function isBookingRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] && BOOKING_ROUTES.has(parts[0])) return true;
  return parts[0] === 'custom-booking-page' && parts[1] === 'book';
}

export function BookingPauseGate({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();
  const pathname = usePathname();

  const { data } = useQuery({
    queryKey: ['booking-pause', tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_tenant_booking_pause', { p_tenant_id: tenant!.id });
      if (error) return null; // Never take a site down because the check failed.
      return data as { paused: boolean; resumes_at: string } | null;
    },
  });

  if (!data?.paused) return <>{children}</>;

  const resumes = new Date(data.resumes_at);
  const days = Math.max(1, Math.ceil((resumes.getTime() - Date.now()) / 86_400_000));
  const daysText = `${days} day${days === 1 ? '' : 's'}`;
  const resumesText = resumes.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const name = tenant?.company_name || 'This company';

  const strip = (
    <div
      role="status"
      className="flex w-full items-center justify-center gap-2 bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <CalendarClock className="h-4 w-4 shrink-0" />
      <span>
        Booking on hold for {daysText}. New reservations open again on {resumesText}.
      </span>
    </div>
  );

  if (!isBookingRoute(pathname)) {
    return (
      <>
        {strip}
        {children}
      </>
    );
  }

  return (
    <>
      {strip}
      <main className="flex min-h-[60vh] items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
            <CalendarClock className="h-7 w-7 text-amber-600 dark:text-amber-300" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Booking on hold for {daysText}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {name} isn&apos;t taking new reservations right now. Bookings open
            again on {resumesText}. If you already have a booking, it isn&apos;t affected.
          </p>
        </div>
      </main>
    </>
  );
}
