import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
import { FinancesView } from '@/components/finances/finances-view';

/**
 * Finances — one tab over payments, invoices, fines and payment plans
 * (docs/FINANCES_DESIGN.md).
 *
 * The gate is resolved HERE, on the server, before anything renders — the
 * same shape as `/insights` and `/integrations`. A tenant not on the
 * `finances` v2 area gets the portal's normal 404, exactly as it did before
 * this route existed; its Payments, Invoices and Fines tabs are untouched.
 *
 * `finances` is a SLUG-ONLY area (`SLUG_ONLY_AREAS` in lib/v2.ts): northwind
 * and nobody else, whatever `tenants.portal_experience` says. `serverIsV2`
 * reads the flags `resolvePortalGates` computed with `isV2`, which applies
 * that rule, so the route, the sidebar row and the redirects in `proxy.ts`
 * all answer the same question the same way. It never throws, and fails
 * closed to `notFound()`.
 *
 * Managers: `/finances` is mapped in `lib/permissions.ts` to the `payments`
 * key and ALSO opened by `invoices` or `fines` (`ROUTE_ALSO_ALLOWED_BY`); the
 * dashboard layout's route guard enforces that, and each view inside is gated
 * on its own key.
 *
 * The view is a Client Component (URL state, React Query). `useSearchParams`
 * is read inside it, hence the Suspense boundary.
 */
export default async function FinancesPage() {
  if (!(await serverIsV2('finances'))) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <FinancesView />
    </Suspense>
  );
}
