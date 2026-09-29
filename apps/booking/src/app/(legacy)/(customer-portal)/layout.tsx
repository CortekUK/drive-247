'use client';

import { useEffect, useState } from 'react';
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
import { BlockedAccountDialog } from '@/components/BlockedAccountDialog';
import { AnnouncementModalGate } from '@/components/customer-portal/announcements/AnnouncementModalGate';

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

  const [showBlockedDialog, setShowBlockedDialog] = useState(false);

  // Defense-in-depth: ensure customer belongs to the current tenant
  const tenantMismatch = customerUser && tenant?.id &&
    customerUser.customer.tenant_id !== tenant.id;

  // Check if customer is blocked
  const isBlocked = !!customerUser?.customer?.is_blocked;

  useEffect(() => {
    // Wait for auth to initialize
    if (!initialized) return;

    // Not authenticated or wrong tenant - redirect to home with login prompt
    if (!customerUser || !session || tenantMismatch) {
      // Store the intended destination
      const returnUrl = encodeURIComponent(pathname || '/portal');
      // Two sites share this portal. Send the visitor back to the one they came
      // from — the custom site marks itself in sessionStorage as it loads — so
      // nobody is dropped onto a site they have never seen, and the login they
      // meet is the one styled like the site they were using.
      let base = '/';
      try {
        if (sessionStorage.getItem('cbp-site') === '1') base = '/custom-booking-page';
      } catch {
        // Storage blocked; the existing site is the safe default.
      }
      router.replace(`${base}?auth=login&from=${returnUrl}`);
      return;
    }

    // If customer is blocked, show dialog and sign them out
    if (isBlocked) {
      setShowBlockedDialog(true);
    }
  }, [customerUser, session, loading, initialized, router, pathname, tenantMismatch, isBlocked]);

  // Show loading skeleton while checking auth
  if (loading || !initialized) {
    return <LoadingSkeleton />;
  }

  // Not authenticated or tenant mismatch - show skeleton while redirecting
  if (!customerUser || !session || tenantMismatch) {
    return <LoadingSkeleton />;
  }

  // Blocked customer - show dialog and prevent portal access
  if (isBlocked) {
    return (
      <BlockedAccountDialog
        open={showBlockedDialog}
        onOpenChange={(open) => {
          setShowBlockedDialog(open);
          if (!open) {
            // Sign out and redirect when dialog is closed
            useCustomerAuthStore.getState().signOut();
            router.replace('/');
          }
        }}
      />
    );
  }

  return (
    <CustomerRealtimeChatProvider>
      <SidebarProvider>
        <CustomerPortalSidebar />
        {/* WHY NOT `overflow-x-hidden`, which is what was here.
            `SidebarInset` is `flex min-h-svh flex-1` with no `min-w-0`, and a
            flex item defaults to `min-width: auto` — it refuses to shrink below
            its content, so one wide row widened the whole column and the PAGE
            grew a horizontal scrollbar. `overflow-x-hidden` was added to bury
            that, and it made things worse in a way that is easy to miss: per
            spec, `overflow-x: hidden` against a visible `overflow-y` computes
            the y axis to `auto`, which turns this element into its own scroll
            container. That is the second, nested scrollbar the portal has and
            Northwind's does not.
            `min-w-0` is the actual fix — it lets the column shrink, so nothing
            forces the page wide. `overflow-x-clip` keeps the belt-and-braces
            clipping WITHOUT creating a scroll container, so the page is left
            with exactly one, like Northwind's shell. */}
        <SidebarInset className="min-w-0 overflow-x-clip">
          <CustomerPortalHeader />
          <main className="flex flex-1 flex-col gap-4 p-4 pt-4">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
      <TraxChatWidget />
      <AnnouncementModalGate />
    </CustomerRealtimeChatProvider>
  );
}
