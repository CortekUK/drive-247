'use client';

/**
 * Super Admin's navigation, in the shape Northwind's rail draws it:
 *
 *   quick     — the rows above the rule (Dashboard, Support)
 *   topLevel  — the three things reached for all day
 *   more      — flat rows under a "More" caption
 *   groups    — drill-in sections under the same caption; pressing one
 *               replaces the rail with its items and a way back
 *
 * Settings is not a row: as in Northwind it is the gear on the profile row in
 * the sidebar footer.
 *
 * One provider, because two things read it — the sidebar and the top bar's
 * ⌘K search (which offers every page) — and the Support unread count behind
 * it runs its own polling client. Two `useAdminSupport()` calls would be two
 * clients polling the same thing.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowUpCircle,
  BadgeDollarSign,
  Ban,
  BellRing,
  BookOpen,
  Building2,
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
  SlidersHorizontal,
  Sparkles,
  TicketPercent,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useAdminSupport } from '@/lib/use-support-messaging';

export interface AdminNavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** Unread / pending count. Rendered only when above zero. */
  badge?: number;
  /** The count could not be read — shown as "?" rather than as nothing. */
  badgeUnavailable?: boolean;
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
  /** Every destination once, for search. Includes Settings. */
  all: AdminNavItem[];
  /** Settings gear on the profile row. Sales-only users never get it. */
  settings: AdminNavItem | null;
  /** Support unread, for the top bar. null = unknown or not permitted. */
  supportCount: number | null;
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
        all: sales,
        settings: null,
        supportCount: null,
        salesOnly,
      };
    }

    const quick: AdminNavItem[] = [
      { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutGrid },
      // Kept discoverable when support is unconfigured or offline; the page and
      // API still require the separate, server-verified support grant.
      ...(isSuper
        ? [
            {
              name: 'Support',
              href: '/admin/support',
              icon: LifeBuoy,
              badge: supportCount ?? undefined,
              badgeUnavailable: supportUnavailable,
            },
          ]
        : []),
    ];

    const topLevel: AdminNavItem[] = [
      { name: 'Rental Companies', href: '/admin/rentals', icon: Building2 },
      { name: 'Platform Rentals', href: '/admin/platform-rentals', icon: Activity },
      { name: 'Mode Requests', href: '/admin/requests', icon: ArrowUpCircle },
    ];

    const more: AdminNavItem[] = [
      { name: 'Announcements', href: '/admin/announcements', icon: Megaphone },
      { name: 'Feedbacks', href: '/admin/feedbacks', icon: MessageSquareText },
      { name: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
    ];

    const groups: AdminNavGroup[] = [
      { label: 'Sales', icon: TrendingUp, items: sales },
      {
        label: 'Management',
        icon: Wrench,
        items: [
          { name: 'Signup Plans', href: '/admin/signup-plans', icon: BadgeDollarSign },
          { name: 'Global Blacklist', href: '/admin/blacklist', icon: Ban },
          { name: 'Contact Requests', href: '/admin/contacts', icon: Mail },
          { name: 'Welcome Pack', href: '/admin/welcome-pack', icon: BookOpen },
          { name: 'OpenAI Usage', href: '/admin/openai-usage', icon: Sparkles },
        ],
      },
      {
        label: 'Configuration',
        icon: SlidersHorizontal,
        items: [
          // Premium integrations and their prices. Super admins only (the
          // catalog table's RLS says so too). docs/integration-billing.
          ...(isSuper ? [{ name: 'Integrations', href: '/admin/integrations', icon: Plug }] : []),
          // The platform's own notification set. Super admins only.
          ...(isSuper ? [{ name: 'Notifications', href: '/admin/notifications', icon: BellRing }] : []),
          // drive-247.com's Terms and Privacy — not a tenant's rental terms.
          { name: 'Legal Pages', href: '/admin/legal', icon: Scale },
          // The first-run wizard's questions. Platform-wide.
          { name: 'Onboarding Questions', href: '/admin/onboarding-questions', icon: ListChecks },
          // The short list of features that cost a live walkthrough.
          { name: 'Setup Checklist', href: '/admin/setup-checklist', icon: ClipboardCheck },
          ...(isPrimary ? [{ name: 'Manage Admins', href: '/admin/admins', icon: Users }] : []),
        ],
      },
    ];

    const all = [...quick, ...topLevel, ...more, ...groups.flatMap((g) => g.items), SETTINGS];

    return { quick, topLevel, more, groups, all, settings: SETTINGS, supportCount, salesOnly };
  }, [salesOnly, isSuper, isPrimary, supportCount, supportUnavailable]);
}

const AdminNavContext = createContext<AdminNav | null>(null);

export function AdminNavProvider({ children }: { children: ReactNode }) {
  const nav = useBuildNav();
  return <AdminNavContext.Provider value={nav}>{children}</AdminNavContext.Provider>;
}

export function useAdminNav(): AdminNav {
  const nav = useContext(AdminNavContext);
  if (!nav) throw new Error('useAdminNav must be used within AdminNavProvider');
  return nav;
}

/** Dashboard matches exactly; everything else owns its sub-routes. */
export function isNavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/admin/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
