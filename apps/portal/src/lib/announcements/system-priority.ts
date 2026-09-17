'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * SYSTEM ANNOUNCEMENTS GO BEFORE ONBOARDING. This is the one shared signal that
 * makes that true.
 *
 * The order on screen (team lead, Sep 17 2026):
 *   1. code gates: the subscription paywall, the migration blocker, the feedback
 *      dialog, and any modal the operator opened themselves;
 *   2. SYSTEM announcement dialogs (hard, then soft, in the admin's order);
 *   3. onboarding that opens BY ITSELF: the first-rental tour's autostart and its
 *      resume prompt, the first-run wizard and its arrival, the setup reminder, the
 *      welcome-pack prompt;
 *   4. FEATURE announcement dialogs.
 *
 * Steps 1, 2 and 4 are decided in one place (`AnnouncementDialogHost` with
 * `useAnnouncementBlocked`). Step 3 lives in half a dozen components that know
 * nothing about announcements, so the host PUBLISHES its state here and they read it:
 *
 *   'idle'     no system dialog wants the screen. Onboarding behaves as it always did.
 *   'pending'  a system dialog is due and waiting for its turn (the read has
 *              settled, it is just not open yet: the host's quiet period, a code
 *              gate, or a tour the operator is actively running). Also held for as
 *              long as any HARD system dialog applies, even on the pages where it
 *              is itself hidden: while a blocker stands, onboarding does not matter.
 *   'open'     a system dialog is on screen.
 *
 * While the state is not 'idle', an onboarding surface that opens by itself must not
 * open, and one that is already up but that the operator has NOT touched yet must
 * step aside (`useYieldToSystemAnnouncements`). Stepping aside is not an answer:
 * nothing is recorded, no "seen", "skipped", "dismissed" or "snoozed" flag, and the
 * surface comes back by itself once the state is 'idle' again. A hard dialog that
 * never closes simply keeps it away.
 *
 * A surface the operator IS using (answered a wizard question, pressed Next in a
 * tour, clicked inside the setup reminder) is not interrupted. It says so to the
 * host by NOT carrying `data-yields-to-system` on its marker element (or, for a
 * Radix dialog, simply by still holding its scroll lock), and the system dialog
 * waits for it to finish.
 *
 * Mirrored onto `<html data-system-announcement="pending|open">` (absent when idle)
 * so it can be read from devtools, a headless probe, or CSS.
 *
 * No localStorage, no React context: a module-level store read through
 * `useSyncExternalStore`, so the tour hook, the wizard and the Radix prompts, which
 * sit in different subtrees of the dashboard layout, all see a change in the same
 * commit.
 */

export type SystemAnnouncementPriority = 'idle' | 'pending' | 'open';

/** On `<html>` while the state is not idle. */
export const SYSTEM_ANNOUNCEMENT_ATTR = 'data-system-announcement';

/**
 * On an onboarding surface's marker element while it would step aside for a system
 * dialog (it opened by itself and nobody has touched it). A marker WITHOUT it blocks
 * system dialogs; see `SYSTEM_ANNOUNCEMENT_BLOCKING_MARKERS`.
 */
export const YIELDS_TO_SYSTEM_ATTR = 'data-yields-to-system';

let state: SystemAnnouncementPriority = 'idle';
const listeners = new Set<() => void>();

function mirror(next: SystemAnnouncementPriority) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  if (next === 'idle') document.documentElement.removeAttribute(SYSTEM_ANNOUNCEMENT_ATTR);
  else document.documentElement.setAttribute(SYSTEM_ANNOUNCEMENT_ATTR, next);
}

export function getSystemAnnouncementPriority(): SystemAnnouncementPriority {
  return state;
}

/** Only the announcement dialog host writes this. */
export function setSystemAnnouncementPriority(next: SystemAnnouncementPriority): void {
  if (next === state) return;
  state = next;
  mirror(next);
  // A copy: a listener may unsubscribe itself (whenSystemAnnouncementsIdle does).
  for (const listener of Array.from(listeners)) listener();
}

export function subscribeSystemAnnouncementPriority(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Run `run` once no system dialog wants the screen: now if that is already true,
 * otherwise on the first change to 'idle'. Detached from React on purpose, for work
 * that must outlive the component asking (the wizard unmounts the moment it saves,
 * and its arrival celebration is queued behind a system dialog). Returns a cancel.
 */
export function whenSystemAnnouncementsIdle(run: () => void): () => void {
  if (state === 'idle') {
    run();
    return () => {};
  }
  let done = false;
  const unsubscribe = subscribeSystemAnnouncementPriority(() => {
    if (done || state !== 'idle') return;
    done = true;
    unsubscribe();
    run();
  });
  return () => {
    done = true;
    unsubscribe();
  };
}

const serverSnapshot = (): SystemAnnouncementPriority => 'idle';

export function useSystemAnnouncementPriority(): SystemAnnouncementPriority {
  return useSyncExternalStore(subscribeSystemAnnouncementPriority, getSystemAnnouncementPriority, serverSnapshot);
}

export interface YieldToSystemAnnouncements {
  /** Render the surface now? */
  show: boolean;
  /** The operator has interacted with it since it came up; it no longer steps aside. */
  engaged: boolean;
  /** Call on the operator's first interaction (pointer down / key down inside it). */
  engage: () => void;
}

/**
 * For an onboarding surface that OPENS BY ITSELF. `wantsToShow` is the surface's own
 * answer to "would I be on screen right now?".
 *
 *   - While a system dialog is pending or open, it is not shown.
 *   - Already up when one becomes due, and untouched: it is hidden (unmounted or
 *     closed, WITHOUT any of its own close/dismiss/snooze handlers running) and comes
 *     back when the state returns to idle.
 *   - Already up and touched (`engage()` was called while it was showing): it stays.
 *     Engagement is forgotten once the surface stops wanting to show.
 */
export function useYieldToSystemAnnouncements(wantsToShow: boolean): YieldToSystemAnnouncements {
  const priority = useSystemAnnouncementPriority();
  const [engaged, setEngaged] = useState(false);

  const show = wantsToShow && (engaged || priority === 'idle');
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (!wantsToShow && engaged) setEngaged(false);
  }, [wantsToShow, engaged]);

  const engage = useCallback(() => {
    if (showRef.current) setEngaged(true);
  }, []);

  return { show, engaged: engaged && wantsToShow, engage };
}

/** FOR TESTS: back to idle, no listeners, no attribute. */
export function __resetSystemAnnouncementPriority(): void {
  state = 'idle';
  listeners.clear();
  mirror('idle');
}
