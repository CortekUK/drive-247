'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PortalPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to bookings page by default
    router.replace('/portal/bookings');
  }, [router]);

  return null;
}
