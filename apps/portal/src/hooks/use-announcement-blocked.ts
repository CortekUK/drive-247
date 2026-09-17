'use client';

import { useEffect, useRef, useState } from 'react';
import { useMigrationStatus } from '@/hooks/use-migration-status';
import { useFirstRunWizard } from '@/hooks/use-first-run-wizard';
import { wantsFirstRun } from '@/lib/first-run-handoff';
import { useFeedbackStore } from '@/stores/feedback-store';

/**
 * Is something else on screen that an announcement dialog must wait for?
 *
 * Code-driven gates always win (brief decision 6): an announcement dialog never
 * opens over one, and an open announcement dialog quietly yields when one appears.
 * None of those components is edited for this; each signal below is read from
 * state they already expose, or from the DOM they already produce.
 *
 *   showGate          the subscription paywall (the layout computes it and passes it in)
 *   migration         `useMigrationStatus()`: the migration blocker or its success
 *                     celebration is up, OR its row is still loading (it may be about
 *                     to open; the query is shared with MigrationBlockerDialog)
 *   first-run wizard  `useFirstRunWizard()`: will show, or is still deciding
 *   handoff reload    `?firstrun=1`: this page load is about to hard-reload itself
 *   feedback          the staff feedback dialog (store driven)
 *   tours             DOM markers the first-rental tour, its transit pill, its resume
 *                     prompt, the wizard and the wizard's arrival veil render
 *   any other modal   Radix counts open modal layers on <body data-scroll-locked="n">.
 *                     That covers SetupReminder, SubscriptionActivated, WelcomePack,
 *                     ConnectStripeRequired, the mobile sidebar sheet, the feature
 *                     dialog opened from the card, and anything added later. It is
 *                     conservative (a modal dropdown counts too), which is the right
 *                     way to be wrong here: waiting costs nothing.
 *
 * `ownDialogOpen`: while the announcement host's own dialog is open it holds one of
 * those locks itself, so the threshold becomes two.
 *
 * `[role="dialog"]` is deliberately NOT a signal: Radix popovers carry it too.
 * PolicyAcceptanceGate is not a signal because it is not mounted anywhere (policies
 * are accepted on the login form).
 */

export const ANNOUNCEMENT_BLOCKING_MARKERS =
  '[data-first-rental-tour], [data-tour-transit], [data-tour-prompt], [data-first-run-wizard], [data-first-run-arrival]';

/** The DOM half of the check, also used by the host right before it opens a dialog. */
export function readAnnouncementDomBlocked(ownDialogOpen: boolean): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (document.querySelector(ANNOUNCEMENT_BLOCKING_MARKERS)) return true;
  const locks = Number(document.body.getAttribute('data-scroll-locked') || 0);
  return (Number.isFinite(locks) ? locks : 0) >= (ownDialogOpen ? 2 : 1);
}

export function useAnnouncementBlocked(opts: { showGate: boolean; ownDialogOpen: boolean }): boolean {
  const { showGate, ownDialogOpen } = opts;
  const { migrationPromptShowing, isLoading: migrationLoading } = useMigrationStatus();
  const { shouldShow: wizardShows, isLoading: wizardLoading } = useFirstRunWizard();
  const feedbackOpen = useFeedbackStore((s) => s.isOpen);
  const handoffPending = typeof window !== 'undefined' && wantsFirstRun(window.location.search);

  // Read through a ref inside the observer: a mutation record queued under the old
  // threshold must not report our own dialog's scroll lock as "someone else's modal"
  // (that would close the dialog, release the lock, reopen it, and loop).
  const ownOpenRef = useRef(ownDialogOpen);
  ownOpenRef.current = ownDialogOpen;

  const [domBlocked, setDomBlocked] = useState(() => readAnnouncementDomBlocked(ownDialogOpen));

  useEffect(() => {
    const update = () => setDomBlocked(readAnnouncementDomBlocked(ownOpenRef.current));
    update();
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-scroll-locked'],
    });
    return () => observer.disconnect();
  }, [ownDialogOpen]);

  return (
    showGate ||
    migrationPromptShowing ||
    migrationLoading ||
    wizardShows ||
    wizardLoading ||
    handoffPending ||
    feedbackOpen ||
    domBlocked
  );
}
