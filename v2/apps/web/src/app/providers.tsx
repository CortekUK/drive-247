"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
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

      {/*
        THE TOAST MOUNT. `components/ui/sonner.tsx` has existed since the first
        commit and was never rendered until now.

        That was NOT leaving broken calls lying around: at the time of writing
        there is not one `toast(...)` call site in this app. Three files —
        `documents/upload-dialog.tsx`, `gig-driver/page.tsx` and
        `use-customer-agreements.ts` — carry a comment noting the missing mount
        and deliberately route their failures INLINE instead, which is the
        better choice for a failure that belongs next to the control that
        caused it. Those stay exactly as they are; this mount does not oblige
        anyone to start using toasts, and their comments are now merely stale
        rather than wrong.

        It is mounted for one outcome that genuinely cannot be rendered inline:
        a balance payment settles through a Stripe webhook SECONDS AFTER the
        customer has closed the dialog and possibly left the page, so the
        surface that would have shown the result no longer exists. See
        `_components/settlement-watch.tsx`.

        Outside both providers on purpose: a toast must still render if the
        tenant or the session query throws.
      */}
      <Toaster />
    </QueryClientProvider>
  );
}
