import {
  Bell,
  CalendarDays,
  CreditCard,
  FileSignature,
  FileText,
  House,
  MessageSquare,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-nw';

/**
 * Customer portal v2's destinations, grouped the way the operator portal v2
 * sidebar groups its own. Every screen lives under /portal-v2 and does what
 * the current portal's does (ported from (northwind)/northwind-site/(portal)).
 */
export interface PortalV2NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The same screen in the current portal. */
  v1Href: string;
  built: boolean;
}

export interface PortalV2NavGroup {
  label: string | null;
  items: readonly PortalV2NavItem[];
}

export const PORTAL_V2_BASE = '/portal-v2';

export const PORTAL_V2_NAV: readonly PortalV2NavGroup[] = [
  {
    label: null,
    items: [{ href: '/portal-v2', label: 'Home', icon: House, v1Href: '/portal', built: true }],
  },
  {
    label: 'Your rentals',
    items: [
      { href: '/portal-v2/bookings', label: 'Bookings', icon: CalendarDays, v1Href: '/portal/bookings', built: true },
      { href: '/portal-v2/agreements', label: 'Agreements', icon: FileSignature, v1Href: '/portal/agreements', built: true },
      { href: '/portal-v2/payments', label: 'Payments', icon: CreditCard, v1Href: '/portal/payments', built: true },
    ],
  },
  {
    label: 'You',
    items: [
      { href: '/portal-v2/documents', label: 'Documents', icon: FileText, v1Href: '/portal/documents', built: true },
      { href: '/portal-v2/verification', label: 'ID verification', icon: ShieldCheck, v1Href: '/portal/verification', built: true },
      { href: '/portal-v2/messages', label: 'Messages', icon: MessageSquare, v1Href: '/portal/messages', built: true },
      { href: '/portal-v2/notifications', label: 'Notifications', icon: Bell, v1Href: '/portal/notifications', built: true },
      { href: '/portal-v2/settings', label: 'Settings', icon: Settings, v1Href: '/portal/settings', built: true },
    ],
  },
];

export const PORTAL_V2_ITEMS: readonly PortalV2NavItem[] = PORTAL_V2_NAV.flatMap((group) => group.items);

/** `/portal-v2` matches exactly; everything else on a path-segment boundary. */
export function isPortalV2Active(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === PORTAL_V2_BASE) return pathname === PORTAL_V2_BASE;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item that owns a pathname, for the top bar's title. */
export function portalV2ItemFor(pathname: string | null): PortalV2NavItem | null {
  return PORTAL_V2_ITEMS.find((item) => isPortalV2Active(item.href, pathname)) ?? null;
}
