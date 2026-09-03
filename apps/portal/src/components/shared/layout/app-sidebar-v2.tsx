"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// The source worktree draws this sidebar in `@phosphor-icons/react`, which is
// not a dependency here and is not being added for a canary. Every icon below
// is the closest lucide equivalent; the aliases keep the source's own names so
// the markup reads the same:
//   SquaresFour→LayoutGrid  CalendarDots→CalendarDays  Prohibit→Ban
//   WarningCircle→BadgeAlert  ChartBar→BarChart3  ClockCounterClockwise→History
//   Gear→Settings  House→Home  EnvelopeSimple→Mail  Article→Newspaper
//   CaretRight→ChevronRight  MagnifyingGlass→Search  Tray→Inbox  Money→Banknote
//   ChatCircle→MessageSquare  Buildings→Building2  Plugs→Plug
//   CurrencyCircleDollar→CircleDollarSign  TrendUp→TrendingUp  Lightning→Zap/Bolt
//   Signature→FileSignature  ShieldSlash→ShieldX  FlowArrow→Workflow
import {
  Clock,
  ChevronRight,
  CircleDollarSign,
  Zap,
  Bolt,
  ShieldCheck,
  FileSignature,
  ArrowLeft,
  Building2,
  MapPin,
  Palette,
  Car,
  TrendingUp,
  Package,
  CreditCard,
  Bell,
  BellRing,
  FileText,
  Shield,
  Crown,
  Lock,
  Receipt,
  Banknote,
  MessageSquare,
  ShieldX,
  Search,
  X,
  Inbox,
  Wallet,
  AlertTriangle,
  BookOpen,
  Wrench,
  UserPlus,
  Workflow,
  Sparkles,
  LayoutGrid,
  CalendarDays,
  Users,
  Ban,
  BadgeAlert,
  BarChart3,
  Settings,
  Globe,
  Home,
  Info,
  Star,
  Megaphone,
  Mail,
  Newspaper,
  Plug,
} from "lucide-react";
// CRITICAL: `ui/sidebar` and `ui-v2/sidebar` each define their OWN React
// context. The dashboard layout pairs this component with ui-v2's
// SidebarProvider, so `useSidebar` MUST come from ui-v2 or every render throws
// "useSidebar must be used within a SidebarProvider".
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from "@/components/ui-v2/sidebar";
import { Input } from "@/components/ui-v2/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useReminderStats } from "@/hooks/use-reminders";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useFleetHealthStats } from "@/hooks/use-fleet-health";
import { useTenant } from "@/contexts/TenantContext";
import { isAreaHidden } from "@/lib/lean-areas";
import { usePendingBookingsCount } from "@/hooks/use-pending-bookings";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useEnquiryStats } from "@/hooks/use-enquiry-stats";
import { useAuthStore } from "@/stores/auth-store";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useCMSPages } from "@/hooks/use-cms-pages";
import { ROUTE_TO_TAB } from "@/lib/permissions";
import { GlobalSearch } from "@/components/shared/layout/global-search";
import { UserMenuV2 } from "@/components/shared/layout/user-menu-v2";
import { OrgSwitcher } from "@/components/shared/layout/org-switcher";
import { SidebarPromo } from "@/components/shared/layout/sidebar-promo";
import { SidebarSearchScene, useTypedHint } from "@/components/shared/layout/sidebar-search-scene";
import { SidebarCustomizerDialog } from "@/components/shared/layout/sidebar-customizer-dialog";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import { applyNavPreferences } from "@/lib/nav-preferences";
import { TraxIcon } from "@/components/chat/TraxIcon";

/**
 * The search field's specular sweep.
 *
 * The source worktree keeps this in its own `global.css`; that file is out of
 * scope for this port, and an `animate-[shine-sweep_…]` class with no matching
 * @keyframes silently leaves the band parked across the middle of the field.
 * Declaring it here keeps the animation self-contained in the one component
 * that uses it. Values are the source's, unchanged: it crosses in the first
 * 14% of the cycle and idles for the rest, so it glints once every four
 * seconds rather than pulsing like a loading bar.
 */
const SHINE_KEYFRAMES = `
@keyframes shine-sweep {
  0% { transform: translateX(-120%); }
  14% { transform: translateX(120%); }
  100% { transform: translateX(120%); }
}
`;

/** Website nav order — matches the order the pages appear on the live site. */
const CMS_PAGE_ORDER = [
  "home",
  "about",
  "fleet",
  "reviews",
  "promotions",
  "contact",
  "blog",
  "privacy",
  "terms",
];

const CMS_PAGE_ICONS: Record<string, any> = {
  home: Home,
  about: Info,
  fleet: Car,
  reviews: Star,
  promotions: Megaphone,
  contact: Mail,
  blog: Newspaper,
  privacy: Shield,
  terms: FileText,
};

interface NavItem {
  name: string;
  href: string;
  icon: any;
  badge?: number;
  /** Defaults to `destructive`. See BADGE_TONE_CLASS. */
  badgeTone?: "destructive" | "amber";
  headAdminOnly?: boolean;
  superAdminOnly?: boolean;
}

/**
 * Every other count in this sidebar is red because it reports something wrong or
 * unread. Fleet Health's count reports scheduled work that has come due, which the
 * design system renders in the status orange (#d97706 ≡ amber-600). Red here would
 * put routine servicing at the same visual weight as an unpaid invoice.
 */
