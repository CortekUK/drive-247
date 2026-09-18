/**
 * Which announcement surface gets the screen. Pure: no React, no clock, no DOM.
 *
 * The rows arrive from `get_portal_announcements` already targeted and already in
 * priority order (system first, hard first, then the admin's drag order), and with
 * `is_due` merged with this session's local dismissals by `usePortalAnnouncements`.
 * The functions below still put hard rows before soft ones themselves, so a list in
 * any order comes out hard first; within each group the given order is kept.
 *
 * Two slots, picked independently:
 *   - the banner slot: ONE full-width bar. When several banners are due it slides
 *     through all of them (pickSystemBanners); pickSystemBanner is its first-row form;
 *   - the dialog slot: at most ONE announcement modal. For SYSTEM dialogs that one
 *     modal is a pager through every system dialog due (pickSystemDialogs); a FEATURE
 *     dialog is always on its own (pickAnnouncementDialogs).
 *
 * The dialog rules, in order (spec §3.3, as changed Sep 17 2026):
 *   1. anything that outranks announcements owns the screen (a code-driven gate,
 *      a tour the operator is running, another modal) -> nothing;
 *   2. SYSTEM dialogs, one pager: every HARD system dialog not exempt on this route
 *      (drag order), then every due SOFT system dialog (drag order). A hard blocker
 *      that applies but is exempt on this route (the paywall's reachable pages, its
 *      own CTA page) still suppresses every soft and feature dialog, so when EVERY
 *      hard one is exempt here nothing opens at all ("while migration is pending,
 *      new features don't matter"). Soft system dialogs are NOT limited per moment
 *      any more: the pager replaces chaining;
 *   3. on the dashboard only, and only where the v2 dashboard exists, the first due
 *      feature the user has not asked to stop seeing, and only if no soft dialog has
 *      opened yet in this moment (app load or route change);
 *   4. nothing.
 */

import { isOnCtaRoute, type PortalAnnouncement } from '@/lib/announcements/contract';

export interface DialogQueueInput {
  system: PortalAnnouncement[];
  features: PortalAnnouncement[];
  featuresEnabled: boolean;
  pathname: string;
  /** The layout's `isSubscriptionPage`: /subscription, /credits, /settings*, /dev in development. */
  isSubscriptionPage: boolean;
  /** Something that outranks announcement dialogs owns the screen (see useAnnouncementBlocked). */
  blocked: boolean;
  /**
   * False once a soft system pager or a feature dialog has opened in the current
   * moment. Only FEATURE dialogs wait for the next moment; system dialogs ignore it.
   */
  softMomentAvailable: boolean;
}

export type DialogPick = {
  announcement: PortalAnnouncement;
  variant: 'system-hard' | 'system-soft' | 'feature';
} | null;

/** What the dialog slot opens: one system pager, or one feature dialog. */
export type DialogSlotPick =
  | { variant: 'system'; items: PortalAnnouncement[] }
  | { variant: 'feature'; announcement: PortalAnnouncement }
  | null;

const isSystemDialog = (a: PortalAnnouncement) => a.kind === 'system' && a.display === 'dialog';
const isHardSystemDialog = (a: PortalAnnouncement) => isSystemDialog(a) && a.blocking === 'hard';

/** Does any hard system dialog apply to this tenant at all (exempt on this route or not)? */
export function hasHardSystemDialog(system: PortalAnnouncement[]): boolean {
  return system.some(isHardSystemDialog);
}

/** Every row once, in the order given: a repeated id keeps its first place. */
function unique(rows: PortalAnnouncement[]): PortalAnnouncement[] {
  const seen = new Set<string>();
  const out: PortalAnnouncement[] = [];
  for (const a of rows) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/**
 * The system dialog pager's pages, blockers aside: hard (not exempt here) first, then
 * due soft, each group in the given order. Empty when every hard one is exempt here.
 */
export function pickSystemDialogs(
  i: Pick<DialogQueueInput, 'system' | 'pathname' | 'isSubscriptionPage'>,
): PortalAnnouncement[] {
  const dialogs = unique(i.system.filter(isSystemDialog));
  const hard = dialogs.filter((a) => a.blocking === 'hard');
  const hardHere = hard.filter((a) => !i.isSubscriptionPage && !isOnCtaRoute(i.pathname, a.cta_url));
  if (hard.length > 0 && hardHere.length === 0) return [];
  const soft = dialogs.filter((a) => a.blocking === 'soft' && a.is_due);
  return [...hardHere, ...soft];
}

/** The dialog slot: the system pager if any system dialog is due, else a feature. */
export function pickAnnouncementDialogs(i: DialogQueueInput): DialogSlotPick {
  if (i.blocked) return null;

  const items = pickSystemDialogs(i);
  if (items.length > 0) return { variant: 'system', items };
  // Exempt here, but it still applies: nothing below it opens.
  if (hasHardSystemDialog(i.system)) return null;

  if (i.softMomentAvailable && i.featuresEnabled && i.pathname === '/') {
    const feature = i.features.find((a) => a.kind === 'feature' && a.is_due && a.dont_show_again_at === null);
    if (feature) return { variant: 'feature', announcement: feature };
  }

  return null;
}

/**
 * The single-row form of `pickAnnouncementDialogs`: the pager's FIRST page, or the
 * feature. Kept for callers that only need to know what comes first.
 */
export function pickAnnouncementDialog(i: DialogQueueInput): DialogPick {
  const pick = pickAnnouncementDialogs(i);
  if (!pick) return null;
  if (pick.variant === 'feature') return { announcement: pick.announcement, variant: 'feature' };
  const first = pick.items[0];
  return { announcement: first, variant: first.blocking === 'hard' ? 'system-hard' : 'system-soft' };
}

/**
 * The banner slot: the first banner that is hard (always shown) or still due.
 * For any list in the server's order (hard first) this is `pickSystemBanners(system)[0]`;
 * the bar itself uses the plural form.
 */
export function pickSystemBanner(system: PortalAnnouncement[]): PortalAnnouncement | null {
  return (
    system.find((a) => a.kind === 'system' && a.display === 'banner' && (a.blocking === 'hard' || a.is_due)) ?? null
  );
}

const isBanner = (a: PortalAnnouncement) => a.kind === 'system' && a.display === 'banner';

/**
 * The banner slot's slides: EVERY banner the bar shows, hard first, then soft.
 *
 *   - every HARD banner, due or not (a hard banner ignores frequency), in the order
 *     given (the admin's drag order);
 *   - then every SOFT banner that is still due, in the order given.
 *
 * A hard banner no longer hides the soft ones (Sep 17 2026): they are all reachable
 * in the slider, and it slides through them by itself, so a soft notice is never
 * starved behind a blocker. Dialogs never enter the bar.
 *
 * An id that repeats keeps its first place (a row is one slide, never two).
 */
export function pickSystemBanners(system: PortalAnnouncement[]): PortalAnnouncement[] {
  const banners = unique(system.filter(isBanner));
  return [...banners.filter((a) => a.blocking === 'hard'), ...banners.filter((a) => a.blocking !== 'hard' && a.is_due)];
}
