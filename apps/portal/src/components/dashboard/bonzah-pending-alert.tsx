'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function BonzahPendingAlert() {
  const { tenant } = useTenant();
  const router = useRouter();

  const { data: count } = useQuery({
    queryKey: ['bonzah-insufficient-balance-count', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      const { count, error } = await supabase
        .from('bonzah_insurance_policies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('status', 'insufficient_balance');
      if (error) throw error;
      return count || 0;
    },
    enabled: !!tenant?.id,
  });

  if (!count || count === 0) return null;

  return (
    <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-[#CC004A]/10 p-2 flex-shrink-0">
          <ShieldAlert className="h-5 w-5 text-[#CC004A]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-[#CC004A]">
            {count} rental{count > 1 ? 's have' : ' has'} insurance pending
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Insufficient Bonzah deposit balance to activate {count > 1 ? 'these policies' : 'this policy'}. Top up your account to activate coverage.
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10"
              onClick={() => router.push('/rentals?bonzahStatus=insufficient_balance')}
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
