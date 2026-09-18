'use client';

import { useEffect, useRef, useState } from 'react';
import { useMigrationStatus } from '@/hooks/use-migration-status';
import { useFirstRunWizard } from '@/hooks/use-first-run-wizard';
import { wantsFirstRun } from '@/lib/first-run-handoff';
import { useFeedbackStore } from '@/stores/feedback-store';
import { YIELDS_TO_SYSTEM_ATTR } from '@/lib/announcements/system-priority';

/**
 * Is something else on screen that an announcement dialog must wait for?
 *
 * Answered twice, because the two kinds of announcement dialog rank differently
 * (team lead, Sep 17 2026):
 *
 *   code gates  >  SYSTEM dialogs  >  onboarding that opens by itself  >  FEATURE dialogs
 *
 * `system`: only what outranks a system dialog.
 *   showGate          the subscription paywall (the layout computes it and passes it in)
 *   migration         `useMigrationStatus()`: the migration blocker or its success
 *                     celebration is up, OR its row is still loading (it may be about
 *                     to open; the query is shared with MigrationBlockerDialog)
 *   handoff reload    `?firstrun=1`: this page load is about to hard-reload itself
 *   feedback          the staff feedback dialog (store driven)
 *   a running tour,   an onboarding marker that does NOT carry `data-yields-to-system`:
 *   an engaged wizard the operator started the tour or is answering the wizard, and
 *                     is not interrupted. An untouched surface carries the attribute
 *                     and steps aside by itself (lib/announcements/system-priority.ts),
 *                     so it is not a blocker here.
 *   any other modal   Radix counts open modal layers on <body data-scroll-locked="n">.
 *                     That covers everything the operator opened themselves (edit
 *                     forms, the mobile sidebar sheet, the feature dialog opened from
 *                     the card) and SubscriptionActivated / ConnectStripeRequired. The
 *                     setup reminder and the welcome-pack prompt close themselves while
 *                     a system dialog is due, so their lock is only still here when the
 *                     operator is using them. Conservative (a modal dropdown counts
 *                     too), which is the right way to be wrong: waiting costs nothing.
 *
 * `feature`: all of the above, plus every onboarding surface, touched or not:
 *   first-run wizard  `useFirstRunWizard()`: will show, or is still deciding
 *   tours             DOM markers the first-rental tour, its transit pill, its resume
 *                     prompt, the wizard and the wizard's arrival veil render
 *
 * `ownDialogOpen`: while the announcement host's own dialog is open it holds one of
 * those locks itself, so the threshold becomes two.
 *
 * `[role="dialog"]` is deliberately NOT a signal: Radix popovers carry it too.
 * PolicyAcceptanceGate is not a signal because it is not mounted anywhere (policies
 * are accepted on the login form).
 */

const ONBOARDING_MARKERS = [
  'data-first-rental-tour',
  'data-tour-transit',
  'data-tour-prompt',
  'data-first-run-wizard',
  'data-first-run-arrival',
] as const;

/** Every onboarding surface. Feature dialogs wait for all of them. */
export const ANNOUNCEMENT_BLOCKING_MARKERS = ONBOARDING_MARKERS.map((m) => `[${m}]`).join(', ');

/** Only the onboarding surfaces the operator is using. System dialogs wait for these. */
export const SYSTEM_ANNOUNCEMENT_BLOCKING_MARKERS = ONBOARDING_MARKERS.map(
  (m) => `[${m}]:not([${YIELDS_TO_SYSTEM_ATTR}])`,
).join(', ');

export type AnnouncementDialogScope = 'system' | 'feature';

/**
 * The DOM half of the check, also used by the host right before it opens a dialog.
 * `scope` defaults to 'feature', the strictest answer.
 */
export function readAnnouncementDomBlocked(
  ownDialogOpen: boolean,
  scope: AnnouncementDialogScope = 'feature',
): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const markers = scope === 'system' ? SYSTEM_ANNOUNCEMENT_BLOCKING_MARKERS : ANNOUNCEMENT_BLOCKING_MARKERS;
  if (document.querySelector(markers)) return true;
  const locks = Number(document.body.getAttribute('data-scroll-locked') || 0);
  return (Number.isFinite(locks) ? locks : 0) >= (ownDialogOpen ? 2 : 1);
}

export interface AnnouncementBlocked {
  /** A system dialog (hard or soft) must wait. */
  system: boolean;
  /** A feature dialog must wait. Always true when `system` is. */
  feature: boolean;
}

export function useAnnouncementBlocked(opts: { showGate: boolean; ownDialogOpen: boolean }): AnnouncementBlocked {
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

  const [domSystem, setDomSystem] = useState(() => readAnnouncementDomBlocked(ownDialogOpen, 'system'));
  const [domFeature, setDomFeature] = useState(() => readAnnouncementDomBlocked(ownDialogOpen, 'feature'));

  useEffect(() => {
    const update = () => {
      setDomSystem(readAnnouncementDomBlocked(ownOpenRef.current, 'system'));
      setDomFeature(readAnnouncementDomBlocked(ownOpenRef.current, 'feature'));
    };
    update();
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // `data-yields-to-system` comes off a marker the moment the operator touches it.
      attributeFilter: ['data-scroll-locked', YIELDS_TO_SYSTEM_ATTR],
    });
    return () => observer.disconnect();
  }, [ownDialogOpen]);

  const system =
    showGate || migrationPromptShowing || migrationLoading || handoffPending || feedbackOpen || domSystem;
  const feature = system || wizardShows || wizardLoading || domFeature;
  return { system, feature };
}
