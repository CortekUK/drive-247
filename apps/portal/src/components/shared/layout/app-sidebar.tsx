"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Car, Users, FileText, CreditCard, LayoutDashboard, Bell, BarChart3, AlertCircle, Bookmark, TrendingUp, Settings, Shield, Ban, Receipt, FolderOpen, UserX, Globe, Crown, History, Clock, Star } from "lucide-react";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { useReminderStats } from "@/hooks/use-reminders";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { usePendingBookingsCount } from "@/hooks/use-pending-bookings";
import { useAuthStore } from "@/stores/auth-store";

export function AppSidebar() {
  const {
    state
  } = useSidebar();
  const pathname = usePathname();
  const {
    data: reminderStats
  } = useReminderStats();
  const { settings } = useOrgSettings();
  const { branding } = useTenantBranding();
  const { data: pendingBookingsCount } = usePendingBookingsCount();
  const { appUser } = useAuthStore();

  // Get app name and logo from tenant branding or fallback to defaults
  const appName = branding?.app_name || 'DRIVE917';
  const shortName = appName.length > 4 ? appName.substring(0, 4) : appName;
  const logoUrl = branding?.logo_url;

  // Hide pending bookings when automated payment mode is enabled
  const showPendingBookings = settings?.payment_mode === 'manual';

  // Main navigation items
  const mainNavigation = [
    {
      name: "Dashboard",
      href: "/",
      icon: LayoutDashboard
    },
    {
      name: "Vehicles",
      href: "/vehicles",
      icon: Car
    },
    {
      name: "Customers",
      href: "/customers",
      icon: Users
    },
    {
      name: "Blocked Customers",
      href: "/blocked-customers",
      icon: UserX
    },
    {
      name: "Rentals",
      href: "/rentals",
      icon: FileText
    },
    ...(showPendingBookings ? [{
      name: "Pending Bookings",
      href: "/pending-bookings",
      icon: Clock,
      badge: pendingBookingsCount || 0
    }] : []),
    {
      name: "Payments",
      href: "/payments",
      icon: CreditCard
    },
    {
      name: "Invoices",
      href: "/invoices",
      icon: Receipt
    },
    {
      name: "Documents",
      href: "/documents",
      icon: FolderOpen
    },
    {
      name: "Fines",
      href: "/fines",
      icon: AlertCircle
    }
  ];

  // Operations navigation items
  const operationsNavigation = [{
    name: "Promotions",
    href: "/promotions",
    icon: Crown
  },  {
    name: "Blocked Dates",
    href: "/blocked-dates",
    icon: Ban
  }, {
    name: "Reminders",
    href: "/reminders",
    icon: Bell,
    badge: reminderStats?.due || 0
  }, {
    name: "Reports",
    href: "/reports",
    icon: BarChart3
  }, {
    name: "P&L Dashboard",
    href: "/pl-dashboard",
    icon: TrendingUp
  }];

  // Settings navigation - filter based on super admin status
  const allSettingsNavigation = [{
    name: "Testimonials",
    href: "/testimonials",
    icon: Star
  }, {
    name: "Audit Logs",
    href: "/audit-logs",
    icon: History
  }, {
    name: "Website Content",
    href: "/cms",
    icon: Globe
  }, {
    name: "Settings",
    href: "/settings",
    icon: Settings
  }];

  const settingsNavigation = allSettingsNavigation.filter(item =>
    !item.superAdminOnly || appUser?.is_super_admin
  );
  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname?.startsWith(path) || false;
  };
  const collapsed = state === "collapsed";
  return <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      <SidebarHeader className="h-16 border-b">
        <div className="flex items-center justify-center w-full h-full transition-all duration-300 ease-in-out">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={appName}
              className={`object-cover transition-all duration-300 ease-in-out mt-2 ${collapsed ? "h-20 w-32" : "h-20 w-32 max-w-[380px]"}`}
              style={{ imageRendering: 'crisp-edges' }}
            />
          ) : (
            !collapsed ? (
              <span className="text-[22px] font-bold text-primary tracking-wide transition-all duration-300 ease-in-out">{appName}</span>
            ) : (
              <span className="text-base font-bold text-primary transition-all duration-300 ease-in-out">{shortName}</span>
            )
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="transition-all duration-300 ease-in-out">
        {/* Main Navigation */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className="transition-opacity duration-200 ease-in-out">Main</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavigation.map(item => <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={collapsed ? item.name : undefined} className="transition-all duration-200 ease-in-out">
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4 shrink-0 transition-all duration-200 ease-in-out" />
                      <span className={`transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>{item.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Operations Navigation */}
        <SidebarGroup className="pt-4">
          {!collapsed && <SidebarGroupLabel className="transition-opacity duration-200 ease-in-out">Operations</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {operationsNavigation.map(item => <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={collapsed ? item.name : undefined} className="transition-all duration-200 ease-in-out">
                    <Link href={item.href} className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <item.icon className="h-4 w-4 shrink-0 transition-all duration-200 ease-in-out" />
                        <span className={`transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>{item.name}</span>
                      </div>
                      {!collapsed && item.badge !== undefined && item.badge > 0 && <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-destructive rounded-full shrink-0 transition-all duration-200 ease-in-out animate-in fade-in">
                          {item.badge}
                        </span>}
                      {collapsed && item.badge !== undefined && item.badge > 0 && <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full transition-all duration-200 ease-in-out animate-in fade-in">
                          {item.badge > 9 ? '9+' : item.badge}
                        </span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings Navigation */}
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel className="transition-opacity duration-200 ease-in-out">Administration</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNavigation.map(item => <SidebarMenuItem key={item.name}>
                  <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={collapsed ? item.name : undefined} className="transition-all duration-200 ease-in-out">
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4 shrink-0 transition-all duration-200 ease-in-out" />
                      <span className={`transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "opacity-100"}`}>{item.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>


    </Sidebar>;
}
