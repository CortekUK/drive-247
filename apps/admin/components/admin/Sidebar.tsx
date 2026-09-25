'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useSidebar } from './SidebarContext';
import { useAdminSupport } from '@/lib/use-support-messaging';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Building2,
  Ban,
  Mail,
  Settings,
  Users,
  ChevronDown,
  LogOut,
  ScrollText,
  Scale,
  ListChecks,
  ClipboardCheck,
  ArrowUpCircle,
  Megaphone,
  MessageSquareText,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Activity,
  BookOpen,
  BadgeDollarSign,
  BellRing,
  TicketPercent,
  Plug,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  badgeCount?: number;
  badgeUnavailable?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function useNavigation() {
  const { user } = useAuthStore();
  const support = useAdminSupport();

  const salesOnly = !!user?.is_sales_agent && !user?.is_super_admin;

  const salesGroup: NavGroup = {
    label: 'Sales',
    items: [
      { name: 'Onboarding', href: '/admin/sales', icon: TrendingUp },
      // Drive247 subscription promo codes + operator referral links.
      { name: 'Promo Codes', href: '/admin/promo-codes', icon: TicketPercent },
    ],
  };

  // Sales agents (without super admin) only see the Sales group.
  if (salesOnly) {
    return [salesGroup];
  }

  const groups: NavGroup[] = [
    salesGroup,
    {
      label: 'Overview',
      items: [
        { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
      ],
    },
    {
      label: 'Monitoring',
      items: [
        { name: 'Platform Rentals', href: '/admin/platform-rentals', icon: Activity },
      ],
    },
    {
      label: 'Management',
      items: [
        { name: 'Rental Companies', href: '/admin/rentals', icon: Building2 },
        { name: 'Signup Plans', href: '/admin/signup-plans', icon: BadgeDollarSign },
        { name: 'Global Blacklist', href: '/admin/blacklist', icon: Ban },
        { name: 'Contact Requests', href: '/admin/contacts', icon: Mail },
        // Keep the destination discoverable when support is unconfigured or offline.
        // The page and API still require the separate, server-verified support grant.
        ...(user?.is_super_admin ? [{ name: 'Support', href: '/admin/support', icon: MessageSquareText, badgeCount: support.allowed ? support.count ?? undefined : undefined, badgeUnavailable: support.allowed && support.count === null }] : []),
        { name: 'Mode Requests', href: '/admin/requests', icon: ArrowUpCircle },
        { name: 'Announcements', href: '/admin/announcements', icon: Megaphone },
        { name: 'Welcome Pack', href: '/admin/welcome-pack', icon: BookOpen },
        { name: 'Feedbacks', href: '/admin/feedbacks', icon: MessageSquareText },
        { name: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
        { name: 'OpenAI Usage', href: '/admin/openai-usage', icon: Sparkles },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { name: 'Settings', href: '/admin/settings', icon: Settings },
        // Premium integrations: which are paid, their monthly price, first
        // month free, and the hide / beta / not-available flags on the
        // operator's Integrations page. Platform-wide; super admins only (the
        // catalog table's RLS says so too). docs/integration-billing.
        ...(user?.is_super_admin
          ? [{ name: 'Integrations', href: '/admin/integrations', icon: Plug }]
          : []),
        // The platform's own notification set: what we send operators, what
        // operators send us, and what we broadcast to everyone. Separate from
        // Settings because it saves to its own table with its own dirty guard.
        // Super admins only — the page and the table's RLS say so too.
        ...(user?.is_super_admin
          ? [{ name: 'Notifications', href: '/admin/notifications', icon: BellRing }]
          : []),
        // Terms of Service and Privacy Policy, as served at drive-247.com.
        // Not a tenant's rental terms — those are per-tenant CMS content and a
        // different contract entirely. See ops/platform_legal_documents.sql.
        { name: 'Legal Pages', href: '/admin/legal', icon: Scale },
        // The first-run wizard's questions. Platform-wide, not per-tenant.
        { name: 'Onboarding Questions', href: '/admin/onboarding-questions', icon: ListChecks },
        // The features an operator has to sit down with once — auto-extension,
        // installments, pay-as-you-go, Bonzah — each with the video or the
        // written guide that explains it. Platform-wide, not per-tenant, and
        // NOT the Welcome Pack above: that is the full manual, this is the
        // short list of things that cost a live walkthrough every time.
        { name: 'Setup Checklist', href: '/admin/setup-checklist', icon: ClipboardCheck },
        ...(user?.is_primary_super_admin
          ? [{ name: 'Manage Admins', href: '/admin/admins', icon: Users }]
          : []),
      ],
    },
  ];

  return groups;
}

function NavGroupComponent({
  group,
  isActive,
  onNavigate,
}: {
  group: NavGroup;
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        {group.label}
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            !isOpen && '-rotate-90'
          )}
        />
      </button>
      {isOpen && (
        <div className="mt-1 space-y-0.5 px-3">
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            const showBadge = (item.badgeCount ?? 0) > 0 || item.badgeUnavailable;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  /* Below `md` this sidebar is the sheet behind the header's
                     menu and the only navigation on the screen, so its rows
                     carry a 44px target and a readable label; from `md` up it
                     is the desktop rail again at exactly the density it had.
                     Same pair the portal's rail uses. */
                  'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium transition-all duration-200',
                  'md:min-h-0 md:text-[13px]',
                  active
                    ? 'bg-primary/15 text-primary glow-purple'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Icon className={cn("size-[18px] md:size-4", active && "text-primary")} />
                <span className="flex-1">{item.name}</span>
                {showBadge && (
                  <span
                    title={item.badgeUnavailable ? 'Unread count unavailable. Reconnecting…' : undefined}
                    className={cn(
                      'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    )}
                  >
                    {item.badgeUnavailable ? '?' : item.badgeCount! > 99 ? '99+' : item.badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const groups = useNavigation();

  const salesOnly = !!user?.is_sales_agent && !user?.is_super_admin;

  const isActive = (href: string) => {
    if (href === '/admin/dashboard') return pathname === href;
    return !!pathname?.startsWith(href);
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 h-16 px-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/15 glow-purple-sm">
          <span className="text-primary font-bold text-sm">D</span>
        </div>
        <div>
          <h1 className="text-sm font-semibold text-sidebar-foreground">Drive247</h1>
          <p className="text-[10px] text-sidebar-muted">
            {salesOnly ? 'Sales Agent' : 'Super Admin'}
          </p>
        </div>
      </div>

      {/* Navigation */}
      {/* A plain scroller, not a Radix ScrollArea: that renders a visible
          bar down the inside edge of the navigation, and Northwind's rail
          shows none. Same `no-scrollbar` the portal's sidebar body uses. */}
      <div className="no-scrollbar flex-1 overflow-y-auto py-4">
        {groups.map((group) => (
          <NavGroupComponent
            key={group.label}
            group={group}
            isActive={isActive}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/15 text-primary text-xs font-bold">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] md:text-[13px] font-medium text-sidebar-foreground truncate">
              {user?.name || user?.email}
            </p>
            {user?.is_primary_super_admin && (
              <span className="inline-flex items-center mt-0.5 px-1.5 py-0 text-[10px] font-semibold rounded-full bg-primary/15 text-primary border border-primary/30">
                Primary Admin
              </span>
            )}
          </div>
        </div>
        <Separator className="mb-3 bg-sidebar-border" />
        <button
          onClick={() => logout()}
          className="flex min-h-11 md:min-h-0 items-center gap-2 w-full px-3 py-2 rounded-lg text-[15px] md:text-[13px] font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/** `desktop={false}`: the phone sheet only — Support's rail has the desktop slot. */
export default function Sidebar({ desktop = true }: { desktop?: boolean } = {}) {
  const { isMobile, isOpen, close } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={close}>
        <SheetContent side="left" className="p-0 w-[260px] border-r-0">
          <SidebarContent onNavigate={close} />
        </SheetContent>
      </Sheet>
    );
  }

  if (!desktop) return null;

  return (
    <div className="hidden md:flex flex-col h-screen w-[260px] border-r border-sidebar-border flex-shrink-0">
      <SidebarContent />
    </div>
  );
}
