'use client';

/**
 * Everything behind the sign-in. The super-admin dashboard's frame
 * (apps/admin/app/admin/(protected)/layout.tsx), reduced: the brand wash on
 * the provider, bounded to one viewport, the rail beside it, and `<main>` as
 * the only thing that scrolls. Signed out, or not a super admin, means /login.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingScreen() {
  return (
    <div className="flex h-screen bg-background bg-app-gradient">
      {/* The real rail's 16rem, so nothing shifts when the session lands. */}
      <div className="hidden h-screen w-64 flex-shrink-0 flex-col gap-4 p-1.5 pt-4 md:flex">
        <div className="flex items-center gap-2.5 p-1.5">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
        <div className="px-1.5">
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
      </div>
      <div className="flex-1 space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh overflow-hidden bg-background bg-app-gradient">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pt-[env(safe-area-inset-top,0px)]">
          {/* A phone's only way to the navigation; a desktop collapses the
              rail on its own hairline and ⌘B, so it has no top bar at all. */}
          <header className="flex h-14 shrink-0 items-center px-3 md:hidden">
            <SidebarTrigger aria-label="Open navigation" className="-ml-1" />
          </header>
          <main data-scrollport className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-4 pt-1 sm:p-6 sm:pt-2 md:pt-6">{children}</div>
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
