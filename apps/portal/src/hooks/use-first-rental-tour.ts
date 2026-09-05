'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { useV2 } from '@/lib/v2-context';
import { isLeanTenant } from '@/lib/lean-areas';
import { getBookingBaseUrl } from '@/lib/booking-url';
import { useFirstRunWizard } from '@/hooks/use-first-run-wizard';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useRentalCreationGate } from '@/hooks/use-rental-creation-gate';
import { toast } from '@/hooks/use-toast';
import {
  REPLAY_TOUR_EVENT,
  buildTour,
  clearTourProgress,
  decideResume,
  hasSeenTour,
  isTourWorthRunning,
  markTourSeen,
  readTourProgress,
  resolveStep,
  routePathname,
  routeSearch,
  shouldAutostartTour,
  stepIsOnRoute,
  writeTourProgress,
  MAX_RESUME_PROMPTS,
  type ResolvedStep,
  type TourBuildContext,
  type TourStep,
} from '@/lib/first-rental-tour';

/**
 * The first-rental walkthrough's state machine.
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
 * THE PHASES
 * ----------
 *   idle        nothing on screen
 *   prompt      "pick up where you left off?" — Resume / Start over / Dismiss
 *   transit     a step just became current; decide whether to navigate
 *   navigating  we asked the router for the step's route; waiting to arrive
 *   waiting     on the route; polling for the step's anchor to mount
 *   showing     the card is up
 *
 * CROSSING PAGES
 * --------------
 * Steps carry a route. Moving to a step on another route persists progress
 * FIRST (so a reload mid-navigation lands on the right step) and then pushes
 * the route. On arrival the hook polls for the anchor — every page fetches its
 * data and its anchors mount late — and if the anchor never shows within the
 * budget it SKIPS the step. A step pointing at nothing never renders; that
 * exact failure killed the previous tour attempt.
 *
 * WANDERING OFF
 * -------------
 * If the pathname changes under a step we are showing (a sidebar click, the
 * browser back button) the tour PAUSES rather than following: it writes
 * `paused` progress and gets off the screen. The dashboard then offers to
 * resume — at most `MAX_RESUME_PROMPTS` times, and never anywhere else. The
 * same happens when the operator clicks the very thing being pointed at on a
 * step that opens a dialog (Add Vehicle, Add Customer): they are doing the
 * real thing, and a coach mark floating over the dialog would be in the way.
 */

/** How long to wait for a step's anchor before skipping the step. */
export const ANCHOR_WAIT_MS = 6_000;
/**
 * A shorter budget for the NEXT step on the same route once one has timed out
 * there. Three in-flow steps share `/rentals/new`; if the form never mounted
 * for the first, it will not mount for the others either, and 18 seconds of
 * "setting up…" is the tour dying slowly.
 */
export const ANCHOR_WAIT_SHORT_MS = 1_500;
export const ANCHOR_POLL_MS = 250;
/** How long a `router.push` may take before we assume it did not happen. */
export const NAV_TIMEOUT_MS = 10_000;
/** A beat after the dashboard paints before the Welcome card comes up. */
const AUTOSTART_DELAY_MS = 700;

export type TourPhase = 'idle' | 'prompt' | 'transit' | 'navigating' | 'waiting' | 'showing';

export interface FirstRentalTourState {
  phase: TourPhase;
  /** Is a card on screen right now? (`phase === 'showing'`) */
  active: boolean;
  /** This user's steps — filtered and rerouted at launch. */
  steps: readonly TourStep[];
  /** Index into `steps`. */
  index: number;
  /** The step on screen, resolved. Null unless `phase === 'showing'`. */
  current: ResolvedStep | null;
  /** The optional context line for the current step (the booking URL). */
  detail: string | null;
  next: () => void;
  back: () => void;
  /** Skip. Ends the run for good — progress cleared, seen stays marked. */
  end: () => void;
  /** Finish from the last card and go home to the setup guide. */
  finishToDashboard: () => void;
  /** The card's anchor left the DOM. Re-resolve, or skip the step. */
  anchorLost: () => void;
  /** The operator clicked the anchor on a step that opens a dialog. */
  pause: () => void;
  /** Resume-prompt actions. */
  resume: () => void;
  startOver: () => void;
  dismissPrompt: () => void;
  /** Is this user/tenant eligible at all? Drives the menu item's visibility. */
  isEligible: boolean;
}

