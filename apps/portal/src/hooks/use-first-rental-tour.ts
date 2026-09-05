'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { useV2 } from '@/lib/v2-context';
import { isLeanTenant } from '@/lib/lean-areas';
import { useFirstRunWizard } from '@/hooks/use-first-run-wizard';
import { toast } from '@/hooks/use-toast';
import {
  FIRST_RENTAL_TOUR,
  MIN_TOUR_STOPS,
  REPLAY_TOUR_EVENT,
  hasSeenTour,
  markTourSeen,
  resolveStops,
  shouldAutostartTour,
  type ResolvedStop,
} from '@/lib/first-rental-tour';

/**
 * The first-rental tour's state machine.
 *
 * GATING — northwind only, keyed on the tenant's SLUG.
 * ---------------------------------------------------
 * The slug comes from `tenant.slug` — the row that actually came back — and
 * never from `tenantSlug`, which TenantContext derives from
 * `window.location.hostname` in an effect before any lookup has happened.
 * Keying on the resolved row buys the third gate case for free: a bogus host
 * like `nosuchtenant.portal.…` leaves `tenant` null, so `isLeanTenant(undefined)`
 * is false and the tour cannot run; and a host that merely SPELLS the canary in
 * an environment where the canary does not exist gets the same answer.
 *
 * Never key on the id. `northwind` is 6e5c544f-… in production and 8e6bc88f-…
 * on the staging branch, so an id-keyed gate silently resolves to the ungated
 * path in whichever environment it was not written against — no error, no
 * failed build, the screen simply never changes.
 *
 * ORDERING — this is step 7, and step 6 is the wizard.
 * ---------------------------------------------------
 * `useFirstRunWizard` is consulted rather than duplicated. The tour waits not
 * only for the wizard to be closed but for it to have SAID it will not open:
 * its query settles a beat after mount, and starting inside that beat is
 * exactly how two full-screen surfaces end up stacked on a brand-new operator.
 *
 * WAITING FOR ANCHORS, rather than guessing a delay.
 * --------------------------------------------------
 * The sidebar's nav is filtered by manager permissions, which arrive from a
 * query. A fixed timeout that fires first would resolve against a half-built
 * rail and silently drop stops. So the autostart polls for its anchors over a
 * short window and starts on the first pass that finds enough of them. Failing
 * to find them does NOT mark the tour seen — the operator simply gets another
 * chance on their next visit, which is the right outcome for "the sidebar was
 * not open yet".
 */

/** How long after mount to begin looking, and how patiently. */
const FIRST_ATTEMPT_MS = 900;
const RETRY_EVERY_MS = 400;
const GIVE_UP_AFTER_MS = 8_000;

export interface FirstRentalTourState {
  /** Is the tour on screen right now? */
  active: boolean;
  /** The stops that actually resolved, in order. Never fewer than two. */
  stops: readonly ResolvedStop[];
  /** Index into `stops`. */
  index: number;
  next: () => void;
  back: () => void;
  /** Close it. Skipping and finishing are the same act — both just end it. */
  end: () => void;
  /** Is this user/tenant eligible at all? Drives the menu item's visibility. */
  isEligible: boolean;
}

