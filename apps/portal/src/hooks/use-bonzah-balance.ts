import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

interface BonzahBalanceData {
  /** Spendable balance — the sub-account allocation policies are paid from. */
  balance: string;
  allocatedBalance?: string | null;
  /** Company-level funds. NOT spendable until allocated to the sub-account. */
  brokerBalance?: string | null;
  /** Broker funds exist but nothing is allocated — policies will fail. */
  needsAllocation?: boolean;
  mode?: string;
  rawData?: any;
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

  const allocatedBalanceNumber = balanceData?.allocatedBalance != null ? Number(balanceData.allocatedBalance) : null;
  const brokerBalanceNumber = balanceData?.brokerBalance != null ? Number(balanceData.brokerBalance) : null;
  const testBalanceNumber = testBalanceData?.balance != null ? Number(testBalanceData.balance) : null;
  const portalUrl = getBonzahPortalUrl(bonzahMode);

  // `balance` from the edge function is already the SPENDABLE figure (the
  // sub-account allocation policies are paid from), falling back to broker only
  // when the allocation genuinely could not be read.
  //
  // Do NOT reintroduce a `allocated > 0 ? allocated : broker` fallback here.
  // That is the bug this replaces: an allocation of exactly zero fell through to
  // the broker number, so a tenant holding $500 at broker level with $0
  // allocated saw "Live balance: $500.00 · Accepting live insurance policies"
  // while every policy purchase would fail for insufficient funds.
  const balanceNumber = balanceData?.balance != null ? Number(balanceData.balance) : null;

  // Funds exist at broker level but none are allocated to the policy-issuing
  // sub-account. Only the operator can move them, inside the Bonzah portal.
  const needsAllocation = balanceData?.needsAllocation === true;

  return {
    balanceNumber,
    allocatedBalanceNumber,
    brokerBalanceNumber,
    needsAllocation,
    // kept for callers that still read it; same value as balanceNumber
    rawBalanceNumber: balanceNumber,
    testBalanceNumber,
    isBonzahConnected,
    hasOwnCredentials,
    refetch,
    isFetching,
    bonzahMode,
    portalUrl,
    rawData: balanceData?.rawData,
  };
}
