import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface BonzahBalanceData {
  balance: string;
}

export function useBonzahBalance() {
  const { tenant } = useTenant();

  // Fetch Bonzah connection status
  const { data: bonzahStatus } = useQuery({
    queryKey: ['tenant-bonzah-status', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant context');
      const { data, error } = await supabase
        .from('tenants')
        .select('bonzah_username, integration_bonzah')
        .eq('id', tenant.id)
        .single();
      if (error) throw error;
      return data as { bonzah_username: string | null; integration_bonzah: boolean };
    },
    enabled: !!tenant?.id,
  });

  const isBonzahConnected = !!bonzahStatus?.integration_bonzah && !!bonzahStatus?.bonzah_username;

  // Fetch CD balance (auto-refresh every 60s when connected)
  const {
    data: balanceData,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['bonzah-balance', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      const { data, error } = await supabase.functions.invoke('bonzah-get-balance', {
        body: { tenant_id: tenant.id },
      });
      if (error) throw error;
      return data as BonzahBalanceData;
    },
    enabled: !!tenant?.id && isBonzahConnected,
    refetchInterval: 60_000,
  });

  const balanceNumber = balanceData?.balance != null ? Number(balanceData.balance) : null;

  return {
    balanceNumber,
    isBonzahConnected,
    refetch,
    isFetching,
  };
}
