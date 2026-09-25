'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Sidebar from '@/components/admin/Sidebar';
import { SidebarProvider } from '@/components/admin/SidebarContext';
import { SidebarSectionsProvider } from '@/components/admin/sidebar-sections';
import { Header } from '@/components/admin/Header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminSupportRail } from '@/components/support/AdminSupportRail';
import { SupportRailProvider } from '../../../../../shared/trax-support/support-rail';

function LoadingScreen() {
  return (
    <div className="flex h-screen bg-background bg-app-gradient">
      {/* Sidebar skeleton */}
      <div className="hidden md:flex flex-col h-screen w-[280px] border-r border-border flex-shrink-0 p-4 gap-4">
        <div className="flex items-center gap-3 h-12">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <div className="space-y-2 mt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </div>
      {/* Main content skeleton */}
      <div className="flex-1 p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/admin/login');
    }
  }, [user, loading, router]);

  // Sales-only users (sales agent without super admin) are confined to /admin/sales,
  // plus Promo Codes, where they may look up codes and copy referral links (the
  // page and admin-promo-codes both refuse them anything that changes money).
  useEffect(() => {
    if (loading || !user) return;
    if (
      user.is_sales_agent &&
      !user.is_super_admin &&
      !pathname.startsWith('/admin/sales') &&
      !pathname.startsWith('/admin/promo-codes')
    ) {
      router.replace('/admin/sales');
    }
  }, [user, loading, pathname, router]);

  /* Support is tickets | conversation | details. Its ticket list takes the
     navigation's slot on a desktop (AdminSupportRail) instead of a fourth column,
     and the page bounds its own height so each column scrolls inside itself. */
  const isSupport = pathname === '/admin/support' || pathname.startsWith('/admin/support/');

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return null;
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        {/* A page's own sections render in the sidebar rather than as tabs
            across the top; this is what carries them there. */}
        <SidebarSectionsProvider>
        <SupportRailProvider>
        {/* The brand wash, on every page behind the sign-in — not just the
            login screen, which is where it used to stop. This is the layer
            that makes a page read as part of the product rather than as a
            white box with the product's cards on it. */}
        <div className="flex h-screen overflow-hidden bg-background bg-app-gradient">
          {/* On Support a phone keeps the navigation sheet behind the header's menu. */}
          {isSupport ? <><AdminSupportRail /><Sidebar desktop={false} /></> : <Sidebar />}
          <div className="flex-1 flex min-w-0 flex-col overflow-hidden">
            <Header />
            {/* `data-scrollport` is what the house scrollbar rule in
                globals.css hooks onto. This element is the ONLY thing that
                scrolls on a page behind the sign-in — the frame around it is
                `h-screen overflow-hidden` and the sidebar has its own
                ScrollArea — so its bar is the one an operator sees. */}
            <main
              data-scrollport
              className={isSupport ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'flex-1 overflow-y-auto'}
            >
              <div className={isSupport ? 'flex min-h-0 flex-1 flex-col p-3 sm:p-4' : 'p-4 sm:p-6'}>
                {children}
              </div>
            </main>
          </div>
        </div>
        </SupportRailProvider>
        </SidebarSectionsProvider>
      </SidebarProvider>
    </TooltipProvider>
  );
}
