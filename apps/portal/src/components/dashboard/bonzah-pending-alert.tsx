'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { ShieldAlert, ArrowRight, ExternalLink, RefreshCw, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useBonzahBalance } from '@/hooks/use-bonzah-balance';
import { useBonzahRetryAll } from '@/hooks/use-bonzah-retry-all';

export function BonzahPendingAlert() {
  const { tenant } = useTenant();
  const router = useRouter();
  const { balanceNumber, portalUrl } = useBonzahBalance();
  const { retryAll, progress } = useBonzahRetryAll();

  const { data: pendingPolicies } = useQuery({
    queryKey: ['bonzah-pending-policies', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      const { data, error } = await supabase
        .from('bonzah_insurance_policies')
        .select('id, rental_id, premium_amount, status')
        .eq('tenant_id', tenant.id)
        .eq('status', 'insufficient_balance');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant?.id,
  });

  if (!pendingPolicies || pendingPolicies.length === 0) return null;

  const count = pendingPolicies.length;
  const totalPremium = pendingPolicies.reduce((sum, p) => sum + (p.premium_amount || 0), 0);

  return (
    <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-[#CC004A]/10 p-2 flex-shrink-0">
          <ShieldAlert className="h-5 w-5 text-[#CC004A]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-[#CC004A]">
            {count} rental{count > 1 ? 's have' : ' has'} insurance quoted — pending allocation
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Total premium needed: <span className="font-semibold text-[#CC004A]">${totalPremium.toFixed(2)}</span>
            {balanceNumber != null && (
              <> | Bonzah Balance: <span className="font-semibold">${balanceNumber.toFixed(2)}</span></>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Policies could not activate because your allocated Bonzah balance is too low. Allocate more funds, then retry.
          </p>
          {progress.isRetrying && (
            <p className="text-xs text-muted-foreground mt-1">
              Retrying... {progress.completed + progress.failed} of {progress.total} processed
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10"
              asChild
            >
              <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Allocate Funds
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10"
              disabled={progress.isRetrying}
              onClick={() => retryAll(pendingPolicies)}
            >
              {progress.isRetrying ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Retry All
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10"
              onClick={() => router.push('/rentals?bonzahStatus=ins_pending')}
            >
              View Rentals
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