const BADGE_TONE_CLASS: Record<NonNullable<NavItem["badgeTone"]>, string> = {
  destructive: "text-white bg-destructive",
  amber: "text-white bg-amber-600",
};

interface NavGroup {
  label: string;
  icon: any;
  items: NavItem[];
}

/**
 * Settings sidebar tab definitions.
 *
 * Taken from the v1 sidebar, NOT from the source worktree — the source's copy
 * predates Push Notifications and Accounting and still calls `payments`
 * "Stripe Connect". Shipping the source's list would have quietly removed two
 * settings tabs from the canary and mislabelled a third.
 */
const settingsTabGroups = [
  {
    label: "Business",
    items: [
      { value: 'general', icon: Building2, label: 'General' },
      { value: 'locations', icon: MapPin, label: 'Locations' },
      { value: 'branding', icon: Palette, label: 'Branding' },
    ],
  },
  {
    label: "Booking Rules",
    items: [
      { value: 'requirements', icon: Shield, label: 'Requirements' },
      { value: 'duration', icon: Clock, label: 'Duration & Timing' },
      { value: 'lockbox', icon: Lock, label: 'Delivery & Lockbox' },
    ],
  },
  {
    label: "Pricing & Money",
    items: [
      { value: 'pricing', icon: TrendingUp, label: 'Pricing Rules' },
      { value: 'fees', icon: Receipt, label: 'Fees & Tax' },
      { value: 'preauth', icon: CreditCard, label: 'Deposit' },
      { value: 'installments', icon: Banknote, label: 'Installments' },
      { value: 'payg', icon: Clock, label: 'Pay As You Go' },
      { value: 'promos', icon: Zap, label: 'Promo Codes' },
      { value: 'extras', icon: Package, label: 'Extras' },
      // Provider-neutral: this tab holds whichever processor the tenant settled
      // on, and they now choose that themselves. A hard-coded "Stripe Connect"
      // sent a Square operator hunting for a menu item that does not describe
      // what they would find behind it.
      { value: 'payments', icon: CreditCard, label: 'Payments' },
    ],
  },
  {
    label: "Communication",
    items: [
      { value: 'reminders', icon: Bell, label: 'Notifications' },
      { value: 'push', icon: BellRing, label: 'Push Notifications' },
      { value: 'templates', icon: FileText, label: 'Templates' },
    ],
  },
  {
    label: "Integrations",
    items: [
      { value: 'accounting', icon: Banknote, label: 'Accounting' },
      { value: 'messaging', icon: MessageSquare, label: 'Messaging' },
      { value: 'insurance', icon: Shield, label: 'Insurance' },
      { value: 'esign', icon: FileSignature, label: 'E-Signatures' },
      { value: 'tesla', icon: Bolt, label: 'Tesla Fleet' },
      { value: 'blacklist', icon: ShieldX, label: 'Blacklist' },
    ],
  },
  {
    label: "Account",
    items: [
      { value: 'subscription', icon: Crown, label: 'Subscription' },
    ],
  },
];

/**
 * v2 sidebar. A NEW file beside `app-sidebar.tsx` — the v1 sidebar keeps
 * serving the other 56 tenants byte for byte (V2_PLAN §3). The only edit to v1
 * is the single branch in `(dashboard)/layout.tsx`.
 *
 * `onAskAI` is optional and currently unused by the layout: the header keeps
 * its own Trax button, so this row renders only when a caller supplies an
 * opener. Two openers into two Trax instances would mean two conversations.
 */
