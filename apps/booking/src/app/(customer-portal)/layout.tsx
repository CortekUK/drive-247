'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { CustomerPortalSidebar } from '@/components/customer-portal/CustomerPortalSidebar';
import { CustomerPortalHeader } from '@/components/customer-portal/CustomerPortalHeader';
import { TraxChatWidget } from '@/components/customer-portal/trax-chat';
import {
  SidebarProvider,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { CustomerRealtimeChatProvider } from '@/contexts/CustomerRealtimeChatContext';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-16 items-center justify-between px-6 border-b">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border p-6">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-6 w-32 mb-4" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CustomerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { customerUser, session, loading, initialized } = useCustomerAuthStore();
  const { tenant } = useTenant();

  // Defense-in-depth: ensure customer belongs to the current tenant
  const tenantMismatch = customerUser && tenant?.id &&
    customerUser.customer.tenant_id !== tenant.id;

  useEffect(() => {
    // Wait for auth to initialize
    if (!initialized) return;

    // Not authenticated or wrong tenant - redirect to home with login prompt
    if (!customerUser || !session || tenantMismatch) {
      // Store the intended destination
      const returnUrl = encodeURIComponent(pathname || '/portal');
      router.replace(`/?auth=login&from=${returnUrl}`);
    }
  }, [customerUser, session, loading, initialized, router, pathname, tenantMismatch]);

  // Show loading skeleton while checking auth
  if (loading || !initialized) {
    return <LoadingSkeleton />;
  }

  // Not authenticated or tenant mismatch - show skeleton while redirecting
  if (!customerUser || !session || tenantMismatch) {
    return <LoadingSkeleton />;
  }

  return (
    <CustomerRealtimeChatProvider>
      <SidebarProvider>
        <CustomerPortalSidebar />
        <SidebarInset className="overflow-x-hidden">
          <CustomerPortalHeader />
          <main className="flex flex-1 flex-col gap-4 p-4 pt-4">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
      <TraxChatWidget />
    </CustomerRealtimeChatProvider>
  );
}
