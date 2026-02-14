"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/stores/auth-store";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { SubscriptionGateDialog } from "@/components/subscription/subscription-gate-dialog";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { HeaderSearch } from "@/components/shared/layout/header-search";
import { UserMenu } from "@/components/shared/layout/user-menu";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { DynamicThemeProvider } from "@/components/shared/layout/dynamic-theme-provider";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatSidebar } from "@/components/chat";

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-16 items-center justify-between px-6 border-b">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <div className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border p-6">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-lg border p-6">
              <Skeleton className="h-6 w-32 mb-4" />
              <div className="space-y-2">
                {[...Array(5)].map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, appUser, loading } = useAuth();
  const { isSubscribed, isLoading: subscriptionLoading } = useTenantSubscription();
  const { isManager, canAccessRoute, isLoading: permissionsLoading } = useManagerPermissions();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const isSubscriptionPage = pathname === "/subscription" || pathname?.startsWith("/settings");
  const hasActivePlans = !!plans && plans.length > 0;
  const showSetupGate = !subscriptionLoading && !plansLoading && !isSubscribed && hasActivePlans && !isSubscriptionPage;

  useEffect(() => {
    if (!loading) {
      // Not authenticated - redirect to login
      if (!user || !appUser) {
        router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        return;
      }

      // Account deactivated - redirect to login
      if (!appUser.is_active) {
        router.replace("/login");
        return;
      }
    }
  }, [user, appUser, loading, router, pathname]);

  // Manager route protection
  useEffect(() => {
    if (!loading && !permissionsLoading && isManager && !canAccessRoute(pathname)) {
      router.replace('/');
    }
  }, [loading, permissionsLoading, isManager, canAccessRoute, pathname, router]);

  // Show loading skeleton while checking auth
  if (loading) {
    return <LoadingSkeleton />;
  }

  // Not authenticated - show nothing while redirecting
  if (!user || !appUser || !appUser.is_active) {
    return <LoadingSkeleton />;
  }

  return (
    <DynamicThemeProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-x-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2 sm:px-4">
            <SidebarTrigger className="-ml-1 flex-shrink-0" />
            <div className="flex-1 min-w-0 max-w-2xl">
              <HeaderSearch />
            </div>
            <div className="ml-auto flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <NotificationBell />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>

          <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
            {children}
          </main>
        </SidebarInset>

        {/* RAG Chatbot */}
        <ChatSidebar />

        {/* Hard gate — blocks access until billing setup is complete */}
        {showSetupGate && <SubscriptionGateDialog />}
      </SidebarProvider>
    </DynamicThemeProvider>
  );
}
