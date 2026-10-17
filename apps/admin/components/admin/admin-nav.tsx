'use client';

/**
 * Super Admin's navigation, in the shape Northwind's rail draws it:
 *
 *   quick     — the rows above the rule (none today)
 *   topLevel  — the three things reached for all day
 *   more      — flat rows under a "More" caption
 *   groups    — drill-in sections under the same caption; pressing one
 *               replaces the rail with its items and a way back
 *
 * Settings is not a row: as in Northwind it is the gear on the profile row in
 * the sidebar footer.
 *
 *   developer — the other side of the Admin | Developer switch at the top of
 *               the rail (Northwind's Portal | Website pill). Super admins only.
 *
 * One provider, because two things read it — the sidebar and the top bar's
 * ⌘K search (which offers every page) — and the Support unread count behind
 * it runs its own polling client. Two `useAdminSupport()` calls would be two
 * clients polling the same thing.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpCircle,
  Eye,
  FlaskConical,
  Rocket,
  BadgeDollarSign,
  Ban,
  BellRing,
  MailCheck,
  BookOpen,
  Building2,
  HeartPulse,
  ClipboardCheck,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  Mail,
  Megaphone,
  MessageSquareText,
  Plug,
  Scale,
  ScrollText,
  Settings,
  Sparkles,
  TicketPercent,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useAdminSupport } from '@/lib/use-support-messaging';
import { applyAdminNavPreferences, useAdminNavPreferences } from '@/lib/admin-nav-preferences';

export interface AdminNavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** Unread / pending count. Rendered only when above zero. */
  badge?: number;
  /** The count could not be read — shown as "?" rather than as nothing. */
  badgeUnavailable?: boolean;
  /** Opens in its own browser tab (Support is a separate workspace). */
  newTab?: boolean;
}

export interface AdminNavGroup {
  label: string;
  icon: LucideIcon;
  items: AdminNavItem[];
}

export interface AdminNav {
  quick: AdminNavItem[];
  topLevel: AdminNavItem[];
  more: AdminNavItem[];
  groups: AdminNavGroup[];
  /** The Developer side of the rail's switch. Empty for anyone but a super admin. */
  developer: AdminNavItem[];
  /** Every destination once, for search. Includes Settings. */
  all: AdminNavItem[];
  /** `topLevel` as it ships, before the user's Customise sidebar is applied. */
  defaultTopLevel: AdminNavItem[];
  /** Pages off the sidebar that Customise sidebar offers to add. */
  extras: AdminNavItem[];
  /** Settings gear on the profile row. Sales-only users never get it. */
  settings: AdminNavItem | null;
  /** Support unread, for the top bar. null = unknown or not permitted. */
  supportCount: number | null;
  /** The top bar's Support button. Not a sidebar row. null = not permitted. */
  support: AdminNavItem | null;
  salesOnly: boolean;
}

const SETTINGS: AdminNavItem = { name: 'Settings', href: '/admin/settings', icon: Settings };