export function AppSidebarV2({ onAskAI }: { onAskAI?: () => void } = {}) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Close the mobile sheet immediately on nav tap — gives instant perceived
  // feedback while the destination page/tab is still rendering.
  const closeMobileOnNav = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const { data: reminderStats } = useReminderStats();
  const { settings } = useOrgSettings();
  const { tenant, tenantSlug } = useTenant();
  // Website rail + its publish switches. React Query dedupes this against the
  // /cms dashboard's own read, so the extra mount costs nothing.
  const {
    pages: cmsPages,
    publishPage,
    unpublishPage,
    isPublishing,
    isUnpublishing,
  } = useCMSPages();
  const leadManagementEnabled = (tenant as { lead_management_enabled?: boolean } | null)?.lead_management_enabled === true;
  const automationsEnabled = (tenant as { automations_enabled?: boolean } | null)?.automations_enabled === true;
  const vehicleOwnersEnabled = (tenant as { vehicle_owners_enabled?: boolean } | null)?.vehicle_owners_enabled === true;
  // `fleet_health_enabled` is not in TenantContext's explicit column list, so it is
  // read from the rental-settings row (a SELECT * on `tenants`) — which is also the
  // cache the settings toggle writes through, so flipping it moves this entry with
  // no refetch. `=== true` keeps the item hidden while that query is still in flight
  // rather than flashing a nav entry the tenant has not turned on.
  const { settings: rentalSettings } = useRentalSettings();
  const fleetHealthEnabled =
    (rentalSettings as unknown as { fleet_health_enabled?: boolean }).fleet_health_enabled === true;
  // Fleet Health alerting is pull-only by design — nothing is emailed or pushed —
  // so this badge is the only standing signal that work has come due.
  const { needsAttention: fleetNeedsAttention } = useFleetHealthStats();
  const { data: pendingBookingsCount } = usePendingBookingsCount();
  const { unreadCount: chatUnreadCount } = useUnreadCount();
  const { data: enquiryStats } = useEnquiryStats();
  const { appUser } = useAuthStore();
  const {
    isInGracePeriod,
    isGraceExpired,
    graceDaysRemaining,
    graceSeverity,
  } = useTenantSubscription();
  const { isManager, canView, canViewSettings } = useManagerPermissions();

  // A failed payment outranks everything else in the footer badge: it is the
  // one state that needs the operator to DO something, and it escalates
  // amber → red as the 7-day grace window runs out.
  //
  // Covers the EXPIRED state too. Gating on isInGracePeriod alone meant that the
  // moment the window closed the badge fell back to a green "Live" chip sitting
  // behind a modal telling the operator their access had been canceled — the two
  // surfaces flatly contradicting each other at the worst possible moment.
  const paymentDue = isInGracePeriod || isGraceExpired;
  const paymentDueCritical = graceSeverity === "critical" || isGraceExpired;
  // The client's wording, verbatim. The countdown rides alongside it rather
  // than being folded into the sentence.
  const paymentDueLabel = "Your payment is due.";
  // Past the window there are no days left to count down — say so.
  const paymentDueDetail = isGraceExpired ? "Overdue" : `${graceDaysRemaining}d left`;
  const paymentDueClass = paymentDueCritical
    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
    : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";

  // Feedback is no longer a sidebar row — its entry point lives in the user
  // menu now (`user-menu-v2.tsx`), which also carries v1's `formEnabled` gate.

  const showPendingBookings = settings?.payment_mode === 'manual';
  const collapsed = state === "collapsed";

  const [searchOpen, setSearchOpen] = useState(false);
  /** What was typed into the sidebar field. Seeds and drives the search scene. */
  const [searchSeed, setSearchSeed] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  /** Search mode: the rail becomes the result list instead of the nav. */
  const [searchScene, setSearchScene] = useState(false);
  const typedHint = useTypedHint(!collapsed && !searchScene && !searchSeed);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const { preferences: navPreferences } = useNavPreferences();
  const [activeView, setActiveView] = useState<"admin" | "cms">(
    pathname?.startsWith("/cms") ? "cms" : "admin"
  );
  const [drillGroup, setDrillGroup] = useState<NavGroup | null>(null);

  // /cms maps to the `cms` tab key, so the Website view is behind the same
  // manager grant that hides "Website Content" from the v1 sidebar. Without
  // this a restricted manager would reach every CMS page from the section tabs.
  const canSeeCms = !isManager || canView("cms");
  const view = canSeeCms ? activeView : "admin";

  /**
   * Switching side always lands on that side's dashboard. Flipping the rail
   * without moving left the nav describing one half of the product while the
   * page still showed the other.
   */
  const switchView = useCallback(
    (next: "admin" | "cms") => {
      if (next === "cms" && !canSeeCms) return;
      setActiveView(next);
      closeMobileOnNav();
      router.push(next === "cms" ? "/cms" : "/");
    },
    [router, closeMobileOnNav, canSeeCms]
  );

  // Keyboard shortcuts to switch sidebar tabs (Alt+1 / Alt+2 — avoids the
  // browser's Cmd/Ctrl+number tab switching).
  useEffect(() => {
    if (!canSeeCms) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.code === "Digit1") {
        e.preventDefault();
        switchView("admin");
      } else if (e.code === "Digit2") {
        e.preventDefault();
        switchView("cms");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSeeCms, switchView]);

  // Opened from the user menu at the foot of the rail. The dialog needs the
  // computed nav, which only exists here, so the trigger and the dialog are
  // joined by an event rather than by threading props through UserMenuV2.
  useEffect(() => {
    const openCustomizer = () => setCustomizerOpen(true);
    window.addEventListener("open-sidebar-customizer", openCustomizer);
    return () =>
      window.removeEventListener("open-sidebar-customizer", openCustomizer);
  }, []);

  // NOTE — no `open-global-search` / ⌘K listener here, unlike the source
  // worktree. That worktree deleted the top header; this branch keeps it, and
  // `HeaderSearch` already registers its own ⌘K handler while `providers.tsx`
  // separately dispatches `open-global-search` on the same chord. A listener
  // here would therefore open two dialogs at once. The ⌘K badge on the field
  // still tells the truth — the header answers it.

  // Settings mode: when on /settings path, show settings sidebar
  const isSettingsPage = pathname?.startsWith("/settings") || false;
  const activeSettingsTab = searchParams.get('tab') || 'general';
  const [settingsSearch, setSettingsSearch] = useState("");

  // Clear the search when leaving settings so it doesn't linger on return.
  useEffect(() => {
    if (!isSettingsPage && settingsSearch) setSettingsSearch("");
  }, [isSettingsPage, settingsSearch]);

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname?.startsWith(path) || false;
  };

  /**
   * Role + manager visibility filter applied to EVERY nav item, in every list.
   *
   * This is v1's filter, restated as a predicate instead of a `.map().filter()`
   * chain. All three rules are carried across unchanged: `superAdminOnly`,
   * `headAdminOnly`, and the `ROUTE_TO_TAB` → `canView` lookup that decides
   * what a manager may see. A route missing from ROUTE_TO_TAB is allowed for
   * everyone, exactly as `getTabKeyForRoute` treats it.
   */
  const filterItem = (item: NavItem) => {
    if (item.superAdminOnly && !appUser?.is_super_admin) return false;
    if (item.headAdminOnly && appUser?.role !== "head_admin") return false;
    if (isManager) {
      const tabKey = ROUTE_TO_TAB[item.href];
      if (tabKey && !canView(tabKey)) return false;
    }
    return true;
  };

  // --- Top-level "fingertip" items (always visible, no children) ---
  const rawTopLevel: NavItem[] = ([
    { name: "Rentals", href: "/rentals", icon: FileText },
    { name: "Vehicles", href: "/vehicles", icon: Car },
    { name: "Customers", href: "/customers", icon: Users },
  ] as NavItem[]).filter(filterItem);

  // --- Second-level groups (drilled into on click) ---
  //
  // Every gate and badge below is v1's, unchanged: the pages are all still
  // live, and without an entry here they are reachable only by typing the URL —
  // Pending Bookings especially, where an unseen queue means bookings nobody
  // approves. Rentals, Vehicles and Customers stay top-level, so these groups
  // hold what v1 nested under "Fleet & Bookings" and "Customers".
  const rawGroups: NavGroup[] = ([
    {
      label: "Bookings",
      icon: CalendarDays,
      items: [
        ...(isAreaHidden("quotes", tenantSlug)
          ? []
          : [{ name: "Fleet Quotes", href: "/quotes", icon: CircleDollarSign }]),
        ...(showPendingBookings
          ? [{ name: "Pending Bookings", href: "/pending-bookings", icon: Clock, badge: pendingBookingsCount || 0 }]
          : []),
        { name: "Availability", href: "/blocked-dates", icon: CalendarDays },
      ],
    },
    // Kept from v1: the source worktree dropped Fleet Health entirely. It is
    // still behind the same `fleet_health_enabled` flag and keeps its amber
    // badge tone — the page exists and its queue is pull-only.
    ...(fleetHealthEnabled
      ? [{
          label: "Fleet",
          icon: Wrench,
          items: [
            {
              name: "Fleet Health",
              href: "/fleet-health",
              icon: Wrench,
              badge: fleetNeedsAttention || 0,
              badgeTone: "amber" as const,
            },
          ],
        } as NavGroup]
      : []),
    {
      label: "Customers",
      icon: Users,
      items: [
        { name: "Blocked Customers", href: "/blocked-customers", icon: Ban },
        // Enquiries folds into Leads once lead management is on — same as v1.
        // The lean-areas gate is the second half of the condition and must stay:
        // a lean tenant never sees Enquiries at all.
        ...(leadManagementEnabled || isAreaHidden("enquiries", tenantSlug)
          ? []
          : [{ name: "Enquiries", href: "/enquiries", icon: Inbox, badge: enquiryStats?.pending || 0 }]),
        { name: "Messages", href: "/messages", icon: MessageSquare, badge: chatUnreadCount || 0 },
      ],
    },
    ...(leadManagementEnabled && !isAreaHidden("leads", tenantSlug)
      ? [{
          label: "Pipeline",
          icon: Users,
          items: [
            { name: "Leads", href: "/leads", icon: UserPlus },
            ...(automationsEnabled && !isAreaHidden("automations", tenantSlug)
              ? [{ name: "Automations", href: "/automations", icon: Workflow }]
              : []),
          ],
        } as NavGroup]
      : []),
    // Vehicle Owners + Owner Payouts. The `vehicle_owners_enabled` flag is the
    // tenant's own switch and stays first; the lean gate is the second half and
    // must stay, because the canary can flip that switch on from
    // Settings -> Features. Nothing is removed -- the 7 tenants with the flag
    // on, Global Motion Transport among them (3 owners, 15 payouts), are
    // untouched.
    ...(vehicleOwnersEnabled && !isAreaHidden("owners", tenantSlug)
      ? [{
          label: "Owners",
          icon: Users,
          items: [
            { name: "Vehicle Owners", href: "/vehicle-owners", icon: Users },
            { name: "Owner Payouts", href: "/owner-payouts", icon: Banknote },
          ],
        } as NavGroup]
      : []),
    {
      label: "Finance",
      icon: CreditCard,
      items: [
        { name: "Payments", href: "/payments", icon: CreditCard },
        { name: "Invoices", href: "/invoices", icon: Receipt },
        { name: "Fines", href: "/fines", icon: BadgeAlert },
        ...(isAreaHidden("expenses", tenantSlug)
          ? []
          : [{ name: "Expenses", href: "/expenses", icon: Wallet }]),
        { name: "Credits", href: "/credits", icon: CircleDollarSign },
      ],
    },
    {
      label: "Records",
      icon: BarChart3,
      items: [
        { name: "Insurances", href: "/insurances", icon: ShieldCheck },
        { name: "Agreements", href: "/agreements", icon: FileSignature },
        { name: "Reminders", href: "/reminders", icon: Bell, badge: reminderStats?.due || 0 },
        { name: "Reports", href: "/reports", icon: BarChart3 },
        { name: "P&L Dashboard", href: "/pl-dashboard", icon: TrendingUp },
      ],
    },
  ] as NavGroup[])
    .map((g) => ({ ...g, items: g.items.filter(filterItem) }))
    .filter((g) => g.items.length > 0);

  // The user's own arrangement, laid over the nav the app just computed.
  // Deliberately applied AFTER `filterItem`: a stored href for a page this
  // user may not see then matches nothing, so customisation can only ever
  // hide or reorder — never reveal.
  const arrangedNav = applyNavPreferences({
    topLevel: rawTopLevel,
    groups: rawGroups,
    preferences: navPreferences,
  });
  const topLevel = arrangedNav.topLevel as NavItem[];
  const groups = arrangedNav.groups as NavGroup[];

  // --- Website view: the site's pages, and nothing else ---
  // Driven off the `cms_pages` rows rather than a hardcoded list, so the rail
  // can never drift from what actually exists.
  const cmsPageNav = useMemo(() => {
    return [...(cmsPages ?? [])]
      // Site Settings is configuration, not a page a visitor can land on, and
      // it has no publish state worth toggling — it gets its own static row
      // below instead (v1 offers that route, so it must stay reachable).
      .filter((p: any) => p.slug !== "site-settings")
      .sort((a: any, b: any) => {
        const ia = CMS_PAGE_ORDER.indexOf(a.slug);
        const ib = CMS_PAGE_ORDER.indexOf(b.slug);
        return (
          (ia === -1 ? CMS_PAGE_ORDER.length : ia) - (ib === -1 ? CMS_PAGE_ORDER.length : ib)
        );
      })
      .map((p: any) => ({
        id: p.id as string,
        slug: p.slug as string,
        name: p.name as string,
        href: `/cms/${p.slug}`,
        icon: CMS_PAGE_ICONS[p.slug] || FileText,
        published: p.status === "published",
      }));
  }, [cmsPages]);

  const isCmsActive = (href: string) =>
    href === "/cms" ? pathname === "/cms" : (pathname?.startsWith(href) ?? false);

  // --- Settings Sidebar Mode ---
  if (isSettingsPage) {
    return (
      <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
        {/* Settings Header with Back Button */}
        <SidebarHeader className="h-16">
          <div className="flex items-center w-full h-full px-2 transition-all duration-300 ease-in-out">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/" className="flex items-center justify-center w-full h-8 rounded-md hover:bg-muted/50 transition-colors">
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Back to Dashboard</TooltipContent>
              </Tooltip>
            ) : (
              <Link href="/" className="flex items-center gap-2 h-8 px-1 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="text-[13px]">Back</span>
              </Link>
            )}
          </div>
        </SidebarHeader>

        {/* Settings Title */}
        {!collapsed && (
          <div className="px-4 pt-4 pb-1">
            <h2 className="text-sm font-semibold text-foreground">Settings</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Configure your system</p>
          </div>
        )}

        {/* Search — hidden when sidebar is collapsed */}
        {!collapsed && (
          <div className="px-3 pt-2 pb-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={settingsSearch}
                onChange={(e) => setSettingsSearch(e.target.value)}
                placeholder="Search settings..."
                className="h-8 pl-8 pr-7 text-[12px]"
              />
              {settingsSearch && (
                <button
                  type="button"
                  onClick={() => setSettingsSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Settings Navigation */}
        <SidebarContent className="transition-all duration-300 ease-in-out gap-0">
          {(() => {
            const query = settingsSearch.trim().toLowerCase();
            const groupsWithMatches = settingsTabGroups
              .map(group => ({
                ...group,
                items: group.items.filter(item =>
                  canViewSettings(item.value) &&
                  // Tesla Fleet is hidden from the lean canary and that tenant
                  // alone. Presentation only — the settings tab, the edge
                  // functions and the hourly Supercharger sync all stay put for
                  // Jangram and every other operator running Teslas.
                  !(item.value === 'tesla' && isAreaHidden('tesla', tenantSlug)) &&
                  (query === "" || item.label.toLowerCase().includes(query))
                ),
              }))
              .filter(group => group.items.length > 0);

            if (!collapsed && query !== "" && groupsWithMatches.length === 0) {
              return (
                <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                  No settings match “{settingsSearch}”.
                </div>
              );
            }

            return groupsWithMatches.map((group, groupIndex) => {
              const visibleItems = group.items;
              const GroupIcon = visibleItems[0].icon;

              return (
                <SidebarGroup key={group.label} className={`p-1.5 pb-0 ${groupIndex === settingsTabGroups.length - 1 ? 'pb-16' : ''}`}>
                  {collapsed ? (
                    <Popover>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <PopoverTrigger asChild>
                            <SidebarMenuButton className="h-8 w-full transition-all duration-200 ease-in-out">
                              <GroupIcon className="h-4 w-4 shrink-0" />
                            </SidebarMenuButton>
                          </PopoverTrigger>
                        </SidebarMenuItem>
                      </SidebarMenu>
                      <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1.5">
                        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
                        <div className="space-y-0.5">
                          {visibleItems.map(item => (
                            <Link
                              key={item.value}
                              href={`/settings?tab=${item.value}`}
                              replace
                              scroll={false}
                              prefetch={false}
                              onClick={closeMobileOnNav}
                              className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors hover:bg-accent ${
                                activeSettingsTab === item.value ? "bg-accent text-accent-foreground font-medium" : "text-foreground"
                              }`}
                            >
                              <item.icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </Link>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <SidebarGroupContent>
                      {groupIndex > 0 && (
                        <div className="mx-2.5 mb-1.5 border-t" />
                      )}
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pt-0.5 pb-1">{group.label}</p>
                      <SidebarMenu>
                        {visibleItems.map(item => (
                          <SidebarMenuItem key={item.value}>
                            <SidebarMenuButton
                              asChild
                              isActive={activeSettingsTab === item.value}
                              className="h-8 transition-all duration-200 ease-in-out"
                            >
                              <Link
                                href={`/settings?tab=${item.value}`}
                                replace
                                scroll={false}
                                prefetch={false}
                                onClick={closeMobileOnNav}
                                className="flex items-center gap-2.5"
                              >
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className="text-[13px]">{item.label}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  )}
                </SidebarGroup>
              );
            });
          })()}
        </SidebarContent>

        {/* Footer — dunning only */}
        <SidebarFooter className="p-1.5">
          <SidebarMenu>
            {/* The "Setup Mode · Nd left" and "Live" chips are gone by request.
                What stays is the dunning warning that shared the same slot: it
                is the only place a tenant inside the grace window is told their
                payment is due, and grace expiry is a pure clock event nothing
                else announces. Removing this branch would stop chasing tenants
                who owe money, and no visual review would catch it. */}
            {paymentDue && (
              <SidebarMenuItem>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center h-8">
                        <AlertTriangle
                          className={`h-4 w-4 ${paymentDueCritical ? "text-red-500" : "text-amber-500"}`}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {`${paymentDueLabel} ${paymentDueDetail}`}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${paymentDueClass}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{paymentDueLabel}</span>
                    <span className="opacity-70">{paymentDueDetail}</span>
                  </div>
                )}
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  // --- Main Sidebar Mode ---
  return (
    <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      {/* Organization switcher at the very top */}
      <SidebarHeader className="p-1.5 pt-4">
        <OrgSwitcher collapsed={collapsed} />
      </SidebarHeader>

      {/* Search mode takes the whole rail: the results land where the field
          that produced them is, instead of behind a modal over the page. */}
      {searchScene && !collapsed ? (
        <SidebarContent className="gap-0 pt-1">
          <SidebarSearchScene
            query={searchSeed}
            onQueryChange={setSearchSeed}
            onClose={() => {
              setSearchScene(false);
              setSearchSeed("");
            }}
          />
        </SidebarContent>
      ) : (
      /* Navigation — fingertip items + drill-in groups */
      <SidebarContent className="gap-0 pt-1 transition-all duration-300 ease-in-out">
        {/* Search — prominent field at the very top */}
        <SidebarGroup className="p-1.5 pb-1">
          <SidebarGroupContent>
            {collapsed ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setSearchOpen(true)}
                    tooltip="Search"
                    className="h-8 transition-colors"
                  >
                    <Search className="h-4 w-4 shrink-0" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : (
              /* A real field, not a button that opens one. The first keystroke
                 swaps the rail for the search scene and is carried across in
                 `searchSeed`, so nothing typed here is lost. */
              <div
                className={[
                  "relative flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5",
                  // A real border rather than a ring, so the inner glass layers
                  // below can be inset by a pixel and leave the edge intact.
                  "border border-primary/25 bg-primary/[0.07] backdrop-blur-[2px]",
                  // The depth, in one shadow: a lit inner top edge, a shaded
                  // inner floor, a tight contact shadow and a soft lift beneath.
                  // Together they read as a raised pane rather than a flat tint.
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.04),0_6px_14px_-8px_rgba(0,0,0,0.20)]",
                  "transition-colors focus-within:border-primary/50 focus-within:bg-primary/10 hover:bg-primary/10",
                ].join(" ")}
              >
                <style>{SHINE_KEYFRAMES}</style>
                {/* The glass itself: a sheen resting in the upper half, and a
                    blurred specular band crossing every four seconds. Both are
                    inset a pixel to keep off the border, take no clicks, and the
                    moving one drops out entirely under reduced motion. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-px top-px h-1/2 rounded-t-lg bg-gradient-to-b from-white/30 to-transparent dark:from-white/[0.07]"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-px left-px w-full -skew-x-[18deg] animate-[shine-sweep_4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent blur-[3px] motion-reduce:hidden dark:via-white/20"
                />
                {/* Trax's own mark rather than a magnifier: the field is the
                    portal's one "ask it anything" control, and its face says
                    that faster than any label could. `currentColor` because
                    TraxIcon paints through SVG presentation attributes, where a
                    var() would never resolve. */}
                <span className="flex shrink-0 items-center justify-center text-primary">
                  <TraxIcon size={16} color="currentColor" />
                </span>
                <div className="relative min-w-0 flex-1 overflow-hidden">
                  <input
                    type="text"
                    value={searchSeed}
                    onChange={(e) => {
                      setSearchSeed(e.target.value);
                      setSearchScene(true);
                    }}
                    onFocus={() => {
                      setSearchFocused(true);
                      // Clicking the field is the whole gesture — the rail
                      // swaps to results rather than a modal opening over it.
                      setSearchScene(true);
                    }}
                    onBlur={() => setSearchFocused(false)}
                    /* The visible hint is the overlay below — a native
                       placeholder can't carry a caret of its own. */
                    placeholder=""
                    aria-label="Search"
                    className="w-full bg-transparent text-[13px] text-foreground outline-none"
                  />
                  {!searchSeed && (
                    <span
                      aria-hidden
                      /* Clipped by the wrapper and faded over the last 14px, so a
                         long hint dissolves rather than running into the ⌘K badge. */
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center whitespace-nowrap pr-2 text-[13px] leading-none text-muted-foreground [mask-image:linear-gradient(to_right,black_calc(100%-14px),transparent)]"
                    >
                      {typedHint}
                      {!searchFocused && (
                        <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-muted-foreground/80" />
                      )}
                    </span>
                  )}
                </div>
                <kbd className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">⌘K</kbd>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Section tabs: Portal / Website. Hidden entirely from a manager
            without the `cms` grant — v1 hides "Website Content" from them too. */}
        {canSeeCms && !collapsed && (
          <div className="px-1.5 pb-1 pt-0.5">
            <div className="relative grid grid-cols-2 rounded-lg p-1">
              {/* Sliding active pill */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-background shadow-sm ring-1 ring-primary/20 transition-transform duration-300 ease-out"
                style={{ transform: view === "cms" ? "translateX(100%)" : "translateX(0)" }}
              />
              {([
                { key: "admin", label: "Portal", kbd: "⌥1" },
                { key: "cms", label: "Website", kbd: "⌥2" },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => switchView(tab.key)}
                  className={`relative z-10 flex items-center justify-between gap-1.5 cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    view === tab.key
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  <kbd
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                      view === tab.key
                        ? "bg-primary/15 text-primary"
                        : "bg-foreground/10 text-foreground/70"
                    }`}
                  >
                    {tab.kbd}
                  </kbd>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Collapsed rail equivalent of the tab strip. Without it the whole
            Website section — v1's "Website Content" entry — is unreachable from
            the rail, since the strip above needs the full width. */}
        {canSeeCms && collapsed && (
          <SidebarGroup className="p-1.5 pb-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => switchView(view === "cms" ? "admin" : "cms")}
                    isActive={view === "cms"}
                    tooltip={view === "cms" ? "Back to Portal" : "Website"}
                    className="h-8 transition-colors"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* The collapsed rail's search dialog. Mounted unconditionally; its
            underlying query is `enabled: debouncedQuery.length > 0`, so a
            closed one costs nothing. */}
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

        {view === "cms" ? (
          /* Website — the site's pages, each with its live/off switch. Anything
             that is not a page (blog posts, promos, branding, SEO) is managed
             from the Website dashboard instead. */
          <SidebarGroup className="p-1.5 pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {/* The one non-page row: everything that isn't a page — blog
                    posts, promos, branding, SEO — is managed from here. */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/cms"}
                    tooltip={collapsed ? "Dashboard" : undefined}
                    className="h-8 transition-colors"
                  >
                    <Link href="/cms" onClick={closeMobileOnNav}>
                      <LayoutGrid className="h-4 w-4 shrink-0" />
                      <span
                        className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}
                      >
                        Dashboard
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {!collapsed && <div className="mx-2 my-1.5 h-px bg-sidebar-border/60" />}

                {cmsPageNav.map((item) => (
                  <SidebarMenuItem key={item.id} className="flex items-center gap-1">
                    <SidebarMenuButton
                      asChild
                      isActive={isCmsActive(item.href)}
                      tooltip={collapsed ? item.name : undefined}
                      className="h-8 min-w-0 flex-1 transition-colors"
                    >
                      <Link href={item.href} onClick={closeMobileOnNav}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span
                          className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"} ${
                            !collapsed && !item.published ? "text-muted-foreground" : ""
                          }`}
                        >
                          {item.name}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                    {/* Trailing status button — green when the page is live on
                        the website, grey when it is not. Kept outside the Link
                        so toggling a page never also navigates to it. */}
                    {!collapsed && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={item.published}
                            aria-label={`${item.published ? "Unpublish" : "Publish"} ${item.name}`}
                            disabled={isPublishing || isUnpublishing}
                            onClick={() =>
                              item.published ? unpublishPage(item.id) : publishPage(item.id)
                            }
                            className={`mr-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full ring-offset-1 ring-offset-sidebar transition-all hover:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                              item.published
                                ? "bg-green-500 hover:ring-green-500/40"
                                : "bg-muted-foreground/25 hover:ring-muted-foreground/30"
                            }`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.published ? "Live — click to unpublish" : "Off — click to publish"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </SidebarMenuItem>
                ))}

                {/* Site Settings, kept from v1's Website list. The source
                    worktree filters it out of the page rail because it has no
                    publish state, but `/cms/site-settings` is a real route this
                    branch already offers — dropping the row would strand it. */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isCmsActive("/cms/site-settings")}
                    tooltip={collapsed ? "Site Settings" : undefined}
                    className="h-8 transition-colors"
                  >
                    <Link href="/cms/site-settings" onClick={closeMobileOnNav}>
                      <Settings className="h-4 w-4 shrink-0" />
                      <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                        Site Settings
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {/* Dashboard + always-available utilities */}
            <SidebarGroup className="p-1.5 pb-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  {/* Dashboard */}
                  <SidebarMenuItem className="relative">
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/")}
                      tooltip={collapsed ? "Dashboard" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/" onClick={closeMobileOnNav}>
                        <LayoutGrid className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Dashboard</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Integrations — from the source worktree. Not in
                      ROUTE_TO_TAB, so unmapped means allowed for every role,
                      exactly as `getTabKeyForRoute` treats it. */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/integrations")}
                      tooltip={collapsed ? "Integrations" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/integrations" onClick={closeMobileOnNav}>
                        <Plug className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Integrations</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Welcome pack, kept from v1 — the source worktree dropped
                      it, but `/welcome` is a live route this branch's v1 rail
                      links to, so removing the row would strand it.
                      Deliberately NOT in ROUTE_TO_TAB: unmapped routes are
                      allowed for every role, so a `viewer` or a restricted
                      `manager` keeps it. They hit the same confusion as a head
                      admin — gating the guide would silence exactly the people
                      most likely to need it.

                      Hidden from the lean canary only. This is the rail
                      northwind actually renders, so this is the gate the owner
                      sees; the v1 rail below carries the identical predicate so
                      the two cannot drift. Everyone else keeps the row — 16
                      operators across 14 tenants have read the pack. */}
                  {!isAreaHidden("welcome", tenantSlug) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/welcome")}
                      tooltip={collapsed ? "Welcome Pack" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/welcome" onClick={closeMobileOnNav}>
                        <BookOpen className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Welcome Pack</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  )}

                  {/* Ask AI — only when the caller owns a Trax instance to open. */}
                  {onAskAI && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={onAskAI}
                        tooltip={collapsed ? "Ask AI" : undefined}
                        className="h-8 transition-colors"
                      >
                        <Sparkles className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Ask AI</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Separator — divides quick actions from the main navigation */}
            <div className="mx-3 my-1.5 h-px bg-sidebar-border/60" />

            {drillGroup ? (
              /* Drill-in view — replaces the nav with the selected section */
              <SidebarGroup className="p-1.5 pb-0">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={() => setDrillGroup(null)}
                        tooltip={collapsed ? "Back" : undefined}
                        className="h-8 transition-colors"
                      >
                        <ArrowLeft className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] font-medium ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                          {drillGroup.label}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {drillGroup.items.map((item) => (
                      <SidebarMenuItem key={item.href} className="relative">
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.href)}
                          tooltip={collapsed ? item.name : undefined}
                          className="h-8 transition-colors"
                        >
                          <Link href={item.href} onClick={closeMobileOnNav} className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2 min-w-0">
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                                {item.name}
                              </span>
                            </div>
                            {!collapsed && item.badge !== undefined && item.badge > 0 && (
                              <span className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none rounded-full shrink-0 ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                {item.badge}
                              </span>
                            )}
                            {collapsed && item.badge !== undefined && item.badge > 0 && (
                              <span className={`absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none rounded-full ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                {item.badge > 9 ? '9+' : item.badge}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : (
              <>
                {/* Top-level fingertip items — always visible */}
                <SidebarGroup className="p-1.5 pb-0">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {topLevel.map((item) => (
                        <SidebarMenuItem key={item.href} className="relative">
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.href)}
                            tooltip={collapsed ? item.name : undefined}
                            className="h-8 transition-colors"
                          >
                            <Link href={item.href} onClick={closeMobileOnNav} className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2 min-w-0">
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                                  {item.name}
                                </span>
                              </div>
                              {!collapsed && item.badge !== undefined && item.badge > 0 && (
                                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none rounded-full shrink-0 animate-in fade-in ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                  {item.badge}
                                </span>
                              )}
                              {collapsed && item.badge !== undefined && item.badge > 0 && (
                                <span className={`absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none rounded-full animate-in fade-in ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                  {item.badge > 9 ? '9+' : item.badge}
                                </span>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>

                {/* Second-level groups — drill into the section on click */}
                {groups.length > 0 && (
                  <SidebarGroup className="p-1.5 pt-1 pb-2">
                    {!collapsed && (
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pb-1">
                        More
                      </p>
                    )}
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {groups.map((group) => {
                          const GroupIcon = group.icon;
                          const hasActive = group.items.some((i) => isActive(i.href));
                          const totalBadge = group.items.reduce((s, i) => s + (i.badge || 0), 0);
                          return (
                            <SidebarMenuItem key={group.label} className="relative">
                              <SidebarMenuButton
                                onClick={() => setDrillGroup(group)}
                                isActive={hasActive}
                                tooltip={collapsed ? group.label : undefined}
                                className="h-8 w-full transition-colors"
                              >
                                {collapsed ? (
                                  <GroupIcon className="h-4 w-4 shrink-0" />
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <GroupIcon className="h-4 w-4 shrink-0" />
                                      <span className="text-[13px] truncate">{group.label}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {totalBadge > 0 && <span className="w-1.5 h-1.5 rounded-full bg-destructive" />}
                                      <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                                    </div>
                                  </>
                                )}
                              </SidebarMenuButton>
                              {collapsed && totalBadge > 0 && (
                                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full pointer-events-none">
                                  {totalBadge > 9 ? "9+" : totalBadge}
                                </span>
                              )}
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}
              </>
            )}
          </>
        )}
      </SidebarContent>
      )}

      {/* Pinned Footer */}
      <SidebarFooter className="p-1.5">
        {/* Dunning warning. Same slot, same wording and same escalation as v1 —
            see the settings-mode footer above for why this one branch stays
            when the "Setup Mode" and "Live" chips went. */}
        {paymentDue && (
          <SidebarMenu>
            <SidebarMenuItem>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center h-8">
                      <AlertTriangle
                        className={`h-4 w-4 ${paymentDueCritical ? "text-red-500" : "text-amber-500"}`}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {`${paymentDueLabel} ${paymentDueDetail}`}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${paymentDueClass}`}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{paymentDueLabel}</span>
                  <span className="opacity-70">{paymentDueDetail}</span>
                </div>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        )}

        {/* Promo / announcement slot (feature releases, training, promotions) */}
        {!collapsed && (
          <div className="px-0.5 pb-1.5">
            <SidebarPromo />
          </div>
        )}

        <SidebarMenu>
          {/* Profile row — whole row opens the user menu, and carries the
              customiser trigger beside it. */}
          <SidebarMenuItem>
            {collapsed ? (
              <div className="flex justify-center py-1">
                <UserMenuV2 />
              </div>
            ) : (
              <UserMenuV2 variant="row" />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />

      {/* Given the RAW nav, not the arranged one — the customiser has to show
          the user everything they could have, including what they've hidden. */}
      <SidebarCustomizerDialog
        open={customizerOpen}
        onOpenChange={setCustomizerOpen}
        topLevel={rawTopLevel}
        groups={rawGroups}
      />
    </Sidebar>
  );
}
