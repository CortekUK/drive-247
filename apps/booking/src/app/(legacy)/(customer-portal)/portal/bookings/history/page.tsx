'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect to main bookings page - history is now part of the combined view
export default function BookingHistoryPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/portal/bookings');
  }, [router]);

  return null;
}
