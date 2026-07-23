"use client";

import { Ban } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';

/**
 * Blocks the entire customer-facing booking site when the tenant's `status` is
 * `suspended`. Rendered inside TenantProvider around all page content, so no
 * booking page, fleet listing, or checkout is reachable while suspended — new
 * customer payments are frozen platform-wide for that operator.
 *
 * A null/loading tenant renders children normally (individual pages keep their
 * own loading/not-found handling); only an explicitly suspended tenant is gated.
 */
export function SuspendedGate({ children }: { children: React.ReactNode }) {
  const { tenant } = useTenant();

  if (tenant?.status === 'suspended') {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl">
          <div className="h-1.5 bg-gradient-to-r from-destructive via-destructive/80 to-orange-500" />
          <div className="p-8">
            <div className="flex flex-col items-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 ring-4 ring-destructive/5">
                <Ban className="h-8 w-8 text-destructive" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                Currently unavailable
              </h1>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {tenant.company_name || 'This service'} isn&apos;t taking
                bookings right now. Please check back later.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
