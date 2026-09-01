"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CustomerAuthProvider } from "@/contexts/CustomerAuthContext";
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
      {/*
        CustomerAuthProvider sits INSIDE TenantProvider, and the nesting is a
        dependency rather than a preference: a customer account belongs to one
        tenant, so "who is signed in" cannot be answered before "whose site is
        this". Hoisting it out would resolve memberships against no tenant —
        which is how v1 briefly admits one operator's customer to another's.
      */}
      <TenantProvider initialTenantSlug={tenantSlug}>
        <CustomerAuthProvider>{children}</CustomerAuthProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}
