'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import type {
  BonzahOnboardingFormData,
  FileUrls,
} from '@/components/settings/bonzah-onboarding/schema';

export interface BonzahSubmissionRow {
  id: string;
  tenant_id: string;
  submitted_by: string | null;
  business_trade_name: string;
  business_legal_name: string;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  primary_contact_email: string;
  primary_contact_phone: string | null;
  ein: string | null;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  data: BonzahOnboardingFormData;
  file_urls: FileUrls;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export function useBonzahOnboarding() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  const submissionsQuery = useQuery({
    queryKey: ['bonzah-onboarding-submissions', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [] as BonzahSubmissionRow[];
      const { data, error } = await supabase
        .from('bonzah_onboarding_submissions')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as BonzahSubmissionRow[]) || [];
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  // The "active" submission is the most recent pending or approved one.
  // Rejected submissions allow the tenant to re-submit, so they are not
  // treated as blocking.
  const activeSubmission =
    submissionsQuery.data?.find((s) => s.status === 'pending' || s.status === 'approved') ?? null;
  const lastSubmission = submissionsQuery.data?.[0] ?? null;

  const submit = useMutation({
    mutationFn: async ({
      data,
      fileUrls,
    }: {
      data: BonzahOnboardingFormData;
      fileUrls: FileUrls;
    }) => {
      if (!tenant?.id) throw new Error('Tenant not loaded');
      const payload = {
        tenant_id: tenant.id,
        submitted_by: appUser?.id ?? null,
        business_trade_name: data.business_trade_name,
        business_legal_name: data.business_legal_name,
        primary_contact_first_name: data.primary_first_name,
        primary_contact_last_name: data.primary_last_name,
        primary_contact_email: data.primary_email,
        primary_contact_phone: data.primary_phone,
        ein: data.ein,
        status: 'pending' as const,
        data: data as unknown as Json,
        file_urls: fileUrls as unknown as Json,
      };
      const { data: row, error } = await supabase
        .from('bonzah_onboarding_submissions')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return row as unknown as BonzahSubmissionRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bonzah-onboarding-submissions', tenant?.id] });
    },
  });

  return {
    submissions: submissionsQuery.data ?? [],
    activeSubmission,
    lastSubmission,
    isLoading: submissionsQuery.isLoading,
    submit,
  };
}
