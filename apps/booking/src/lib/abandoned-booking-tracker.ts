/**
 * Abandoned-booking tracker — shared by the V1 wizard (MultiStepBookingWidget)
 * and the V2 vehicle page (northwind-site).
 *
 * Neither booking flow writes anything to the database before checkout: dates,
 * car and contact details live in localStorage until the customer pays. So the
 * only place a mid-way drop-off can be seen is here, in the browser. Each step
 * the renter reaches is reported to the public `abandoned-booking-track` edge
 * function, which upserts one `abandoned_bookings` row per browser session.
 * `abandoned-recovery-run` decides later whether it was abandoned (and emails
 * the renter) or completed.
 *
 * Fire-and-forget: tracking must never slow down or break a booking, so every
 * failure is swallowed.
 */

import { supabase } from '@/integrations/supabase/client';

export type BookingStage = 'dates' | 'vehicle' | 'insurance' | 'details' | 'checkout' | 'payment' | 'completed';

export interface BookingProgress {
  tenantId: string;
  site: 'v1' | 'v2';
  stage: BookingStage;
  vehicleId?: string | null;
  vehicleName?: string | null;
  pickupDate?: string | null;
  pickupTime?: string | null;
  dropoffDate?: string | null;
  dropoffTime?: string | null;
  pickupLocation?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  rentalId?: string | null;
  estimatedTotal?: number | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const sessionKey = (tenantId: string) => `d247-booking-session-${tenantId}`;

/** Last payload sent per tenant, so an unchanged re-render sends nothing. */
const lastSent = new Map<string, string>();

function sessionId(tenantId: string): string | null {
  try {
    let id = window.localStorage.getItem(sessionKey(tenantId));
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(sessionKey(tenantId), id);
    }
    return id;
  } catch {
    return null;
  }
}

export function trackBookingProgress(progress: BookingProgress): void {
  if (typeof window === 'undefined' || !progress.tenantId) return;
  const sid = sessionId(progress.tenantId);
  if (!sid) return;

  const email = progress.customerEmail?.trim() || null;
  const payload = {
    ...progress,
    sessionId: sid,
    // A half-typed address is not an address; only send one that could work.
    customerEmail: email && EMAIL_RE.test(email) ? email : null,
  };
  const serialised = JSON.stringify(payload);
  if (lastSent.get(progress.tenantId) === serialised) return;
  lastSent.set(progress.tenantId, serialised);

  try {
    void supabase.functions.invoke('abandoned-booking-track', { body: payload }).catch(() => undefined);
  } catch {
    /* tracking never breaks a booking */
  }

  // A finished booking closes the session; the next booking starts a new one.
  if (progress.stage === 'completed') {
    try {
      window.localStorage.removeItem(sessionKey(progress.tenantId));
    } catch {
      /* ignore */
    }
    lastSent.delete(progress.tenantId);
  }
}
