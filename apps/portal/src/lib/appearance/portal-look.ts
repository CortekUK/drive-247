'use client';

/**
 * The portal's look: Standard (today's flat cards) or Glass (frosted panes over
 * a photograph, the booking site's Template 2 material).
 *
 * v2 only. The Theme section on the v2 Branding page writes it, and today the
 * v2 dashboard is the only screen that reads it (Ghulam, Nov 2026: "for now just
 * turn the main dashboard tab to glass").
 *
 * KEPT IN THE BROWSER, per tenant, for now. It is a viewing preference like
 * light and dark mode (which next-themes also keeps in localStorage), and
 * keeping it here needs no column on `tenants` — a new column there without its
 * own anon GRANT takes every booking site's branding down (lib/v2.ts). Keyed by
 * tenant id so a super admin hopping between tenants keeps each one's choice.
 *
 * Every component reading it updates together: a change dispatches a window
 * event, and the `storage` event carries it to other tabs.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { NORTHWIND } from '@/lib/v2';

export type PortalLook = 'standard' | 'glass';

const CHANGE_EVENT = 'drive247:portal-look';

const storageKey = (tenantId: string) => `drive247:portal-look:${tenantId}`;

/**
 * Glass is the default (Ghulam, Nov 2026): a browser with no saved choice gets
 * it, and only an explicit "standard" turns it off. Who is offered the look at
 * all is the caller's gate (`isGlassTenant`), not this store's.
 */
export const DEFAULT_PORTAL_LOOK: PortalLook = 'glass';

/** Glass is northwind's alone for now, keyed on slug like every v2 gate (lib/v2.ts). */
export function isGlassTenant(slug: string | null | undefined): boolean {
  return slug === NORTHWIND;
}

function readLook(tenantId: string | null | undefined): PortalLook {
  if (!tenantId || typeof window === 'undefined') return DEFAULT_PORTAL_LOOK;
  try {
    return window.localStorage.getItem(storageKey(tenantId)) === 'standard' ? 'standard' : 'glass';
  } catch {
    // Private windows and blocked storage: the default look.
    return DEFAULT_PORTAL_LOOK;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function usePortalLook(tenantId: string | null | undefined) {
  const look = useSyncExternalStore(
    subscribe,
    () => readLook(tenantId),
    () => DEFAULT_PORTAL_LOOK
  );

  const setLook = useCallback(
    (next: PortalLook) => {
      if (!tenantId) return;
      try {
        window.localStorage.setItem(storageKey(tenantId), next);
      } catch {
        // Storage refused: the choice simply does not stick.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [tenantId]
  );

  return [look, setLook] as const;
}
