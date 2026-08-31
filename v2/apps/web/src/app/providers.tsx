"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TenantProvider } from "@/contexts/TenantContext";

export function Providers({
  children,
  tenantSlug = null,
}: {
  children: ReactNode;
  /** Slug the middleware resolved for this request, via the `x-tenant-slug` header. */
  tenantSlug?: string | null;
}) {
  // One client per browser session, created lazily so it is never shared across
  // requests during server rendering — a shared client would leak one visitor's
  // cached tenant data into another's response.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Matches apps/booking. Individual queries opt back into focus
            // refetching where staleness has consequences (see TenantContext).
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider initialTenantSlug={tenantSlug}>{children}</TenantProvider>
    </QueryClientProvider>
  );
}
