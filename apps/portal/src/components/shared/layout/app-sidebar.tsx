"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, ChevronRight, Layers, Timer, Zap } from "lucide-react";
import { EarthIcon } from "@/components/ui/earth";
import { CarIcon } from "@/components/ui/car";
import { BlocksIcon } from "@/components/ui/blocks";
import { FileTextIcon } from "@/components/ui/file-text";
import { CalendarDaysIcon } from "@/components/ui/calendar-days";
import { UsersIcon } from "@/components/ui/users";
import { BanIcon } from "@/components/ui/ban";
import { MessageSquareIcon } from "@/components/ui/message-square";
import { BadgeAlertIcon } from "@/components/ui/badge-alert";
import { FolderOpenIcon } from "@/components/ui/folder-open";
import { BellIcon } from "@/components/ui/bell";
import { ChartBarIncreasingIcon } from "@/components/ui/chart-bar-increasing";
import { TrendingUpIcon } from "@/components/ui/trending-up";
import { HistoryIcon } from "@/components/ui/history";
import { SettingsIcon } from "@/components/ui/settings";
import { CreditCardIcon } from "@/components/ui/credit-card-icon";
import { ReceiptIcon } from "@/components/ui/receipt";
import { wrapAnimatedIcon } from "@/components/ui/animated-icon-wrapper";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useReminderStats } from "@/hooks/use-reminders";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { usePendingBookingsCount } from "@/hooks/use-pending-bookings";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useAuthStore } from "@/stores/auth-store";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { ROUTE_TO_TAB } from "@/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "next-themes";

const AnimatedBlocks = wrapAnimatedIcon(BlocksIcon);
const AnimatedFileText = wrapAnimatedIcon(FileTextIcon);
const AnimatedCalendarDays = wrapAnimatedIcon(CalendarDaysIcon);
const AnimatedUsers = wrapAnimatedIcon(UsersIcon);
const AnimatedBan = wrapAnimatedIcon(BanIcon);
const AnimatedMessageSquare = wrapAnimatedIcon(MessageSquareIcon);
const AnimatedBadgeAlert = wrapAnimatedIcon(BadgeAlertIcon);
const AnimatedFolderOpen = wrapAnimatedIcon(FolderOpenIcon);
const AnimatedBell = wrapAnimatedIcon(BellIcon);
const AnimatedChartBar = wrapAnimatedIcon(ChartBarIncreasingIcon);
const AnimatedTrendingUp = wrapAnimatedIcon(TrendingUpIcon);
const AnimatedHistory = wrapAnimatedIcon(HistoryIcon);
const AnimatedSettings = wrapAnimatedIcon(SettingsIcon);
const AnimatedCreditCard = wrapAnimatedIcon(CreditCardIcon);
const AnimatedReceipt = wrapAnimatedIcon(ReceiptIcon);
const AnimatedCar = wrapAnimatedIcon(CarIcon);
const AnimatedEarth = wrapAnimatedIcon(EarthIcon);

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

