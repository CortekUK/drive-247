"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
// Phosphor icons (aliased to the previous lucide names so all usages below keep working)
import {
  Clock,
  DotsThree as MoreHorizontal,
  CurrencyCircleDollar as CircleDollarSign,
  Stack as Layers,
  Timer,
  Lightning as Zap,
  Lightning as Bolt,
  ShieldCheck,
  Signature as FileSignature,
  ArrowLeft,
  CaretRight as ChevronRight,
  Buildings as Building2,
  MapPin,
  Palette,
  Car,
  TrendUp as TrendingUp,
  Package,
  CreditCard,
  Bell,
  FileText,
  Shield,
  Crown,
  Lock,
  Receipt,
  Money as Banknote,
  ChatCircle as MessageSquare,
  ShieldSlash as ShieldX,
  MagnifyingGlass as Search,
  X,
  Tray as Inbox,
  Wallet,
  UserPlus,
  FlowArrow as Workflow,
  // animated-icon replacements
  SquaresFour,
  CalendarDots,
  Users,
  Prohibit,
  WarningCircle,
  FolderOpen,
  ChartBar,
  ClockCounterClockwise,
  Gear,
  Globe,
  Sparkle,
  House,
  Info,
  Star,
  Megaphone,
  EnvelopeSimple,
  Article,
  Plugs,
} from "@phosphor-icons/react";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useReminderStats } from "@/hooks/use-reminders";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useTenant } from "@/contexts/TenantContext";
import { usePendingBookingsCount } from "@/hooks/use-pending-bookings";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useEnquiryStats } from "@/hooks/use-enquiry-stats";
import { useAuthStore } from "@/stores/auth-store";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useFeedbackStore } from "@/stores/feedback-store";
import { useFeedbackSettings } from "@/hooks/use-feedback-settings";
// Kept on lucide: the dunning chip and feedback control are carried over from
// main verbatim, and re-drawing them in Phosphor would be a silent visual
// change to the one badge that must stay unmistakable.
import { AlertTriangle, MessageSquarePlus } from "lucide-react";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { ROUTE_TO_TAB } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserMenu } from "@/components/shared/layout/user-menu";
import { OrgSwitcher } from "@/components/shared/layout/org-switcher";
import { SidebarPromo } from "@/components/shared/layout/sidebar-promo";
import { GlobalSearch } from "@/components/shared/layout/global-search";
import { TraxAIDialogInner } from "@/components/chat";

// Map the former animated-icon names to Phosphor equivalents
const AnimatedBlocks = SquaresFour;
const AnimatedFileText = FileText;
const AnimatedCalendarDays = CalendarDots;
const AnimatedUsers = Users;
const AnimatedBan = Prohibit;
const AnimatedMessageSquare = MessageSquare;
const AnimatedBadgeAlert = WarningCircle;
const AnimatedFolderOpen = FolderOpen;
const AnimatedBell = Bell;
const AnimatedChartBar = ChartBar;
const AnimatedTrendingUp = TrendingUp;
const AnimatedHistory = ClockCounterClockwise;
const AnimatedSettings = Gear;
const AnimatedCreditCard = CreditCard;
const AnimatedReceipt = Receipt;
const AnimatedCar = Car;
const AnimatedEarth = Globe;

interface NavItem {
  name: string;
  href: string;
  icon: any;
  badge?: number;
  headAdminOnly?: boolean;
  superAdminOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: any;
  items: NavItem[];
}

