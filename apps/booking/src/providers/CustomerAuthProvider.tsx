'use client';

import { useEffect } from 'react';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

interface CustomerAuthProviderProps {
  children: React.ReactNode;
}

export function CustomerAuthProvider({ children }: CustomerAuthProviderProps) {
  const initialize = useCustomerAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <>{children}</>;
}
