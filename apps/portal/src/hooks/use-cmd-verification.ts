'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface CmdVerification {
  id: string;
  tenant_id: string;
  rental_id: string;
  customer_id: string | null;
  verification_type: 'insurance' | 'license';
  cmd_verification_id: string | null;
  applicant_verification_req_guid_id: string | null;
  applicant_verification_id: string | null;
  magic_link_url: string | null;
  magic_link_generated_at: string | null;
  status: string;
  consumer_first_name: string | null;
  consumer_last_name: string | null;
  consumer_email: string | null;
  consumer_phone: string | null;
  policy_status: string | null;
  active_status: string | null;
  carrier: string | null;
  is_monitoring: boolean;
  license_status: string | null;
  webhook_payload: Record<string, unknown> | null;
  webhook_received_at: string | null;
  verification_results: Record<string, unknown> | null;
  error_message: string | null;
  initiated_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useCmdVerifications(rentalId: string | undefined) {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ['cmd-verifications', tenant?.id, rentalId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cmd_verifications')
        .select('*')
        .eq('rental_id', rentalId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as CmdVerification[];
    },
    enabled: !!tenant && !!rentalId,
    refetchOnWindowFocus: false,
  });

  // Auto-poll every 30s when any verification is in a pending/verifying state
  const hasPendingVerification = query.data?.some(
    (v) => v.status === 'link_generated' || v.status === 'link_sent' || v.status === 'verifying'
  );

  return {
    ...query,
    refetchInterval: hasPendingVerification ? 30000 : false,
  };
}

export function useCreateCmdVerification() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      rentalId: string;
      customerId: string;
      verificationType: 'insurance' | 'license';
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      initiatedBy?: string;
    }) => {
      if (!tenant?.id) throw new Error('No tenant');

      const { data, error } = await supabase.functions.invoke('cmd-create-verification', {
        body: {
          rentalId: params.rentalId,
          customerId: params.customerId,
          tenantId: tenant.id,
          verificationType: params.verificationType,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email,
          phone: params.phone,
          initiatedBy: params.initiatedBy,
        },
      });

      if (error) throw error;

      // Handle 422 missing fields response
      if (data?.error === 'missing_customer_fields') {
        const err = new Error(data.message) as Error & { missingFields?: string[] };
        err.missingFields = data.missingFields;
        throw err;
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['cmd-verifications', tenant?.id, variables.rentalId],
      });
    },
  });
}

export function useRefreshCmdVerification() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { cmdVerificationId: string; rentalId: string }) => {
      const { data, error } = await supabase.functions.invoke('cmd-get-results', {
        body: {
          cmdVerificationId: params.cmdVerificationId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['cmd-verifications', tenant?.id, variables.rentalId],
      });
    },
  });
}
