import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
import { FinancesView } from '@/components/finances-v2/finances-view';

/**
 * Finances — Payments, Invoices and Fines as one screen with three tabs.
 *
 * The gate is resolved HERE, on the server, once, before anything renders
 * (V2_PLAN §3). A tenant outside the `finances` area gets the 404 screen and
 * keeps using `/payments`, `/invoices` and `/fines`, which are untouched.
 */
export default async function FinancesPage() {
  if (!(await serverIsV2('finances'))) {
    notFound();
  }
  // FinancesView reads `?tab=` (and the Fines tab reads its own params), so it
  // needs a Suspense boundary for `useSearchParams`.
  return (
    <Suspense fallback={null}>
      <FinancesView />
    </Suspense>
  );
}
