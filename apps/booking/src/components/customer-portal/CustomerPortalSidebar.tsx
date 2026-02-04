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
  MessageSquare,
  CreditCard,
} from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useCustomerUnreadCount } from '@/hooks/use-customer-unread';

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
    title: 'Payments',
    href: '/portal/payments',
    icon: CreditCard,
    description: 'View installments & payments',
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
  {
    title: 'Messages',
    href: '/portal/messages',
    icon: MessageSquare,
    description: 'Chat with support',
  },
];

export function CustomerPortalSidebar() {
  const pathname = usePathname();
  const { settings } = useSiteSettings();
  const { state } = useSidebar();
  const { unreadCount } = useCustomerUnreadCount();

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
                const isMessages = item.href === '/portal/messages';
                const showBadge = isMessages && unreadCount > 0;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.href} className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </div>
                        {showBadge && state === 'expanded' && (
                          <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-destructive rounded-full">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                        )}
                        {showBadge && state === 'collapsed' && (
                          <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full">
                            {unreadCount > 9 ? '9+' : unreadCount}
                          </span>
                        )}
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
