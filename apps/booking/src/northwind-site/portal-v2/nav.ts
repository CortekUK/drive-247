import { House, type LucideIcon } from 'lucide-react-nw';
import type { ComponentType, SVGProps } from 'react';

import { NavAgreements, NavFinances, NavInsurances, NavRentals } from '@portal-v2-shared/nav-icons/nav-icons';

/**
 * Customer portal v2's destinations: one list, straight through, as the owner
 * asked (Oct 21 2026) — no group headings, no split.
 *
 * NAMES AND ICONS ARE THE OPERATOR RAIL'S (app-sidebar-v2.tsx). Every tab that
 * also exists there carries its name and its icon from the shared v2 set
 * (shared/portal-v2/nav-icons), in the operator's order: Rentals, Insurances,
 * Agreements, Finances. Home is the one the operator does not have.
 *
 * Settings is not a tab: it is the gear on the profile row, as on the
 * operator rail, and ID verification and Gig driver live inside it. Messages
 * and notifications are the top bar's sheets. Documents became Insurances.
 */
export type PortalV2NavIcon = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>;

export interface PortalV2NavItem {
  href: string;
  label: string;
  icon: PortalV2NavIcon;
  /** Always in the rail: the customiser shows a lock instead of a hide button. */
  locked?: boolean;
}

export const PORTAL_V2_BASE = '/portal';

export const PORTAL_V2_ITEMS: readonly PortalV2NavItem[] = [
  { href: '/portal', label: 'Home', icon: House, locked: true },
  { href: '/portal/rentals', label: 'Rentals', icon: NavRentals },
  { href: '/portal/insurances', label: 'Insurances', icon: NavInsurances },
  { href: '/portal/agreements', label: 'Agreements', icon: NavAgreements },
  { href: '/portal/payments', label: 'Finances', icon: NavFinances },
];

/** Pages reachable from search that are not rail tabs. */
export const PORTAL_V2_EXTRA_PAGES: readonly { href: string; label: string }[] = [
  { href: '/portal/settings', label: 'Settings' },
  { href: '/portal/settings?section=profile', label: 'My profile' },
  { href: '/portal/settings?section=verification', label: 'Verification' },
];

/** `/portal` matches exactly; everything else on a path-segment boundary. */
export function isPortalV2Active(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === PORTAL_V2_BASE) return pathname === PORTAL_V2_BASE;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item that owns a pathname, for the top bar's title. */
export function portalV2ItemFor(pathname: string | null): PortalV2NavItem | null {
  return PORTAL_V2_ITEMS.find((item) => isPortalV2Active(item.href, pathname)) ?? null;
}

/* ───────────────────────────── customisation ───────────────────────────── */

/** The customer's own arrangement of the rail: an order and what is hidden. */
export interface PortalV2NavPreferences {
  order: string[];
  hidden: string[];
}

export const DEFAULT_NAV_PREFERENCES: PortalV2NavPreferences = { order: [], hidden: [] };

/**
 * The rail after the customer's preferences: their order first (unknown
 * hrefs dropped, new tabs appended in default order), hidden tabs removed,
 * locked tabs never hidden.
 */
export function arrangePortalV2Nav(prefs: PortalV2NavPreferences): { shown: PortalV2NavItem[]; hidden: PortalV2NavItem[] } {
  const byHref = new Map(PORTAL_V2_ITEMS.map((item) => [item.href, item]));
  const ordered: PortalV2NavItem[] = [];
  for (const href of prefs.order) {
    const item = byHref.get(href);
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  for (const item of PORTAL_V2_ITEMS) if (!ordered.includes(item)) ordered.push(item);
  // Home leads, always.
  const home = ordered.filter((item) => item.locked);
  const rest = ordered.filter((item) => !item.locked);
  const all = [...home, ...rest];
  return {
    shown: all.filter((item) => item.locked || !prefs.hidden.includes(item.href)),
    hidden: all.filter((item) => !item.locked && prefs.hidden.includes(item.href)),
  };
}

export function parseNavPreferences(raw: string | null): PortalV2NavPreferences {
  if (!raw) return DEFAULT_NAV_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<PortalV2NavPreferences>;
    return {
      order: Array.isArray(value.order) ? value.order.filter((v): v is string => typeof v === 'string') : [],
      hidden: Array.isArray(value.hidden) ? value.hidden.filter((v): v is string => typeof v === 'string') : [],
    };
  } catch {
    return DEFAULT_NAV_PREFERENCES;
  }
}
