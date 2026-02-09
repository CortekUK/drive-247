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
  Shield,
  Home,
  ChevronLeft,
  FileText,
  MessageSquare,
  CreditCard,
  FileSignature,
  AlertCircle,
  Settings,
} from 'lucide-react';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useCustomerUnreadCount } from '@/hooks/use-customer-unread';
import { useCustomerOnboarding } from '@/hooks/use-customer-onboarding';

const navItems = [
  {
    title: 'Bookings',
    href: '/portal/bookings',
    icon: Car,
    description: 'View and manage your rentals',
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
    title: 'Agreements',
    href: '/portal/agreements',
    icon: FileSignature,
    description: 'View rental agreements',
  },
  {
    title: 'Messages',
    href: '/portal/messages',
    icon: MessageSquare,
    description: 'Chat with support',
  },
  {
    title: 'Settings',
    href: '/portal/settings',
    icon: Settings,
    description: 'Account settings',
  },
];

export function CustomerPortalSidebar() {
  const pathname = usePathname();
  const { settings } = useSiteSettings();
  const { state } = useSidebar();
  const { unreadCount } = useCustomerUnreadCount();
  const { data: onboarding } = useCustomerOnboarding();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b h-16 flex items-center justify-center p-0">
        {state === 'expanded' ? (
          <Link href="/" className="flex items-center gap-2 px-4">
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
          <Link href="/" className="flex items-center justify-center">
            <Home className="h-5 w-5" />
          </Link>
        )}
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
                const isVerification = item.href === '/portal/verification';
                const isInsurance = item.href === '/portal/documents';

                // Show message unread badge
                const showMessageBadge = isMessages && unreadCount > 0;

                // Show onboarding warning badges
                const showVerificationWarning = isVerification && onboarding && !onboarding.isVerified;
                const showInsuranceWarning = isInsurance && onboarding && !onboarding.hasInsurance;

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
                    {/* Message unread count badge */}
                    {showMessageBadge && (
                      <span className={`absolute ${state === 'collapsed' ? '-top-1 -right-1 w-4 h-4 text-[10px]' : 'top-1.5 right-2 px-2 py-0.5 text-xs'} inline-flex items-center justify-center font-bold leading-none text-white bg-destructive rounded-full`}>
                        {state === 'collapsed' ? (unreadCount > 9 ? '9+' : unreadCount) : (unreadCount > 99 ? '99+' : unreadCount)}
                      </span>
                    )}
                    {/* Verification warning badge */}
                    {showVerificationWarning && (
                      <span
                        className={`absolute ${state === 'collapsed' ? '-top-1 -right-1' : 'top-1.5 right-2'} text-amber-500`}
                        title="ID verification required"
                      >
                        <AlertCircle className="h-4 w-4" />
                      </span>
                    )}
                    {/* Insurance warning badge */}
                    {showInsuranceWarning && (
                      <span
                        className={`absolute ${state === 'collapsed' ? '-top-1 -right-1' : 'top-1.5 right-2'} text-amber-500`}
                        title="Insurance document required"
                      >
                        <AlertCircle className="h-4 w-4" />
                      </span>
                    )}
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
