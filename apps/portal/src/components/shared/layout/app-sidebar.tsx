"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, Users, FileText, CreditCard, LayoutDashboard, Bell, BarChart3, AlertCircle, TrendingUp, Settings, CalendarDays, Receipt, FolderOpen, UserX, Globe, History, Clock, UsersRound, MessageSquare, Crown, Sparkles, Timer, ChevronRight } from "lucide-react";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useReminderStats } from "@/hooks/use-reminders";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { usePendingBookingsCount } from "@/hooks/use-pending-bookings";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useAuthStore } from "@/stores/auth-store";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";

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
  const { isSubscribed, isTrialing, trialDaysRemaining } = useTenantSubscription();

  const appName = branding?.app_name || 'DRIVE247';
  const shortName = appName.length > 4 ? appName.substring(0, 4) : appName;
  const logoUrl = branding?.logo_url;
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
      icon: Car,
      items: [
        { name: "Vehicles", href: "/vehicles", icon: Car },
        { name: "Rentals", href: "/rentals", icon: FileText },
        ...(showPendingBookings ? [{ name: "Pending Bookings", href: "/pending-bookings", icon: Clock, badge: pendingBookingsCount || 0 }] : []),
        { name: "Availability", href: "/blocked-dates", icon: CalendarDays },
      ],
    },
    {
      label: "Customers",
      icon: Users,
      items: [
        { name: "Customers", href: "/customers", icon: Users },
        { name: "Blocked Customers", href: "/blocked-customers", icon: UserX },
        { name: "Messages", href: "/messages", icon: MessageSquare, badge: chatUnreadCount || 0 },
      ],
    },
    {
      label: "Finance",
      icon: CreditCard,
      items: [
        { name: "Payments", href: "/payments", icon: CreditCard },
        { name: "Invoices", href: "/invoices", icon: Receipt },
        { name: "Fines", href: "/fines", icon: AlertCircle },
      ],
    },
    {
      label: "Insights",
      icon: BarChart3,
      items: [
        { name: "Documents", href: "/documents", icon: FolderOpen },
        { name: "Reminders", href: "/reminders", icon: Bell, badge: reminderStats?.due || 0 },
        { name: "Reports", href: "/reports", icon: BarChart3 },
        { name: "P&L Dashboard", href: "/pl-dashboard", icon: TrendingUp },
      ],
    },
    {
      label: "Administration",
      icon: Globe,
      items: [
        { name: "Website Content", href: "/cms", icon: Globe },
        { name: "Audit Logs", href: "/audit-logs", icon: History },
        { name: "Manage Users", href: "/users", icon: UsersRound, headAdminOnly: true },
      ].filter(item => {
        if (item.superAdminOnly && !appUser?.is_super_admin) return false;
        if (item.headAdminOnly && appUser?.role !== 'head_admin') return false;
        return true;
      }),
    },
  ].filter(g => g.items.length > 0);

  // Track which groups are open — auto-open the group with the active route
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    groups.forEach(g => {
      initial[g.label] = groupHasActiveItem(g.items);
    });
    return initial;
  });

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

  const renderNavItem = (item: NavItem) => (
    <SidebarMenuItem key={item.name}>
      <SidebarMenuButton
        asChild
        isActive={isActive(item.href)}
        tooltip={collapsed ? item.name : undefined}
        className="h-8 pl-8 transition-all duration-200 ease-in-out"
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

  return (
    <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      {/* Branding Header */}
      <SidebarHeader className="h-16 border-b">
        <div className="flex items-center justify-center w-full h-full transition-all duration-300 ease-in-out">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={appName}
              className={`object-contain transition-all duration-300 ease-in-out ${collapsed ? "h-10 w-10" : "h-10 w-full max-w-[100px]"}`}
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
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
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
              <Collapsible open={collapsed ? false : isOpen} onOpenChange={() => !collapsed && toggleGroup(group.label)}>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={collapsed ? group.label : undefined}
                        className={`h-8 w-full transition-all duration-200 ease-in-out ${
                          hasActive && !isOpen ? "text-primary" : ""
                        }`}
                      >
                        <group.icon className={`h-4 w-4 shrink-0 ${hasActive ? "text-primary" : ""}`} />
                        <span className={`flex-1 text-left text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>
                          {group.label}
                        </span>
                        {!collapsed && totalBadge > 0 && !isOpen && (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white bg-destructive rounded-full shrink-0">
                            {totalBadge > 9 ? '9+' : totalBadge}
                          </span>
                        )}
                        {!collapsed && (
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  </SidebarMenuItem>
                </SidebarMenu>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map(renderNavItem)}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      {/* Pinned Footer */}
      <SidebarFooter className="border-t p-1.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive("/subscription") || isActive("/settings?tab=subscription")}
              tooltip={collapsed ? (isTrialing ? "Trial Active" : isSubscribed ? "Subscription" : "Upgrade") : undefined}
              className={`h-8 transition-all duration-200 ease-in-out ${
                !isSubscribed
                  ? "bg-primary/[0.08] text-primary hover:bg-primary/[0.14] font-medium"
                  : ""
              }`}
            >
              <Link href={isSubscribed ? "/settings?tab=subscription" : "/subscription"}>
                {isTrialing ? (
                  <Timer className="h-4 w-4 shrink-0 text-amber-500" />
                ) : isSubscribed ? (
                  <Crown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                )}
                <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>
                  {isTrialing ? "Trial Active" : isSubscribed ? "Subscription" : "Upgrade"}
                </span>
              </Link>
            </SidebarMenuButton>
            {isTrialing && !collapsed && (
              <div className="px-3 py-1 text-xs text-amber-500 font-medium">
                {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining
              </div>
            )}
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive("/settings")}
              tooltip={collapsed ? "Settings" : undefined}
              className="h-8 transition-all duration-200 ease-in-out"
            >
              <Link href="/settings">
                <Settings className="h-4 w-4 shrink-0" />
                <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>
                  Settings
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