export function AppSidebar() {
  const { state } = useSidebar();
  const pathname = usePathname();
  const { data: reminderStats } = useReminderStats();
  const { settings } = useOrgSettings();
  const { branding } = useTenantBranding();
  const { data: pendingBookingsCount } = usePendingBookingsCount();
  const { unreadCount: chatUnreadCount } = useUnreadCount();
  const { appUser } = useAuthStore();
  const { isTrialing, trialDaysRemaining } = useTenantSubscription();
  const { isLive } = useSetupStatus();
  const { isManager, canView } = useManagerPermissions();

  const { resolvedTheme } = useTheme();
  const appName = branding?.app_name || 'DRIVE247';
  const shortName = appName.length > 4 ? appName.substring(0, 4) : appName;
  const logoUrl = resolvedTheme === 'dark' && branding?.dark_logo_url ? branding.dark_logo_url : branding?.logo_url;
  const showPendingBookings = settings?.payment_mode === 'manual';
  const collapsed = state === "collapsed";

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname?.startsWith(path) || false;
  };

  const groupHasActiveItem = (items: NavItem[]) =>
    items.some(item => isActive(item.href));

  const getTotalBadge = (items: NavItem[]) =>
    items.reduce((sum, item) => sum + (item.badge || 0), 0);

  // --- Navigation Groups ---

  const groups: NavGroup[] = [
    {
      label: "Fleet & Bookings",
      icon: AnimatedCar,
      items: [
        { name: "Vehicles", href: "/vehicles", icon: AnimatedCar },
        { name: "Rentals", href: "/rentals", icon: AnimatedFileText },
        ...(showPendingBookings ? [{ name: "Pending Bookings", href: "/pending-bookings", icon: Clock, badge: pendingBookingsCount || 0 }] : []),
        { name: "Availability", href: "/blocked-dates", icon: AnimatedCalendarDays },
      ],
    },
    {
      label: "Customers",
      icon: AnimatedUsers,
      items: [
        { name: "Customers", href: "/customers", icon: AnimatedUsers },
        { name: "Blocked Customers", href: "/blocked-customers", icon: AnimatedBan },
        { name: "Messages", href: "/messages", icon: AnimatedMessageSquare, badge: chatUnreadCount || 0 },
      ],
    },
    {
      label: "Finance",
      icon: AnimatedCreditCard,
      items: [
        { name: "Payments", href: "/payments", icon: AnimatedCreditCard },
        { name: "Invoices", href: "/invoices", icon: AnimatedReceipt },
        { name: "Fines", href: "/fines", icon: AnimatedBadgeAlert },
      ],
    },
    {
      label: "Insights",
      icon: AnimatedChartBar,
      items: [
        { name: "Documents", href: "/documents", icon: AnimatedFolderOpen },
        { name: "Reminders", href: "/reminders", icon: AnimatedBell, badge: reminderStats?.due || 0 },
        { name: "Reports", href: "/reports", icon: AnimatedChartBar },
        { name: "P&L Dashboard", href: "/pl-dashboard", icon: AnimatedTrendingUp },
      ],
    },
    {
      label: "Administration",
      icon: AnimatedEarth,
      items: [
        { name: "Website Content", href: "/cms", icon: AnimatedEarth },
        { name: "Audit Logs", href: "/audit-logs", icon: AnimatedHistory },
        { name: "Manage Users", href: "/users", icon: AnimatedUsers, headAdminOnly: true },
      ].filter(item => {
        if (item.superAdminOnly && !appUser?.is_super_admin) return false;
        if (item.headAdminOnly && appUser?.role !== 'head_admin') return false;
        return true;
      }),
    },
  ].filter(g => g.items.length > 0)
   .map(g => isManager ? { ...g, items: g.items.filter(item => {
     const tabKey = ROUTE_TO_TAB[item.href];
     return tabKey ? canView(tabKey) : true;
   })} : g)
   .filter(g => g.items.length > 0);

  // Track which groups are open — all open by default
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groups.forEach(g => {
      initial[g.label] = true;
    });
    return initial;
  });

  const allOpen = groups.every(g => openGroups[g.label]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    groups.forEach(g => { next[g.label] = !allOpen; });
    setOpenGroups(next);
  };

  // When route changes, ensure the active group is open
  useEffect(() => {
    setOpenGroups(prev => {
      const next = { ...prev };
      groups.forEach(g => {
        if (groupHasActiveItem(g.items)) {
          next[g.label] = true;
        }
      });
      return next;
    });
  }, [pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  // --- Render helpers ---

  const renderNavItem = (item: NavItem, index: number, items: NavItem[]) => {
    const isLast = index === items.length - 1;
    return (
      <SidebarMenuItem key={item.name} className="relative">
        {/* Vertical tree line */}
        {!isLast && (
          <span className="absolute left-[18px] top-0 bottom-0 w-px bg-border/50" />
        )}
        {/* Horizontal branch line */}
        <span className="absolute left-[18px] top-1/2 w-2.5 h-px bg-border/50" />
        {/* Vertical line to this item (connects from above) */}
        <span className="absolute left-[18px] top-0 h-1/2 w-px bg-border/50" />
        <SidebarMenuButton
          asChild
          isActive={isActive(item.href)}
          tooltip={collapsed ? item.name : undefined}
          className="h-8 pl-9 transition-all duration-200 ease-in-out"
        >
          <Link href={item.href} className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 min-w-0">
              <item.icon className="h-3.5 w-3.5 shrink-0" />
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
    );
  };

  return (
    <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      {/* Branding Header */}
      <SidebarHeader className="h-16 border-b">
        <div className="flex items-center justify-center w-full h-full transition-all duration-300 ease-in-out">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={appName}
              className={`object-contain transition-all duration-300 ease-in-out invert dark:invert-0 ${collapsed ? "h-10 w-10" : "h-16 w-full max-w-[180px]"}`}
              style={{ imageRendering: 'auto' }}
            />
          ) : !collapsed ? (
            <span className="text-xl font-bold text-primary tracking-wide transition-all duration-300 ease-in-out">
              {appName}
            </span>
          ) : (
            <span className="text-sm font-bold text-primary transition-all duration-300 ease-in-out">
              {shortName}
            </span>
          )}
        </div>
      </SidebarHeader>

      {/* Collapse/Expand all toggle */}
      {!collapsed && (
        <div className="flex justify-end px-2 pt-1">
          <button
            onClick={toggleAll}
            className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
            title={allOpen ? "Collapse all" : "Expand all"}
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Navigation with collapsible groups */}
      <SidebarContent className="transition-all duration-300 ease-in-out gap-0">
        {/* Dashboard — always visible at top */}
        <SidebarGroup className="p-1.5 pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isActive("/")}
                  tooltip={collapsed ? "Dashboard" : undefined}
                  className="h-8 transition-all duration-200 ease-in-out"
                >
                  <Link href="/" className="flex items-center gap-2">
                    <AnimatedBlocks className="h-4 w-4 shrink-0" />
                    <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>
                      Dashboard
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Collapsible Groups */}
        {groups.map(group => {
          const isOpen = openGroups[group.label] ?? false;
          const hasActive = groupHasActiveItem(group.items);
          const totalBadge = getTotalBadge(group.items);

          return (
            <SidebarGroup key={group.label} className="p-1.5 pb-0">
              {collapsed ? (
                /* Collapsed: popover flyout with sub-items */
                <Popover>
                  <SidebarMenu>
                    <SidebarMenuItem className="relative">
                      <PopoverTrigger asChild>
                        <SidebarMenuButton
                          className={`h-8 w-full transition-all duration-200 ease-in-out ${hasActive ? "text-primary" : ""}`}
                        >
                          <group.icon className={`h-4 w-4 shrink-0 ${hasActive ? "text-primary" : ""}`} />
                        </SidebarMenuButton>
                      </PopoverTrigger>
                      {totalBadge > 0 && (
                        <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full">
                          {totalBadge > 9 ? '9+' : totalBadge}
                        </span>
                      )}
                    </SidebarMenuItem>
                  </SidebarMenu>
                  <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1.5">
                    <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
                    <div className="space-y-0.5">
                      {group.items.map(item => (
                        <Link
                          key={item.href}
                          href={item.href}
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
              ) : (
                /* Expanded: collapsible groups */
                <Collapsible open={isOpen} onOpenChange={() => toggleGroup(group.label)}>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          className={`h-8 w-full transition-all duration-200 ease-in-out ${
                            hasActive && !isOpen ? "text-primary" : ""
                          }`}
                        >
                          <group.icon className={`h-4 w-4 shrink-0 ${hasActive ? "text-primary" : ""}`} />
                          <span className="flex-1 text-left text-[13.5px] font-semibold">
                            {group.label}
                          </span>
                          {totalBadge > 0 && !isOpen && (
                            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-destructive rounded-full shrink-0">
                              {totalBadge > 9 ? '9+' : totalBadge}
                            </span>
                          )}
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                    </SidebarMenuItem>
                  </SidebarMenu>
                  <CollapsibleContent>
                    <SidebarGroupContent>
                      <SidebarMenu className="relative ml-1">
                        {group.items.map((item, i) => renderNavItem(item, i, group.items))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      {/* Pinned Footer */}
      <SidebarFooter className="border-t p-1.5">
        <SidebarMenu>
          {/* Trial/Live Status Badge */}
          {(isTrialing || isLive) && (
            <SidebarMenuItem>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center h-8">
                      {isTrialing ? (
                        <Timer className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Zap className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {isTrialing ? `Setup Mode · ${trialDaysRemaining}d left` : "Live"}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${
                  isTrialing
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                    : "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                }`}>
                  {isTrialing ? (
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
          {(!isManager || canView('settings')) && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive("/settings")}
                tooltip={collapsed ? "Settings" : undefined}
                className="h-8 transition-all duration-200 ease-in-out"
              >
                <Link href="/settings">
                  <AnimatedSettings className="h-4 w-4 shrink-0" />
                  <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>
                    Settings
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
