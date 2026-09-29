'use client';

import { QueryClient, QueryClientProvider as TanStackQueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryClientProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /*
             * A STALE WINDOW, NOT A SWITCHED-OFF REFETCH.
             *
             * This client was `new QueryClient()` with no options at all, which
             * means React Query's defaults: `staleTime: 0` and
             * `refetchOnWindowFocus: true`. Every page of the customer portal
             * therefore refetched EVERY query each time the renter switched
             * back to the tab, and again on every navigation — which is what
             * made the portal feel slow to come back to.
             *
             * Focus refetching is deliberately kept ON, unlike the Northwind
             * client. Agreements open the signing page in a NEW TAB
             * (`window.open(signingUrl, '_blank')` in agreements/page.tsx and
             * bookings/[id]/page.tsx), so returning to the portal tab is the
             * only moment we learn the document was signed. Turning it off
             * would leave a customer staring at "awaiting signature" on a
             * contract they had just signed.
             *
             * `staleTime` is what fixes the complaint without touching that: a
             * flick to another tab and back inside 30s now costs nothing, while
             * signing — which takes minutes — still lands on fresh data.
             */
            staleTime: 30_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  );
}
