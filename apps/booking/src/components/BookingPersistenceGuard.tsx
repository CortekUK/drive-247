'use client';

import { useEffect, useRef } from 'react';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useBookingStore } from '@/stores/booking-store';

/**
 * - Guest on page load → clear persisted booking data
 * - Sign-out transition → clear persisted booking data
 * - Logged-in on page load → keep data (sessionStorage clears on tab close)
 */
export function BookingPersistenceGuard({ children }: { children: React.ReactNode }) {
  const initialized = useCustomerAuthStore((s) => s.initialized);
  const customerUser = useCustomerAuthStore((s) => s.customerUser);
  const session = useCustomerAuthStore((s) => s.session);
  const clearBooking = useBookingStore((s) => s.clearBooking);

  const isAuthenticated = !!customerUser && !!session;
  const didInitialCheck = useRef(false);
  const wasAuthRef = useRef(false);

  useEffect(() => {
    if (!initialized) return;

    // One-time check after auth finishes: clear stale data for guests
    if (!didInitialCheck.current) {
      didInitialCheck.current = true;
      wasAuthRef.current = isAuthenticated;
      if (!isAuthenticated) {
        clearBooking();
      }
      return;
    }

    // Sign-out transition (was logged in → now logged out)
    if (wasAuthRef.current && !isAuthenticated) {
      clearBooking();
    }
    wasAuthRef.current = isAuthenticated;
  }, [initialized, isAuthenticated, clearBooking]);

  return <>{children}</>;
}