// Second-level group: heading opens its sub-tabs as a flyout on CLICK.
// Keeps the main rail to the fingertip items only.
function HoverNavGroup({
  group,
  collapsed,
  isActive,
  onNav,
}: {
  group: NavGroup;
  collapsed: boolean;
  isActive: (path: string) => boolean;
  onNav: () => void;
}) {
  const [open, setOpen] = useState(false);
  const GroupIcon = group.icon;
  const hasActive = group.items.some((item) => isActive(item.href));
  const totalBadge = group.items.reduce((sum, item) => sum + (item.badge || 0), 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SidebarMenuItem className="relative">
        <PopoverTrigger asChild>
          <SidebarMenuButton
            isActive={hasActive}
            className="h-8 w-full transition-colors"
          >
            {collapsed ? (
              <GroupIcon className={`h-4 w-4 shrink-0 ${hasActive ? "text-primary" : ""}`} />
            ) : (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <GroupIcon className={`h-4 w-4 shrink-0 ${hasActive ? "text-primary" : ""}`} />
                  <span className="text-[13px] truncate">{group.label}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {totalBadge > 0 && <span className="w-1.5 h-1.5 rounded-full bg-destructive" />}
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground/60" />
                </div>
              </>
            )}
          </SidebarMenuButton>
        </PopoverTrigger>
        {collapsed && totalBadge > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full pointer-events-none">
            {totalBadge > 9 ? "9+" : totalBadge}
          </span>
        )}
      </SidebarMenuItem>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-52 p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
        <div className="space-y-0.5">
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                setOpen(false);
                onNav();
              }}
              className={`flex items-center justify-between gap-2 px-2 py-1.5 text-sm rounded-md transition-colors hover:bg-accent ${
                isActive(item.href) ? "bg-accent text-accent-foreground font-medium" : "text-foreground"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{item.name}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-destructive rounded-full shrink-0">
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Settings sidebar tab definitions
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
      { value: 'preauth', icon: CreditCard, label: 'Pre-Authorization' },
      { value: 'installments', icon: Banknote, label: 'Installments' },
      { value: 'payg', icon: Clock, label: 'Pay As You Go' },
      { value: 'promos', icon: Zap, label: 'Promo Codes' },
      { value: 'extras', icon: Package, label: 'Extras' },
      { value: 'payments', icon: CreditCard, label: 'Stripe Connect' },
    ],
  },
  {
    label: "Communication",
    items: [
      { value: 'reminders', icon: Bell, label: 'Notifications' },
      { value: 'templates', icon: FileText, label: 'Templates' },
    ],
  },
  {
    label: "Integrations",
    items: [
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

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Close the mobile sheet immediately on nav tap — gives instant perceived
  // feedback while the destination page/tab is still rendering.
  const closeMobileOnNav = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const { data: reminderStats } = useReminderStats();
  const { settings } = useOrgSettings();
  const { tenant } = useTenant();
  const leadManagementEnabled = (tenant as { lead_management_enabled?: boolean } | null)?.lead_management_enabled === true;
  const automationsEnabled = (tenant as { automations_enabled?: boolean } | null)?.automations_enabled === true;
  const vehicleOwnersEnabled = (tenant as { vehicle_owners_enabled?: boolean } | null)?.vehicle_owners_enabled === true;
  const { data: pendingBookingsCount } = usePendingBookingsCount();
  const { unreadCount: chatUnreadCount } = useUnreadCount();
  const { data: enquiryStats } = useEnquiryStats();
  const { appUser } = useAuthStore();
  const {
    isTrialing,
    trialDaysRemaining,
    isInGracePeriod,
    isGraceExpired,
    graceDaysRemaining,
    graceSeverity,
  } = useTenantSubscription();
  const { isLive } = useSetupStatus();
  const { isManager, canView, canViewSettings } = useManagerPermissions();

  // A failed payment outranks trial/live in the footer badge: it is the only
  // one of the three that needs the operator to DO something, and it escalates
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

  // Feedback entry point. Available to every role — a `viewer` hits the same
  // bugs as a head admin, so gating this on permissions would silence exactly
  // the people who use the software most.
  const openFeedback = useFeedbackStore((s) => s.open);
  const { formEnabled: feedbackEnabled } = useFeedbackSettings();

  const showPendingBookings = settings?.payment_mode === 'manual';
  const collapsed = state === "collapsed";

  // Shared by both sidebar modes (settings + main) so the control can never
  // drift between them. Declared after `collapsed`, which it closes over.
  const renderFeedbackButton = () =>
    feedbackEnabled ? (
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => openFeedback({ source: "sidebar" })}
          tooltip={collapsed ? "Send feedback" : undefined}
          className="h-8 transition-all duration-200 ease-in-out"
        >
          <MessageSquarePlus className="h-4 w-4 shrink-0" />
          <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>
            Send Feedback
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ) : null;
  const [searchOpen, setSearchOpen] = useState(false);
  const [traxOpen, setTraxOpen] = useState(false);
  const [activeView, setActiveView] = useState<"admin" | "cms">(
    pathname?.startsWith("/cms") ? "cms" : "admin"
  );
  const [drillGroup, setDrillGroup] = useState<NavGroup | null>(null);

  // Keyboard shortcuts to switch sidebar tabs (Alt+1 / Alt+2 — avoids the
  // browser's Cmd/Ctrl+number tab switching).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.code === "Digit1") {
        e.preventDefault();
        setActiveView("admin");
      } else if (e.code === "Digit2") {
        e.preventDefault();
        setActiveView("cms");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Mock avatar placeholder until the user uploads a real profile photo
  const mockAvatarUrl = "https://i.pravatar.cc/120?img=13";

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

  // Role + manager visibility filter applied to every nav item
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
  const topLevel: NavItem[] = [
    { name: "Rentals", href: "/rentals", icon: AnimatedFileText },
    { name: "Vehicles", href: "/vehicles", icon: AnimatedCar },
    { name: "Customers", href: "/customers", icon: AnimatedUsers },
  ].filter(filterItem);

  // --- Second-level groups (revealed on hover / tap) ---
  const groups: NavGroup[] = [
    ...(vehicleOwnersEnabled
      ? [{
          label: "Owners",
          icon: AnimatedUsers,
          items: [
            { name: "Vehicle Owners", href: "/vehicle-owners", icon: AnimatedUsers },
            { name: "Owner Payouts", href: "/owner-payouts", icon: Banknote },
          ],
        } as NavGroup]
      : []),
    {
      label: "Finance",
      icon: AnimatedCreditCard,
      items: [
        { name: "Payments", href: "/payments", icon: AnimatedCreditCard },
        { name: "Invoices", href: "/invoices", icon: AnimatedReceipt },
        { name: "Fines", href: "/fines", icon: AnimatedBadgeAlert },
        { name: "Expenses", href: "/expenses", icon: Wallet },
        { name: "Credits", href: "/credits", icon: CircleDollarSign },
      ],
    },
    {
      label: "Records",
      icon: AnimatedChartBar,
      items: [
        { name: "Insurances", href: "/insurances", icon: ShieldCheck },
        { name: "Agreements", href: "/agreements", icon: FileSignature },
        { name: "Reminders", href: "/reminders", icon: AnimatedBell, badge: reminderStats?.due || 0 },
        { name: "Reports", href: "/reports", icon: AnimatedChartBar },
        { name: "P&L Dashboard", href: "/pl-dashboard", icon: AnimatedTrendingUp },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter(filterItem) }))
    .filter((g) => g.items.length > 0);

  // --- CMS view: website content pages become the nav ---
  const cmsNav: NavItem[] = [
    { name: "Overview", href: "/cms", icon: Globe },
    { name: "Home", href: "/cms/home", icon: House },
    { name: "About", href: "/cms/about", icon: Info },
    { name: "Fleet", href: "/cms/fleet", icon: Car },
    { name: "Reviews", href: "/cms/reviews", icon: Star },
    { name: "Promotions", href: "/cms/promotions", icon: Megaphone },
    { name: "Contact", href: "/cms/contact", icon: EnvelopeSimple },
    { name: "Blog", href: "/cms/blog", icon: Article },
    { name: "Privacy", href: "/cms/privacy", icon: Shield },
    { name: "Terms", href: "/cms/terms", icon: FileText },
    { name: "Branding", href: "/cms/branding", icon: Palette },
    { name: "Info", href: "/cms/info", icon: Building2 },
  ];
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSettingsSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
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

        {/* Footer — trial/live status */}
        <SidebarFooter className="p-1.5">
          <SidebarMenu>
            {(paymentDue || isTrialing || isLive) && (
              <SidebarMenuItem>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center h-8">
                        {paymentDue ? (
                          <AlertTriangle
                            className={`h-4 w-4 ${paymentDueCritical ? "text-red-500" : "text-amber-500"}`}
                          />
                        ) : isTrialing ? (
                          <Timer className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Zap className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {paymentDue
                        ? `${paymentDueLabel} ${paymentDueDetail}`
                        : isTrialing
                        ? `Setup Mode · ${trialDaysRemaining}d left`
                        : "Live"}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${
                    paymentDue
                      ? paymentDueClass
                      : isTrialing
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                      : "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                  }`}>
                    {paymentDue ? (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>{paymentDueLabel}</span>
                        <span className="opacity-70">{paymentDueDetail}</span>
                      </>
                    ) : isTrialing ? (
                      <>
                        <Timer className="h-3.5 w-3.5" />
                        <span>Setup Mode · {trialDaysRemaining}d left</span>
                      </>
                    ) : (
                      <>
                        <Zap className="h-3.5 w-3.5" />
                        <span>Live</span>
                      </>
                    )}
                  </div>
                )}
              </SidebarMenuItem>
            )}
            {renderFeedbackButton()}
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

      {/* Navigation — fingertip items + hover-reveal groups */}
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
              <button
                onClick={() => setSearchOpen(true)}
                className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted/70"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Search</span>
                <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/70">⌘K</kbd>
              </button>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Section tabs: Main / Admin / CMS */}
        {!collapsed && (
          <div className="px-1.5 pb-1 pt-0.5">
            <div className="relative grid grid-cols-2 rounded-lg bg-muted/50 p-1">
              {/* Sliding active pill */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-background shadow-sm transition-transform duration-300 ease-out"
                style={{ transform: activeView === "cms" ? "translateX(100%)" : "translateX(0)" }}
              />
              {([
                { key: "admin", label: "Admin", kbd: "⌥1" },
                { key: "cms", label: "CMS", kbd: "⌥2" },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveView(tab.key)}
                  className={`relative z-10 flex items-center justify-between gap-1.5 cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    activeView === tab.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground/70">{tab.kbd}</kbd>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick-action dialogs (portal out) — always mounted */}
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        <TraxAIDialogInner isOpen={traxOpen} setIsOpen={setTraxOpen} />

        {activeView === "cms" ? (
          /* CMS — website content pages become the nav */
          <SidebarGroup className="p-1.5 pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {cmsNav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isCmsActive(item.href)}
                      tooltip={collapsed ? item.name : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href={item.href} onClick={closeMobileOnNav}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                          {item.name}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
        <>
        {/* Dashboard + utilities: Ask AI / Notifications / Credits */}
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
                    <AnimatedBlocks className="h-4 w-4 shrink-0" />
                    <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Ask AI */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setTraxOpen(true)}
                  tooltip={collapsed ? "Ask AI" : undefined}
                  className="h-8 transition-colors"
                >
                  <Sparkle className="h-4 w-4 shrink-0" />
                  <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Ask AI</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Integrations */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/integrations")}
                  tooltip={collapsed ? "Integrations" : undefined}
                  className="h-8 transition-colors"
                >
                  <Link href="/integrations" onClick={closeMobileOnNav}>
                    <Plugs className="h-4 w-4 shrink-0" />
                    <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Integrations</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

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
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-destructive rounded-full shrink-0">
                            {item.badge}
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
                        <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-destructive rounded-full shrink-0 animate-in fade-in">
                          {item.badge}
                        </span>
                      )}
                      {collapsed && item.badge !== undefined && item.badge > 0 && (
                        <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full animate-in fade-in">
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

      {/* Pinned Footer */}
      <SidebarFooter className="p-1.5">
        {/* Promo / announcement slot (feature releases, training, promotions) */}
        {!collapsed && (
          <div className="px-0.5 pb-1.5">
            <SidebarPromo />
          </div>
        )}
        <SidebarMenu>
          {renderFeedbackButton()}
          {/* Profile row — whole row opens the user menu (Settings/Profile/etc.) */}
          <SidebarMenuItem>
            {collapsed ? (
              <div className="flex justify-center py-1">
                <UserMenu mockAvatarUrl={mockAvatarUrl} />
              </div>
            ) : (
              <UserMenu variant="row" mockAvatarUrl={mockAvatarUrl} />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
