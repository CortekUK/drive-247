'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Car,
  History,
  Shield,
  Home,
  ChevronLeft,
  FileText,
} from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';

const navItems = [
  {
    title: 'Current Bookings',
    href: '/portal/bookings',
    icon: Car,
    description: 'View your active rentals',
  },
  {
    title: 'Past Bookings',
    href: '/portal/bookings/history',
    icon: History,
    description: 'View your booking history',
  },
  {
    title: 'ID Verification',
    href: '/portal/verification',
    icon: Shield,
    description: 'Manage your verification',
  },
  {
    title: 'Insurance',
    href: '/portal/documents',
    icon: FileText,
    description: 'Manage your insurance',
  },
];

export function CustomerPortalSidebar() {
  const pathname = usePathname();
  const { settings } = useSiteSettings();
  const { state } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-3 px-2 py-3">
          {state === 'expanded' ? (
            <Link href="/" className="flex items-center gap-2">
              {settings.logo_url ? (
                <img
                  src={settings.logo_url}
                  alt={settings.logo_alt || 'Logo'}
                  className="h-8 w-auto"
                />
              ) : (
                <span className="font-semibold text-lg">
                  {settings.company_name || 'Drive247'}
                </span>
              )}
            </Link>
          ) : (
            <Link href="/" className="mx-auto">
              <Home className="h-5 w-5" />
            </Link>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== '/portal/bookings' && pathname.startsWith(item.href));

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back to Booking">
              <Link href="/">
                <ChevronLeft className="h-4 w-4" />
                <span>Back to Booking</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