export function useFirstRentalTour(suppressed: boolean): FirstRentalTourState {
  const { tenant } = useTenant();
  const { appUser, loading: authLoading } = useAuth();
  const hasV2Chrome = useV2('chrome');
  const pathname = usePathname();
  const wizard = useFirstRunWizard();

  const [stops, setStops] = useState<readonly ResolvedStop[]>([]);
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(false);

  const isCanary = isLeanTenant(tenant?.slug);
  const appUserId = appUser?.id ?? null;
  const authReady = !authLoading && !!appUser?.is_active;

  // The wizard is "pending" while it is up AND while it has not yet decided.
  const wizardPending = wizard.shouldShow || wizard.isLoading;

  // Eligible to be OFFERED the tour — the menu item's gate. Deliberately looser
  // than the autostart gate: it ignores `alreadySeen` (replaying is the whole
  // point of the menu item) and the dashboard route (the menu is reachable from
  // every page, and the tour anchors live in the sidebar, not in the page).
  const isEligible = isCanary && hasV2Chrome && authReady;

  /**
   * Launch. Resolves anchors against the live DOM and refuses to start on
   * fewer than two — a step pointing at nothing stalls the tour dead, and one
   * lone stop is not a tour.
   */
  const launch = useCallback(
    (opts: { markSeen: boolean }): boolean => {
      if (typeof document === 'undefined') return false;
      const resolved = resolveStops(FIRST_RENTAL_TOUR, document);
      if (resolved.length < MIN_TOUR_STOPS) return false;
      // UP FRONT, before any state flips — so a re-render, a second effect pass
      // or another tab cannot fire this twice.
      if (opts.markSeen) markTourSeen(appUserId);
      setStops(resolved);
      setIndex(0);
      setActive(true);
      return true;
    },
    [appUserId],
  );

  const end = useCallback(() => {
    setActive(false);
    setStops([]);
    setIndex(0);
    // Belt and braces: `launch` already recorded it, but an operator who ends
    // the tour must never meet it again by accident.
    markTourSeen(appUserId);
  }, [appUserId]);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i >= stops.length - 1) {
        // Last stop — finishing and skipping are the same act.
        setActive(false);
        setStops([]);
        markTourSeen(appUserId);
        return 0;
      }
      return i + 1;
    });
  }, [stops.length, appUserId]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // --- Autostart ---------------------------------------------------------
  //
  // One attempt per mount, guarded by a ref rather than by state so a re-render
  // caused by any of the queries settling cannot re-arm it.
  const autostartDone = useRef(false);

  useEffect(() => {
    if (autostartDone.current) return;

    const gateOpen = !shouldAutostartTour({
      isCanary,
      hasV2Chrome,
      onDashboard: pathname === '/',
      authReady,
      blockingGateOpen: suppressed,
      wizardPending,
      alreadySeen: hasSeenTour(appUserId),
    });
    if (gateOpen) return;

    // From here the gate has said yes. Poll for the anchors, because the rail
    // they live in is still being filtered by the permissions query.
    let cancelled = false;
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout>;

    const attempt = () => {
      if (cancelled || autostartDone.current) return;
      if (launch({ markSeen: true })) {
        autostartDone.current = true;
        return;
      }
      elapsed += RETRY_EVERY_MS;
      if (elapsed >= GIVE_UP_AFTER_MS) {
        // Deliberately NOT marked seen and NOT marked done: the anchors were
        // absent this time (a closed mobile sheet, a slow permissions query),
        // which is a reason to try again next visit, not to burn the one run.
        return;
      }
      timer = setTimeout(attempt, RETRY_EVERY_MS);
    };

    timer = setTimeout(attempt, FIRST_ATTEMPT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isCanary,
    hasV2Chrome,
    pathname,
    authReady,
    suppressed,
    wizardPending,
    appUserId,
    launch,
  ]);

  // --- Replay, from the user menu ----------------------------------------
  useEffect(() => {
    if (!isEligible) return;
    const onReplay = () => {
      // An explicit request bypasses `alreadySeen` and the dashboard-route
      // check — but not the anchor filter, which is a correctness rule rather
      // than a preference.
      if (!launch({ markSeen: true })) {
        toast({
          title: 'Nothing to point at just yet',
          description:
            'Open the navigation sidebar and try again — the tour points at Vehicles, Customers and Rentals.',
        });
      }
    };
    window.addEventListener(REPLAY_TOUR_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_TOUR_EVENT, onReplay);
  }, [isEligible, launch]);

  // The paywall can come up mid-tour (a webhook lands, the gate latches). The
  // tour must get out of its way rather than sit on top of a modal the operator
  // cannot dismiss.
  useEffect(() => {
    if (suppressed && active) {
      setActive(false);
      setStops([]);
      setIndex(0);
    }
  }, [suppressed, active]);

  return { active, stops, index, next, back, end, isEligible };
}

/**
 * May this tenant be OFFERED the tour? The user menu's gate, and nothing more.
 *
 * A separate, effect-free hook rather than a second call to `useFirstRentalTour`
 * on purpose: that one owns an autostart timer and a replay listener, and
 * mounting it twice would arm both twice — two cards, or a replay handled by a
 * copy of the state machine that nothing renders.
 *
 * Same slug-keyed canary gate as everything else here, plus the v2 chrome check.
 * The v2 menu only renders under v2 chrome today, so that half is belt and
 * braces — but it means the whole gate can be read off this one function
 * instead of inferred from where the component happens to be mounted.
 */
export function useFirstRentalTourEligible(): boolean {
  const { tenant } = useTenant();
  const hasV2Chrome = useV2('chrome');
  return isLeanTenant(tenant?.slug) && hasV2Chrome;
}

/** Ask the mounted tour to run again. See `REPLAY_TOUR_EVENT`. */
export function replayFirstRentalTour(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(REPLAY_TOUR_EVENT));
}