export function useFirstRentalTour(suppressed: boolean): FirstRentalTourState {
  const { tenant } = useTenant();
  const { appUser, loading: authLoading } = useAuth();
  const hasV2Chrome = useV2('chrome');
  const pathname = usePathname();
  const router = useRouter();
  const wizard = useFirstRunWizard();
  const {
    isManager,
    isLoading: permissionsLoading,
    canAccessRoute,
    canEdit,
    canViewSettings,
  } = useManagerPermissions();
  const { blocked: rentalCreationBlocked, isLoading: rentalGateLoading } =
    useRentalCreationGate();

  const [phase, setPhase] = useState<TourPhase>('idle');
  const [steps, setSteps] = useState<readonly TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [current, setCurrent] = useState<ResolvedStep | null>(null);

  const isCanary = isLeanTenant(tenant?.slug);
  const appUserId = appUser?.id ?? null;
  const authReady = !authLoading && !!appUser?.is_active;

  // The wizard is "pending" while it is up AND while it has not yet decided.
  const wizardPending = wizard.shouldShow || wizard.isLoading;

  // `buildTour` reads the manager's grants and the Stripe gate. Both arrive
  // from queries; launching before they land would drop steps a manager
  // actually has, or route the rental steps the wrong way. Non-managers never
  // wait (their query is disabled), and non-lean tenants never wait on the
  // gate (same).
  const gatesSettled = (!isManager || !permissionsLoading) && !rentalGateLoading;

  // Eligible to be OFFERED the tour — the menu item's gate. Deliberately looser
  // than the autostart gate: it ignores `alreadySeen` (replaying is the whole
  // point of the menu item) and the dashboard route (the menu is reachable
  // from every page, and the walkthrough navigates itself home).
  const isEligible = isCanary && hasV2Chrome && authReady;

  // The build context is rebuilt every render — the permission callbacks are
  // new identities each time — and read through a ref so no effect has to list
  // them as dependencies and re-arm itself on every paint.
  const ctxRef = useRef<TourBuildContext>({
    canAccessRoute: () => true,
    canEdit: () => true,
    canViewSettings: () => true,
    isMobile: false,
    rentalCreationBlocked: false,
    bookingUrl: null,
  });
  ctxRef.current = {
    canAccessRoute,
    canEdit,
    canViewSettings,
    isMobile: typeof window !== 'undefined' && window.innerWidth < 768,
    rentalCreationBlocked,
    bookingUrl: getBookingBaseUrl(tenant?.slug),
  };

  const stepsRef = useRef<readonly TourStep[]>(steps);
  stepsRef.current = steps;
  const indexRef = useRef(index);
  indexRef.current = index;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  /** Where we asked the router to take us, and from where. */
  const navRef = useRef<{ from: string | null; to: string } | null>(null);
  /** The route on which the last anchor wait timed out, for the short budget. */
  const timedOutRouteRef = useRef<string | null>(null);

  // --- Transitions -------------------------------------------------------

  const clearAll = useCallback(() => {
    navRef.current = null;
    timedOutRouteRef.current = null;
    setCurrent(null);
    setSteps([]);
    setIndex(0);
    setPhase('idle');
  }, []);

  /** Make step `i` of `list` current. Persists first, then transits. */
  const goTo = useCallback(
    (i: number, list: readonly TourStep[] = stepsRef.current) => {
      const step = list[i];
      if (!step) return;
      writeTourProgress(appUserId, { stepId: step.id, status: 'active' });
      navRef.current = null;
      setCurrent(null);
      setIndex(i);
      setPhase('transit');
    },
    [appUserId],
  );

  /** Finishing, skipping and dismissing are the same act: the run is over. */
  const finish = useCallback(() => {
    clearTourProgress(appUserId);
    markTourSeen(appUserId);
    clearAll();
  }, [appUserId, clearAll]);

  const end = finish;

  const finishToDashboard = useCallback(() => {
    finish();
    if (pathnameRef.current !== '/') router.push('/');
  }, [finish, router]);

  /** Step aside, remembering where we were. The dashboard offers to resume. */
  const pause = useCallback(() => {
    const step = stepsRef.current[indexRef.current];
    if (step) writeTourProgress(appUserId, { stepId: step.id, status: 'paused' });
    clearAll();
  }, [appUserId, clearAll]);

  const next = useCallback(() => {
    const i = indexRef.current;
    if (i >= stepsRef.current.length - 1) {
      finish();
      return;
    }
    goTo(i + 1);
  }, [finish, goTo]);

  const back = useCallback(() => {
    goTo(Math.max(0, indexRef.current - 1));
  }, [goTo]);

  /**
   * The anchor never mounted (or left). Move on — or, if this was the last
   * step, finish. Remember the route so the next step on it waits less.
   */
  const skipForward = useCallback(() => {
    const step = stepsRef.current[indexRef.current];
    if (step?.route) timedOutRouteRef.current = routePathname(step.route);
    next();
  }, [next]);

  /** The card noticed its anchor detached. Try again, then skip. */
  const anchorLost = useCallback(() => {
    if (phaseRef.current !== 'showing') return;
    setCurrent(null);
    setPhase('waiting');
  }, []);

  /**
   * Launch. Builds THIS user's step list and refuses to start on fewer than
   * two anchored steps — a walkthrough of an intro and a finale is not one.
   */
  const launch = useCallback(
    (opts: { markSeen: boolean; fromIndex?: number }): boolean => {
      if (typeof document === 'undefined') return false;
      const built = buildTour(ctxRef.current);
      if (!isTourWorthRunning(built)) return false;
      // UP FRONT, before any state flips — so a re-render, a second effect pass
      // or another tab cannot fire this twice.
      if (opts.markSeen) markTourSeen(appUserId);
      const start = Math.min(Math.max(0, opts.fromIndex ?? 0), built.length - 1);
      timedOutRouteRef.current = null;
      setSteps(built);
      goTo(start, built);
      return true;
    },
    [appUserId, goTo],
  );

  // --- Resume-prompt actions ----------------------------------------------

  const resume = useCallback(() => {
    const progress = readTourProgress(appUserId);
    const built = buildTour(ctxRef.current);
    const decision = decideResume(progress, pathnameRef.current, built);
    const from = decision.kind === 'none' ? 0 : decision.index;
    if (!launch({ markSeen: false, fromIndex: from })) finish();
  }, [appUserId, launch, finish]);

  const startOver = useCallback(() => {
    clearTourProgress(appUserId);
    if (!launch({ markSeen: true })) clearAll();
  }, [appUserId, launch, clearAll]);

  const dismissPrompt = useCallback(() => {
    clearTourProgress(appUserId);
    markTourSeen(appUserId);
    clearAll();
  }, [appUserId, clearAll]);

  // --- The drive: route, wait, show ---------------------------------------

  useEffect(() => {
    if (phase === 'idle') return;

    // The prompt lives on the dashboard only. Leave with it, and it goes.
    if (phase === 'prompt') {
      if (pathname !== '/') setPhase('idle');
      return;
    }

    const step = steps[index];
    if (!step) {
      finish();
      return;
    }
    const onRoute = stepIsOnRoute(step, pathname);

    if (phase === 'transit') {
      // Already here? A route with a query (settings?tab=branding) still needs
      // the push when the query differs: same pathname, but the page reads the
      // tab from the URL and the anchor lives inside that tab.
      const wantSearch = step.route ? routeSearch(step.route) : '';
      const haveSearch = typeof window === 'undefined' ? '' : window.location.search;
      const needsPush = !onRoute || (wantSearch !== '' && wantSearch !== haveSearch);
      if (!needsPush || step.route === null) {
        setPhase('waiting');
        return;
      }
      navRef.current = { from: pathname, to: routePathname(step.route) };
      setPhase('navigating');
      router.push(step.route);
      return;
    }

    if (phase === 'navigating') {
      const nav = navRef.current;
      if (onRoute) {
        navRef.current = null;
        setPhase('waiting');
        return;
      }
      if (nav && pathname === nav.from) {
        // Still on the origin. Give the router its time, then give up: an
        // operator staring at a "heading to…" pill forever is the stall we
        // are here to avoid.
        const timer = setTimeout(() => pause(), NAV_TIMEOUT_MS);
        return () => clearTimeout(timer);
      }
      // Somewhere else entirely — they clicked away mid-transition.
      pause();
      return;
    }

    // waiting | showing
    if (!onRoute) {
      // The pathname changed under us. They wandered; step aside.
      pause();
      return;
    }

    if (phase === 'showing') return;

    // phase === 'waiting': poll for the anchor, then skip.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let elapsed = 0;
    const budget =
      step.route && timedOutRouteRef.current === routePathname(step.route)
        ? ANCHOR_WAIT_SHORT_MS
        : ANCHOR_WAIT_MS;

    const attempt = () => {
      if (cancelled) return;
      const resolved = resolveStep(step, document);
      if (resolved) {
        setCurrent(resolved);
        setPhase('showing');
        return;
      }
      elapsed += ANCHOR_POLL_MS;
      if (elapsed >= budget) {
        skipForward();
        return;
      }
      timer = setTimeout(attempt, ANCHOR_POLL_MS);
    };
    attempt();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, index, steps, pathname, router, finish, pause, skipForward]);

  // --- Autostart ---------------------------------------------------------
  //
  // One attempt per mount, guarded by a ref rather than by state so a re-render
  // caused by any of the queries settling cannot re-arm it.
  const autostartDone = useRef(false);

  useEffect(() => {
    if (autostartDone.current || phase !== 'idle') return;
    if (!gatesSettled) return;
    // An interrupted run is the resume effect's business, not autostart's.
    if (readTourProgress(appUserId)) return;

    const go = shouldAutostartTour({
      isCanary,
      hasV2Chrome,
      onDashboard: pathname === '/',
      authReady,
      blockingGateOpen: suppressed,
      wizardPending,
      alreadySeen: hasSeenTour(appUserId),
    });
    if (!go) return;

    // A beat, so the Welcome card comes up over a painted dashboard rather
    // than a skeleton. Every step after it waits for its own anchor.
    const timer = setTimeout(() => {
      if (autostartDone.current || phaseRef.current !== 'idle') return;
      if (launch({ markSeen: true })) autostartDone.current = true;
    }, AUTOSTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    phase,
    gatesSettled,
    isCanary,
    hasV2Chrome,
    pathname,
    authReady,
    suppressed,
    wizardPending,
    appUserId,
    launch,
  ]);

  // --- Resume ------------------------------------------------------------
  //
  // Reload on a step's own route: pick up silently. Land on the dashboard with
  // an interrupted run: offer to. Once per dashboard visit, a few times at
  // most, and never on any other page.
  const promptedOnThisVisit = useRef(false);
  useEffect(() => {
    if (pathname !== '/') promptedOnThisVisit.current = false;
  }, [pathname]);

  useEffect(() => {
    if (phase !== 'idle') return;
    if (!isEligible || suppressed || wizardPending || !gatesSettled) return;
    const progress = readTourProgress(appUserId);
    if (!progress) return;

    const built = buildTour(ctxRef.current);
    if (!isTourWorthRunning(built)) {
      clearTourProgress(appUserId);
      return;
    }
    const decision = decideResume(progress, pathname, built);
    if (decision.kind === 'resume') {
      launch({ markSeen: false, fromIndex: decision.index });
      return;
    }
    if (decision.kind === 'prompt') {
      if (promptedOnThisVisit.current) return;
      if (progress.prompts >= MAX_RESUME_PROMPTS) {
        // Asked enough. Silence is their answer.
        clearTourProgress(appUserId);
        return;
      }
      promptedOnThisVisit.current = true;
      writeTourProgress(appUserId, {
        stepId: progress.stepId,
        status: progress.status,
        prompts: progress.prompts + 1,
      });
      setPhase('prompt');
    }
  }, [phase, isEligible, suppressed, wizardPending, gatesSettled, appUserId, pathname, launch]);

  // --- Replay, from the user menu ----------------------------------------
  useEffect(() => {
    if (!isEligible) return;
    const onReplay = () => {
      // An explicit request bypasses `alreadySeen` and the dashboard-route
      // check — the walkthrough navigates itself home — but not the step
      // filter, which is a correctness rule rather than a preference.
      clearTourProgress(appUserId);
      if (!launch({ markSeen: true })) {
        toast({
          title: 'Nothing to walk through just yet',
          description:
            'The walkthrough points at Vehicles, Customers and Rentals, and none of those are available to this account.',
        });
      }
    };
    window.addEventListener(REPLAY_TOUR_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_TOUR_EVENT, onReplay);
  }, [isEligible, launch, appUserId]);

  // The paywall can come up mid-tour (a webhook lands, the gate latches). The
  // tour must get out of its way rather than sit on top of a modal the operator
  // cannot dismiss. Pausing keeps their place for when the gate clears.
  useEffect(() => {
    if (!suppressed || phase === 'idle') return;
    if (phase === 'prompt') {
      setPhase('idle');
      return;
    }
    pause();
  }, [suppressed, phase, pause]);

  const detail = current?.step.detail ? current.step.detail(ctxRef.current) : null;

  return {
    phase,
    active: phase === 'showing',
    steps,
    index,
    current,
    detail,
    next,
    back,
    end,
    finishToDashboard,
    anchorLost,
    pause,
    resume,
    startOver,
    dismissPrompt,
    isEligible,
  };
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
