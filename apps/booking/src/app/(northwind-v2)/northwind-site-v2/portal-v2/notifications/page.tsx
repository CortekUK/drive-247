'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Notifications left the rail: they open in the top bar's sheet, from any
 * page. This address stays alive for links already sent, and opens the sheet
 * over Rentals, the first page (the shell reads `?panel=notifications`).
 * Client-side for the same reason as the portal index (../page.tsx).
 */
export default function PortalNotificationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/portal/rentals?panel=notifications');
  }, [router]);
  return null;
}
