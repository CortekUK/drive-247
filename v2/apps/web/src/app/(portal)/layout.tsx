'use client';

/**
 * The gate. Everything under `(portal)` is behind it.
 *
 * ── NO FLASH ────────────────────────────────────────────────────────────────
 * v1's customer portal renders its children as soon as the store reports a
 * session and only *then* checks the tenant, so a signed-out visitor sees the
 * shell for a frame before being bounced. This layout never mounts `children`
 * until `isAuthenticated` is true. That is a stronger guarantee than hiding the
 * shell with CSS: the pages below run React Query hooks on mount, so a page
 * that renders "while redirecting" also FIRES ITS QUERIES — against a customer
 * id that is null, which is harmless, or worse, against a stale one from the
 * previous session, which is not. Not mounting them is the fix.
 *
 * The redirect itself lives in an effect because `router.replace` cannot be
 * called during render. The `PortalBoot` fallback covers the tick between the
 * decision and the navigation.
 *
 * ── WHAT THIS GATE DOES *NOT* DO ────────────────────────────────────────────
 * It does not scope data. Being signed in is not the same as being allowed to
 * read a particular rental, and no layout check can enforce that — the row
 * filters in `use-customer-rentals.ts` / `use-customer-rental.ts` do, on every
 * query, with `customer_id` AND `tenant_id`. Read the header of the first file
 * before changing either.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { PortalBoot } from '@/components/portal/portal-boot';
import { PortalShell } from '@/components/portal/portal-shell';
import { useCustomerAuth } from '@/contexts/CustomerAuthContext';
import { useTenant } from '@/contexts/TenantContext';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { customer, isAuthenticated, isLoading: authLoading } = useCustomerAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();

  /*
    Defence in depth, and cheap. `customer-auth-store` already resolves the
    `customer_users` link for the CURRENT tenant, so this should never fire —
    which is exactly why it is worth having: if that resolution ever regresses,
    the failure is one operator's customer inside another operator's portal, and
    it would be silent. Only a POSITIVE mismatch counts. `customers.tenant_id`
    is nullable, and treating null as a mismatch would lock out any legacy row
    that was never stamped.
  */
  const tenantMismatch =
    customer?.tenant_id != null &&
    tenant?.id != null &&
    customer.tenant_id !== tenant.id;

  const allowed = isAuthenticated && !tenantMismatch;

  useEffect(() => {
    if (authLoading || allowed) return;

    // Where to come back to. `?next=` is read by the login page; if it is
    // absent or unrecognised there, the customer simply lands on /portal, which
    // is the right default rather than a broken flow.
    const target = pathname && pathname.startsWith('/portal') ? pathname : '/portal';
    router.replace(`/login?next=${encodeURIComponent(target)}`);
  }, [allowed, authLoading, pathname, router]);

  if (authLoading) {
    return <PortalBoot />;
  }

  if (!allowed) {
    // The effect above is already navigating. Rendering the boot panel rather
    // than null keeps the page from collapsing to a blank white flash.
    return <PortalBoot label="Taking you to sign in…" />;
  }

  // Signed in, but the tenant row has not resolved. Every query in the portal
  // is keyed on `tenant.id` and disabled without it, so pages would sit on
  // skeletons forever with no explanation. Say so instead.
  if (!tenantLoading && !tenant) {
    return (
      <PortalBoot label="We could not identify this site. Please reload, or contact support if it continues." />
    );
  }

  return <PortalShell>{children}</PortalShell>;
}