function useBuildNav(): AdminNav {
  const { user } = useAuthStore();
  const support = useAdminSupport();

  const salesOnly = !!user?.is_sales_agent && !user?.is_super_admin;
  const isSuper = !!user?.is_super_admin;
  const isPrimary = !!user?.is_primary_super_admin;
  const supportCount = isSuper && support.allowed ? (support.count ?? null) : null;
  const supportUnavailable = isSuper && support.allowed && support.count === null;

  return useMemo(() => {
    const sales: AdminNavItem[] = [
      { name: 'Onboarding', href: '/admin/sales', icon: TrendingUp },
      // Drive247 subscription promo codes + operator referral links.
      { name: 'Promo Codes', href: '/admin/promo-codes', icon: TicketPercent },
    ];

    // A sales agent without super admin sees the Sales pages and nothing else;
    // the layout redirects them away from anything else anyway.
    if (salesOnly) {
      return {
        quick: [],
        topLevel: sales,
        more: [],
        groups: [],
        developer: [],
        all: sales,
        defaultTopLevel: sales,
        extras: [],
        settings: null,
        supportCount: null,
        support: null,
        salesOnly,
      };
    }

    // Empty: Dashboard heads the one flat list below, with no rule under it
    // (Ghulam, Oct 17 2026).
    const quick: AdminNavItem[] = [];

    // Support is off the sidebar; it stays reachable from ⌘K search and the
    // top bar's unread count. The page and API still verify super admin.
    const supportRow: AdminNavItem[] = isSuper
      ? [
          {
            name: 'Support',
            href: '/admin/support',
            icon: LifeBuoy,
            badge: supportCount ?? undefined,
            badgeUnavailable: supportUnavailable,
            newTab: true,
          },
        ]
      : [];

    // One flat list, no group captions (Ghulam, Oct 17 2026). `more` and
    // `groups` stay in the shape for the rail, and are simply empty.
    const topLevel: AdminNavItem[] = [
      // The default order (Ghulam, Oct 17 2026): the companies and how they
      // arrive first, then what they are told, sold and charged, then the
      // inbound queues. Each user can still rearrange it (Customise sidebar).
      { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutGrid },
      { name: 'Rental Companies', href: '/admin/rentals', icon: Building2 },
      sales[0], // Onboarding
      // Premium integrations and their prices. Super admins only (the
      // catalog table's RLS says so too). docs/integration-billing.
      ...(isSuper ? [{ name: 'Integrations', href: '/admin/integrations', icon: Plug }] : []),
      { name: 'Announcements', href: '/admin/announcements', icon: Megaphone },
      sales[1], // Promo Codes
      { name: 'Signup Plans', href: '/admin/signup-plans', icon: BadgeDollarSign },
      { name: 'Contact Requests', href: '/admin/contacts', icon: Mail },
      { name: 'Global Blacklist', href: '/admin/blacklist', icon: Ban },
      { name: 'Feedbacks', href: '/admin/feedbacks', icon: MessageSquareText },
      // Customer Management is the Retention side of the rail's switch.
      // Notifications, Legal Pages, Onboarding Questions, Setup Checklist,
      // Audit Logs, OpenAI Usage and Manage Admins are cards on Settings.
    ];

    const more: AdminNavItem[] = [];

    const groups: AdminNavGroup[] = [];

    // The development environment: everything that drives the Northwind canary
    // or rehearses a real flow. Not on the sidebar — Settings → Developer lists
    // them — but kept here so ⌘K search still finds every one.
    const developer: AdminNavItem[] = isSuper
      ? [
          { name: 'Signup Rehearsal', href: '/admin/developer', icon: FlaskConical },
          { name: 'Northwind Onboarding', href: '/admin/developer/northwind', icon: Rocket },
          { name: 'Customer Management', href: '/admin/developer/customer-management', icon: Mail },
          { name: 'Previews', href: '/admin/developer/previews', icon: Eye },
        ]
      : [];

    // Off the sidebar but still live: reached from ⌘K search and direct links.
    const hidden: AdminNavItem[] = [
      { name: 'Mode Requests', href: '/admin/requests', icon: ArrowUpCircle },
      { name: 'Welcome Pack', href: '/admin/welcome-pack', icon: BookOpen },
      // A section of Customer Management now; the old route redirects there.
      { name: 'Customer Health Score', href: '/admin/customer-management?section=health', icon: HeartPulse },
      // The Retention side of the switch. In `all` so ⌘K search and the
      // section rail can still name it.
      ...(isSuper ? [{ name: 'Customer Management', href: RETENTION_ROOT, icon: MailCheck }] : []),
      // Opened from the Settings index.
      { name: 'OpenAI Usage', href: '/admin/openai-usage', icon: Sparkles },
      ...(isSuper ? [{ name: 'Notifications', href: '/admin/notifications', icon: BellRing }] : []),
      { name: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
      { name: 'Legal Pages', href: '/admin/legal', icon: Scale },
      { name: 'Onboarding Questions', href: '/admin/onboarding-questions', icon: ListChecks },
      { name: 'Setup Checklist', href: '/admin/setup-checklist', icon: ClipboardCheck },
      ...(isPrimary ? [{ name: 'Manage Admins', href: '/admin/admins', icon: Users }] : []),
    ];

    const all = [...quick, ...supportRow, ...hidden, ...topLevel, ...more, ...groups.flatMap((g) => g.items), ...developer, SETTINGS];

    // Everything off the sidebar that a user may put back on it. Customer
    // Management is left out: it is the Retention side of the switch.
    const extras = hidden.filter((item) => item.href !== RETENTION_ROOT);

    return {
      quick,
      topLevel,
      more,
      groups,
      developer,
      all,
      defaultTopLevel: topLevel,
      extras,
      settings: SETTINGS,
      supportCount,
      support: supportRow[0] ?? null,
      salesOnly,
    };
  }, [salesOnly, isSuper, isPrimary, supportCount, supportUnavailable]);
}

const AdminNavContext = createContext<AdminNav | null>(null);

export function AdminNavProvider({ children }: { children: ReactNode }) {
  const built = useBuildNav();
  const { user } = useAuthStore();
  // The user's own arrangement (Customise sidebar), applied over the default.
  // Sales-only accounts have nothing to arrange.
  const { preferences } = useAdminNavPreferences(built.salesOnly ? null : user?.id);
  const nav = useMemo(
    () =>
      built.salesOnly
        ? built
        : { ...built, topLevel: applyAdminNavPreferences(built.defaultTopLevel, built.extras, preferences) },
    [built, preferences],
  );
  return <AdminNavContext.Provider value={nav}>{children}</AdminNavContext.Provider>;
}

export function useAdminNav(): AdminNav {
  const nav = useContext(AdminNavContext);
  if (!nav) throw new Error('useAdminNav must be used within AdminNavProvider');
  return nav;
}

/** The rail's two sides. The Developer side is every page under /admin/developer. */
/**
 * The rail's two sides (the Admin | Retention switch under the org row).
 * Retention is Customer Management — health score, onboarding and lifecycle
 * emails, cancellations, retention offers — whose own sections fill the rail.
 */
export type AdminView = 'admin' | 'retention';

export const DEVELOPER_ROOT = '/admin/developer';
export const RETENTION_ROOT = '/admin/customer-management';

/** Read from the URL, never stored, so a reload or a shared link shows the right side. */
export function viewOf(pathname: string | null): AdminView {
  return pathname === RETENTION_ROOT || !!pathname?.startsWith(`${RETENTION_ROOT}/`) ? 'retention' : 'admin';
}

/** Dashboard and the Developer root match exactly; everything else owns its sub-routes. */
export function isNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/admin/dashboard' || href === DEVELOPER_ROOT) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
