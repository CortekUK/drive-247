import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

interface RetryProgress {
  total: number;
  completed: number;
  failed: number;
  isRetrying: boolean;
}

interface PendingPolicy {
  id: string;
  rental_id: string;
  premium_amount: number;
  status: string;
}

export function useBonzahRetryAll() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RetryProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    isRetrying: false,
  });

  const retryAll = async (policies: PendingPolicy[]) => {
    if (!tenant?.id || policies.length === 0) return;

    setProgress({ total: policies.length, completed: 0, failed: 0, isRetrying: true });

    let completed = 0;
    let failed = 0;

    // Process sequentially to avoid overwhelming the API
    for (const policy of policies) {
      try {
        const { error } = await supabase.functions.invoke('bonzah-confirm-payment', {
          body: {
            policy_record_id: policy.id,
            stripe_payment_intent_id: `portal-retry-${policy.rental_id}`,
          },
        });
        if (error) throw error;
        completed++;
      } catch {
        failed++;
      }
      setProgress(prev => ({ ...prev, completed, failed }));
    }

    setProgress(prev => ({ ...prev, isRetrying: false }));

    // Invalidate relevant queries
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bonzah-insufficient-balance-count'] }),
      queryClient.invalidateQueries({ queryKey: ['bonzah-pending-policies'] }),
      queryClient.invalidateQueries({ queryKey: ['bonzah-balance'] }),
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] }),
    ]);

    // Summary toast
    if (failed === 0) {
      toast({
        title: 'All policies activated',
        description: `${completed} ${completed === 1 ? 'policy' : 'policies'} activated successfully.`,
      });
    } else if (completed > 0) {
      toast({
        title: 'Partial success',
        description: `${completed} of ${policies.length} policies activated. ${failed} still pending.`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Retry failed',
        description: 'Allocated balance may still be insufficient. Allocate more funds in the Bonzah portal and try again.',
        variant: 'destructive',
      });
    }
  };

  return { retryAll, progress };
}
