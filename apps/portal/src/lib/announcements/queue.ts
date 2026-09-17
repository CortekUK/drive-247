/**
 * Which announcement surface gets the screen. Pure: no React, no clock, no DOM.
 *
 * The rows arrive from `get_portal_announcements` already targeted and already in
 * priority order (system first, hard first, then the admin's drag order), and with
 * `is_due` merged with this session's local dismissals by `usePortalAnnouncements`.
 * So "first matching row" IS "highest priority" here, and neither function sorts.
 *
 * Two slots, picked independently:
 *   - the banner slot: ONE full-width bar. When several banners are due it rotates
 *     through them (pickSystemBanners); pickSystemBanner is its first-row form;
 *   - the dialog slot: at most ONE announcement dialog (pickAnnouncementDialog).
 *
 * The dialog rules, in order (spec §3.3):
 *   1. anything else owns the screen (a code-driven gate, a tour, another modal)
 *      -> nothing;
 *   2. a HARD system dialog applies -> the first one not exempt on this route, or
 *      nothing at all when every one is exempt here. A hard blocker suppresses every
 *      soft and feature dialog even where it is itself hidden ("while migration is
 *      pending, new features don't matter");
 *   3. a soft dialog already opened in this moment (app load or route change)
 *      -> nothing, so soft dialogs never chain back-to-back;
 *   4. the first due soft system dialog;
 *   5. on the dashboard only, and only where the v2 dashboard exists, the first due
 *      feature the user has not asked to stop seeing;
 *   6. nothing.
 */

import { isOnCtaRoute, type PortalAnnouncement } from '@/lib/announcements/contract';

export interface DialogQueueInput {
  system: PortalAnnouncement[];
  features: PortalAnnouncement[];
  featuresEnabled: boolean;
  pathname: string;
  /** The layout's `isSubscriptionPage`: /subscription, /credits, /settings*, /dev in development. */
  isSubscriptionPage: boolean;
  /** Something else owns the screen (see useAnnouncementBlocked). */
  blocked: boolean;
  /** False once a soft or feature dialog has opened in the current moment. */
  softMomentAvailable: boolean;
}

export type DialogPick = {
  announcement: PortalAnnouncement;
  variant: 'system-hard' | 'system-soft' | 'feature';
} | null;

const isHardSystemDialog = (a: PortalAnnouncement) =>
  a.kind === 'system' && a.display === 'dialog' && a.blocking === 'hard';

export function pickAnnouncementDialog(i: DialogQueueInput): DialogPick {
  if (i.blocked) return null;

  const hard = i.system.filter(isHardSystemDialog);
  if (hard.length > 0) {
    const shown = hard.find((a) => !i.isSubscriptionPage && !isOnCtaRoute(i.pathname, a.cta_url));
    return shown ? { announcement: shown, variant: 'system-hard' } : null;
  }

  if (!i.softMomentAvailable) return null;

  const soft = i.system.find(
    (a) => a.kind === 'system' && a.display === 'dialog' && a.blocking === 'soft' && a.is_due,
  );
  if (soft) return { announcement: soft, variant: 'system-soft' };

  if (i.featuresEnabled && i.pathname === '/') {
    const feature = i.features.find((a) => a.kind === 'feature' && a.is_due && a.dont_show_again_at === null);
    if (feature) return { announcement: feature, variant: 'feature' };
  }

  return null;
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
 * The banner slot's rotation: every banner the bar may show, in the order given
 * (the server's priority order: hard first, then the admin's drag order).
 *
 * HARD BANNERS ONLY WHILE ANY APPLIES. If one or more hard banners are present, the
 * list is exactly those hard banners, due or not (a hard banner ignores frequency),
 * and every soft banner waits, due or not. A blocker must never be rotated away by
 * a soft notice. Only when no hard banner applies does the list hold the soft
 * banners that are due.
 *
 * An id that repeats keeps its first place (a row is one slide, never two).
 */
export function pickSystemBanners(system: PortalAnnouncement[]): PortalAnnouncement[] {
  const banners: PortalAnnouncement[] = [];
  const seen = new Set<string>();
  for (const a of system) {
    if (!isBanner(a) || seen.has(a.id)) continue;
    seen.add(a.id);
    banners.push(a);
  }
  const hard = banners.filter((a) => a.blocking === 'hard');
  return hard.length > 0 ? hard : banners.filter((a) => a.is_due);
}
