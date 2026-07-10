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

export interface BonzahDraftPayload {
  values: BonzahOnboardingFormData;
  step: number;
  completed: number[];
  fileUrls: FileUrls;
}

export function useBonzahOnboarding() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  // DB-backed draft so a paused onboarding survives across browsers/devices.
  // The `bonzah_onboarding_drafts` table holds one row per tenant.
  const fetchDraft = async (): Promise<BonzahDraftPayload | null> => {
    if (!tenant?.id) return null;
    const { data, error } = await supabase
      .from('bonzah_onboarding_drafts' as never)
      .select('draft')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (error || !data) return null;
    const draft = (data as { draft?: BonzahDraftPayload }).draft;
    return draft && typeof draft === 'object' && 'values' in draft ? draft : null;
  };

  const saveDraft = async (payload: BonzahDraftPayload): Promise<void> => {
    if (!tenant?.id) return;
    await supabase.from('bonzah_onboarding_drafts' as never).upsert(
      {
        tenant_id: tenant.id,
        draft: payload as unknown as Json,
        updated_by: appUser?.id ?? null,
      } as never,
      { onConflict: 'tenant_id' },
    );
  };

  const deleteDraft = async (): Promise<void> => {
    if (!tenant?.id) return;
    await supabase
      .from('bonzah_onboarding_drafts' as never)
      .delete()
      .eq('tenant_id', tenant.id);
  };

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
      quizResult,
    }: {
      data: BonzahOnboardingFormData;
      fileUrls: FileUrls;
      quizResult?: { score: number; total: number; passed: boolean } | null;
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
        quiz_score: quizResult?.score ?? null,
        quiz_total: quizResult?.total ?? null,
        quiz_passed: quizResult?.passed ?? null,
        training_completed_at: quizResult ? new Date().toISOString() : null,
      };
      const { data: row, error } = await supabase
        .from('bonzah_onboarding_submissions')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      // Fire-and-forget: kick off the AI verdict so a Bonzah reviewer sees a
      // recommendation when they open the submission. Never blocks submit.
      const submissionId = (row as unknown as BonzahSubmissionRow).id;
      void supabase.functions
        .invoke('summarize-bonzah-submission', { body: { submissionId } })
        .catch(() => {
          /* best-effort; verdict can be regenerated from the console */
        });

      // Fire-and-forget: email the application to the Bonzah partner (Brandon)
      // with a deep link into the console. Best-effort; never blocks submit.
      void supabase.functions
        .invoke('send-bonzah-form-to-brandon', { body: { tenant_id: tenant.id } })
        .catch(() => {
          /* best-effort; a super admin can still send it manually */
        });

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
    fetchDraft,
    saveDraft,
    deleteDraft,
  };
}
