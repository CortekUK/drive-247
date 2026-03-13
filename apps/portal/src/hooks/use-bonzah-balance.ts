import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface BonzahBalanceData {
  balance: string;
}

export function getBonzahPortalUrl(mode: 'test' | 'live' | null | undefined): string {
  return mode === 'live'
    ? 'https://bonzah.insillion.com/bb1/'
    : 'https://bonzah.sb.insillion.com/bb1/';
}

export function useBonzahBalance() {
  const { tenant } = useTenant();

  const bonzahMode = tenant?.bonzah_mode ?? 'test';

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

  // Whether the tenant has set up their own Bonzah credentials (completed onboarding)
  const hasOwnCredentials = !!bonzahStatus?.integration_bonzah && !!bonzahStatus?.bonzah_username;
  // Test mode uses platform shared credentials — no tenant bonzah_username needed
  const isBonzahConnected = bonzahMode === 'test' || hasOwnCredentials;

  // Fetch Bonzah balance for current mode (auto-refresh every 60s when connected)
  const {
    data: balanceData,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['bonzah-balance', tenant?.id, bonzahMode],
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

  // Fetch test balance separately when in live mode
  const { data: testBalanceData } = useQuery({
    queryKey: ['bonzah-balance-test', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      const { data, error } = await supabase.functions.invoke('bonzah-get-balance', {
        body: { tenant_id: tenant.id, mode: 'test' },
      });
      if (error) throw error;
      return data as BonzahBalanceData;
    },
    enabled: !!tenant?.id && isBonzahConnected && bonzahMode === 'live',
    refetchInterval: 60_000,
  });

  const balanceNumber = balanceData?.balance != null ? Number(balanceData.balance) : null;
  const testBalanceNumber = testBalanceData?.balance != null ? Number(testBalanceData.balance) : null;
  const portalUrl = getBonzahPortalUrl(bonzahMode);

  return {
    balanceNumber,
    testBalanceNumber,
    isBonzahConnected,
    hasOwnCredentials,
    refetch,
    isFetching,
    bonzahMode,
    portalUrl,
  };
}
