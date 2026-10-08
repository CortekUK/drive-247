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
  /**
   * V1 only: wizard fields with no column of their own (location ids, return
   * address, delivery fees, extras), so "Finish your booking" can rebuild the
   * wizard on another device. The edge function keeps an allow-list of keys.
   */
  resumeState?: Record<string, unknown> | null;
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

/* ── "Finish your booking" from the recovery email ─────────────────────────
 * The email links to the booking page with ?resume=<recovery_token>. The token
 * is traded for what the renter had entered, so the page can reopen the step
 * they left at — in whatever browser opened the email, not only the one they
 * started in. The browser then takes over that session, so the rest of the
 * booking (and its completion) is recorded against the email that brought
 * them back.
 */

export const RESUME_PARAM = 'resume';

export type ResumeResult =
  | {
      ok: true;
      site: 'v1' | 'v2';
      stage: BookingStage;
      vehicleId: string | null;
      /** Fields named as in the V1 wizard's formData (V2 maps them itself). */
      state: Record<string, unknown>;
      /** This browser already holds this booking — its own copy is the fuller one. */
      sameSession: boolean;
    }
  | { ok: false; reason: 'completed' | 'expired' | 'invalid' };

/**
 * One trade per token, shared by every caller — React may run an effect twice,
 * and the second run must get the same answer rather than a second request.
 */
const resumeTrades = new Map<string, Promise<ResumeResult | null>>();

/**
 * The booking behind `?resume=` on this page, or null when there is none.
 * The caller applies it, then calls clearResumeParam() — clearing only after
 * use is what lets a repeated effect still see the token.
 */
export function takeResumedBooking(tenantId: string): Promise<ResumeResult | null> {
  if (typeof window === 'undefined' || !tenantId) return Promise.resolve(null);
  const token = new URL(window.location.href).searchParams.get(RESUME_PARAM);
  if (!token) return Promise.resolve(null);
  const key = `${tenantId}:${token}`;
  const cached = resumeTrades.get(key);
  if (cached) return cached;

  const trade = (async (): Promise<ResumeResult | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('abandoned-booking-track', {
        body: { action: 'resume', token, tenantId },
      });
      if (error || !data) return { ok: false, reason: 'invalid' };
      if (!data.ok) {
        const reason = data.reason === 'completed' || data.reason === 'expired' ? data.reason : 'invalid';
        return { ok: false, reason };
      }

      let sameSession = false;
      try {
        sameSession = window.localStorage.getItem(sessionKey(tenantId)) === data.sessionId;
        // Take the session over, so progress from here updates the same row.
        if (!sameSession && typeof data.sessionId === 'string' && data.sessionId) {
          window.localStorage.setItem(sessionKey(tenantId), data.sessionId);
          lastSent.delete(tenantId);
        }
      } catch {
        /* storage blocked: the booking still restores, it just tracks as new */
      }

      return {
        ok: true,
        site: data.site === 'v2' ? 'v2' : 'v1',
        stage: data.stage as BookingStage,
        vehicleId: typeof data.vehicleId === 'string' ? data.vehicleId : null,
        state: data.state && typeof data.state === 'object' ? data.state : {},
        sameSession,
      };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  })();
  resumeTrades.set(key, trade);
  return trade;
}

/**
 * Drop `?resume=` from the address bar once the booking has been restored (or
 * refused), so a reload or a copied link does not replay it over the renter's
 * newer progress.
 */
export function clearResumeParam(): void {
  if (typeof window === 'undefined') return;
  // A later click on the same link (say from the portal) asks again: the
  // session has moved on since this answer.
  resumeTrades.clear();
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(RESUME_PARAM)) return;
    url.searchParams.delete(RESUME_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* the param staying visible is harmless */
  }
}

/** A restored date that has already gone by is not offered again. */
export function isUpcomingIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return value >= today;
}
