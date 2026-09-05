import {
  Bell,
  CalendarDays,
  CreditCard,
  FileSignature,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

/**
 * The portal's destinations.
 *
 * `built: false` items are REACHABLE and render a real, explained placeholder
 * rather than 404-ing or being hidden. Hiding them would be the tidier-looking
 * choice and the wrong one: the customer has documents to sign and payments
 * taken against their booking, and a portal that silently omits both reads as a
 * portal that does not have them. Saying "not here yet, here is where it will
 * be" is the honest state. Flip the flag when the page lands; nothing else in
 * the nav needs to change.
 */
export interface PortalNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Short line shown under the label in the mobile drawer. */
  hint: string;
  built: boolean;
}

export const PORTAL_NAV: readonly PortalNavItem[] = [
  {
    href: '/portal',
    label: 'Overview',
    icon: LayoutDashboard,
    hint: 'Your next trip at a glance',
    built: true,
  },
  {
    href: '/portal/bookings',
    label: 'My Bookings',
    icon: CalendarDays,
    hint: 'Every rental, past and upcoming',
    built: true,
  },
  {
    href: '/portal/agreements',
    label: 'Agreements',
    icon: FileSignature,
    hint: 'Sign and download your rental agreements',
    built: true,
  },
  {
    href: '/portal/documents',
    label: 'Documents',
    icon: FileText,
    hint: 'Licence, ID and insurance',
    built: true,
  },
  {
    href: '/portal/verification',
    label: 'ID verification',
    icon: ShieldCheck,
    hint: 'Your identity check and documents',
    built: true,
  },
  {
    href: '/portal/payments',
    label: 'Payments',
    icon: CreditCard,
    hint: 'Invoices, receipts and instalments',
    built: true,
  },
  {
    href: '/portal/messages',
    label: 'Messages',
    icon: MessageSquare,
    hint: 'Ask us about your booking',
    built: true,
  },
  {
    href: '/portal/notifications',
    label: 'Notifications',
    icon: Bell,
    hint: 'Updates about your bookings',
    built: true,
  },
  {
    href: '/portal/settings',
    label: 'Settings',
    icon: Settings,
    hint: 'Your details and preferences',
    built: true,
  },
] as const;

/**
 * Which nav item owns a pathname.
 *
 * `/portal` has to be matched exactly, or it stays highlighted on every child
 * route and the sidebar shows two active items at once. Everything else matches
 * on a path-segment boundary, so `/portal/bookings/abc` lights up "My Bookings"
 * but a hypothetical `/portal/bookings-archive` would not.
 */
export function isPortalNavItemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === '/portal') return pathname === '/portal';
  return pathname === href || pathname.startsWith(`${href}/`);
}
