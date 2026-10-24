'use client';

import { PageSearchProvider } from '@/components/admin/page-search-slot';
import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Sidebar from '@/components/admin/Sidebar';
import { SidebarProvider } from '@/components/admin/SidebarContext';
import { SidebarSectionsProvider } from '@/components/admin/sidebar-sections';
import { TopBar } from '@/components/admin/TopBar';
import { AdminNavProvider } from '@/components/admin/admin-nav';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminSupportRail } from '@/components/support/AdminSupportRail';
import { SupportRailProvider } from '../../../../../shared/trax-support/support-rail';
import { MobileNavProvider, MobileTabBar, PhoneSectionChips } from '@/components/admin/mobile-nav';

function LoadingScreen() {
  return (
    <div className="flex h-screen bg-background bg-app-gradient">
      {/* Sidebar skeleton */}
      {/* The same 16rem, borderless rail the real sidebar draws, so nothing
          shifts when the session lands. */}
      <div className="hidden md:flex flex-col h-screen w-64 flex-shrink-0 p-1.5 pt-4 gap-4">
        <div className="flex items-center gap-2.5 p-1.5">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
        <div className="space-y-1 px-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
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
  const [queryClient] = useState(() => new QueryClient());

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
  /* A rental company's own page is a one-screen workspace: no top bar on a
     desktop either (a phone keeps it for the navigation menu). */
  const isCompanyPage = /^\/admin\/rentals\/[^/]+$/.test(pathname);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return null;
  }

  return (
    /*
     * react-query has one consumer in this app — `FinanceEventsTab`, behind
     * Finance Sync on a rental company — and until now there was no
     * `QueryClientProvider` anywhere in the tree at all. Opening that section
     * threw "No QueryClient set" and took the whole page down with a
     * client-side exception. It has been that way since finance-sync was
     * built (792bf44c); it only became obvious when the section moved from a
     * tab into the rail and someone pressed it.
     *
     * The client is made once per mount and held in state rather than at
     * module scope: a module-level client is shared across every render of
     * every user on a server, which is how one account ends up reading
     * another's cached rows.
     */
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AdminNavProvider>
      {/* A list page lends its search to the top bar (page-search-slot.tsx). */}
      <PageSearchProvider>
      {/* A page's own sections render in the sidebar rather than as tabs
          across the top; this is what carries them there. */}
      <SidebarSectionsProvider>
      <SupportRailProvider>
      {/* The phone's bottom tab bar and its More screen (mobile-nav.tsx). */}
      <MobileNavProvider>
      {/* Northwind's frame: the brand wash on the provider, bounded to one
          viewport, so the rail and the page are one surface and `<main>` is
          the only thing that scrolls. */}
      <SidebarProvider className="h-svh overflow-hidden bg-background bg-app-gradient">
        {/* On Support a phone keeps the navigation sheet behind the top bar's menu. */}
        {isSupport ? <><AdminSupportRail /><Sidebar desktop={false} /></> : <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pt-[env(safe-area-inset-top,0px)]">
          {/* Support is its own workspace: no top bar on a desktop (the rail has
              Back to dashboard). A phone keeps it for the navigation menu. */}
          {/* On a phone the tab bar is the navigation, so the top bar's menu
              button goes — except on Support, a bounded workspace whose
              composer owns the bottom edge and which keeps the sheet. */}
          {isSupport || isCompanyPage ? (
            <div className="md:hidden"><TopBar showNavTrigger={isSupport} /></div>
          ) : (
            <TopBar showNavTrigger={false} />
          )}
          {/* A page's own sections, which a desktop shows in the rail. */}
          {!isSupport && <PhoneSectionChips />}
          {/* `data-scrollport` is what the house scrollbar rule in globals.css
              hooks onto. The top bar already gives the page its breathing room
              on a desktop, so the page starts close under it, as in Northwind. */}
          <main
            data-scrollport
            className={isSupport ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden'}
          >
            {/* Below `md` the last row clears the tab bar: 60px plus the home
                indicator, with room to spare. */}
            <div className={isSupport ? 'flex min-h-0 flex-1 flex-col p-3 pt-0 sm:p-4 sm:pt-0 md:pt-4' : `${isCompanyPage ? 'p-4 pt-1 sm:p-6 sm:pt-2 md:pt-6' : 'p-4 pt-1 sm:p-6 sm:pt-2'} max-md:pb-[calc(env(safe-area-inset-bottom,0px)+5rem)]`}>
              {children}
            </div>
          </main>
        </div>
        {/* Not on Support: its composer owns the bottom edge. */}
        {!isSupport && <MobileTabBar />}
      </SidebarProvider>
      </MobileNavProvider>
      </SupportRailProvider>
      </SidebarSectionsProvider>
      </PageSearchProvider>
      </AdminNavProvider>
    </TooltipProvider>
    </QueryClientProvider>
  );
}
