'use client';

import { useEffect } from 'react';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useTenant } from '@/contexts/TenantContext';

interface CustomerAuthProviderProps {
  children: React.ReactNode;
}

export function CustomerAuthProvider({ children }: CustomerAuthProviderProps) {
  const initialize = useCustomerAuthStore((state) => state.initialize);
  const setTenantId = useCustomerAuthStore((state) => state.setTenantId);
  const { tenant } = useTenant();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Sync tenant ID into the auth store so all auth operations are tenant-aware
  useEffect(() => {
    if (tenant?.id) {
      setTenantId(tenant.id);
    }
  }, [tenant?.id, setTenantId]);

  return <>{children}</>;
}
