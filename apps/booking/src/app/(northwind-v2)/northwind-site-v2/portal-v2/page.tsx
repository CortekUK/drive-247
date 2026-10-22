'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * There is no Home (owner, Oct 22 2026): a customer has one or two rentals, so
 * Rentals is the page the portal opens on. The alert bar that Home carried is
 * now under every page's header. `?panel=` (the notification sheet) rides along.
 *
 * Client-side on purpose: `/portal` reaches this route through the
 * middleware's rewrite, and a server `redirect()` here renders an empty page
 * inside the shell instead of moving.
 */
export default function PortalV2Index() {
  const router = useRouter();
  const panel = useSearchParams()?.get('panel');
  useEffect(() => {
    router.replace(panel ? `/portal/rentals?panel=${encodeURIComponent(panel)}` : '/portal/rentals');
  }, [panel, router]);
  return null;
}
