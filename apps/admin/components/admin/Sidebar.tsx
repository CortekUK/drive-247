'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useSidebar } from './SidebarContext';
import { useAdminSupport } from '@/lib/use-support-messaging';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSidebarSections, type SidebarSection } from '@/components/admin/sidebar-sections';
import {
  ArrowLeft,
  LayoutDashboard,
  Building2,
  Ban,
  Mail,
  Settings,
  Users,
  ChevronDown,
  LogOut,
  Check,
  ChevronsUpDown,
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
  /*
   * A group opens because you are IN it, not because everything is open.
   *
   * All four started expanded, which put every section's items on screen at
   * once — and once a page began publishing its own sub-options underneath an
   * item, that was a sidebar with open menus everywhere. Only the group
   * holding the current page expands now; the rest stay shut until asked for.
   *
   * `useState` with an initial value rather than an effect: this is the
   * starting position, not a rule. Once you open or close a group by hand it
   * stays as you left it for as long as the sidebar is mounted, which is what
   * makes it a sidebar rather than an accordion that fights you.
   */
  const [isOpen, setIsOpen] = useState(() => group.items.some((item) => isActive(item.href)));

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
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
              <Fragment key={item.name}>
              <Link
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
                    ? 'bg-sidebar-accent text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.12),0_1px_2px_hsl(var(--primary)_/_0.08)]'
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
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A page's sections, as the whole rail.
 *
 * Modelled on Northwind's record rail: a way back at the top, the thing you
 * are inside of, then its own sections — and nothing else. The navigation is
 * not beside it, because the point is that this IS the navigation while the
 * page is open.
 *
 * Buttons, not links: these switch a section on a page that is already open,
 * so there is nothing to navigate to.
 */
function SectionRail({
  registration,
  title,
  onBack,
  onNavigate,
}: {
  registration: NonNullable<ReturnType<typeof useSidebarSections>>;
  title: string;
  onBack: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="px-3">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:min-h-10 md:text-[13px]"
      >
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
        All sections
      </button>

      <p className="px-2 pb-2 text-sm font-semibold text-sidebar-foreground">{title}</p>

      <div className="space-y-0.5">
        {registration.sections.map((section: SidebarSection) => {
          const current = section.id === registration.active;
          return (
            <button
              key={section.id}
              type="button"
              aria-current={current ? 'page' : undefined}
              onClick={() => {
                registration.onSelect(section.id);
                onNavigate?.();
              }}
              className={cn(
                'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] transition-colors md:min-h-9 md:text-[13px]',
                current
                  ? 'bg-sidebar-accent font-medium text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.12)]'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const groups = useNavigation();

  const salesOnly = !!user?.is_sales_agent && !user?.is_super_admin;

  /* The page's own sections, if it published any, and the nav item they
     belong to — which is where the rail's title comes from. */
  const sections = useSidebarSections();
  const [showNav, setShowNav] = useState(false);
  /* The record's own name if it gave one, else the nav item's. */
  const sectionTitle = sections
    ? sections.title ?? groups.flatMap((g) => g.items).find((i) => i.href === sections.href)?.name
    : undefined;

  /* Leaving the page takes its sections with it, so the rail must not stay
     open over the navigation of wherever you landed. */
  useEffect(() => {
    setShowNav(false);
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === '/admin/dashboard') return pathname === href;
    return !!pathname?.startsWith(href);
  };

  /*
   * The rail paints NO background of its own.
   *
   * The shell paints `bg-app-gradient` with `background-attachment: fixed`, so
   * leaving this transparent means it shows the SAME pixels of the same wash
   * the main panel does — not a colour chosen to match, which is a match that
   * drifts the moment either side is adjusted.
   *
   * It was `bg-sidebar` (a pale lavender), then pure white when that was asked
   * for, and both drew a visible seam down the middle of the page. Northwind
   * has no seam: its rail and its content are one surface.
   */
  return (
    <div className="flex flex-col h-full">
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
        {/* A page with its own sections TAKES the rail, rather than hanging
            them off a nav item.

            This is what Northwind does on a record: open a customer and the
            navigation goes, replaced by that customer's own sections with a
            way back above them. The first attempt here nested the rows under
            the item instead, which left the whole nav on screen underneath
            and read as clutter rather than as context.

            `showNav` is the way out. Northwind's back link is a real
            navigation — "All customers" goes to the list — but a top-level
            page like Promo Codes has no list above it, so going back here
            means showing the navigation again rather than leaving the page. */}
        {sections && !showNav ? (
          <SectionRail
            registration={sections}
            title={sectionTitle ?? 'Sections'}
            onBack={() => setShowNav(true)}
            onNavigate={onNavigate}
          />
        ) : (
          groups.map((group) => (
            <NavGroupComponent
              key={group.label}
              group={group}
              isActive={isActive}
              onNavigate={onNavigate}
            />
          ))
        )}
      </div>

      {/* The footer is whichever of two things the page needs.

          ON A RECORD it is that company's controls, and ONLY those. Asked for
          Sep 26 2026: "the admin tab in which sign out option is available —
          do not show that in this page." Which also settles a line from the
          earlier brief that had read as a contradiction: the account options
          belong to the dashboard and the lists, not to an open record.

          EVERYWHERE ELSE it is the account row, and sign out lives in it.

          Sign out is the ONLY one in this app — there is no second path — so
          it is moved, never removed. From a record it is one click away: the
          rail's own "All sections" brings the navigation back, and every page
          there carries it.

          `side="top"` on both, because this is the last thing in the rail and
          a menu opening downward would leave the viewport. */}
      <div className="border-t border-sidebar-border p-2">
        {sections?.actions?.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex min-h-11 w-full items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent md:min-h-0"
                aria-label="Rental settings"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-sidebar-foreground md:text-[13px]">
                    Rental Settings
                  </p>
                  {/* Whose settings these are. On a record the rail is already
                      titled with the company, but the footer is the one part
                      that does not scroll, so it says so too. */}
                  <p className="truncate text-[12px] leading-tight text-muted-foreground md:text-[11px]">
                    {sectionTitle}
                  </p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>

            {/* The actions directly, with no intermediate row: the trigger IS
                "Rental Settings" now, so nesting them behind a second one
                would be the same label twice. */}
            <DropdownMenuContent
              side="top"
              align="start"
              className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 p-1.5"
            >
              {sections.actions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  onClick={() => sections.onAction?.(action.id)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1.5 text-[15px] md:text-[13px]',
                    action.tone === 'destructive' &&
                      'text-destructive focus:bg-destructive/10 focus:text-destructive',
                    action.tone === 'active' && 'bg-primary/10 font-medium text-primary',
                  )}
                >
                  <span>{action.label}</span>
                  {action.tone === 'active' && (
                    <Check className="ml-auto h-4 w-4" aria-hidden="true" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex min-h-11 w-full items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent md:min-h-0"
                aria-label="Account menu"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {user?.email?.[0]?.toUpperCase() || 'A'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-sidebar-foreground md:text-[13px]">
                    {user?.name || user?.email}
                  </p>
                  <p className="truncate text-[12px] leading-tight text-muted-foreground md:text-[11px]">
                    {user?.email}
                  </p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="top"
              align="start"
              className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 p-1.5"
            >
              <DropdownMenuItem
                onClick={() => logout()}
                className="cursor-pointer rounded-lg px-2.5 py-1.5 text-[15px] text-destructive focus:bg-destructive/10 focus:text-destructive md:text-[13px]"
              >
                <LogOut className="mr-2.5 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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

  /*
   * No `border-r`. With the rail transparent the wash already runs through it,
   * and a hairline down the middle is the very seam that was meant to go — the
   * rail and the content are one surface in Northwind, with nothing ruled
   * between them.
   */
  return (
    <div className="hidden md:flex flex-col h-screen w-[260px] flex-shrink-0">
      <SidebarContent />
    </div>
  );
}
