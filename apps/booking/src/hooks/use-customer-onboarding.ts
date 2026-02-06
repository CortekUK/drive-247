import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface OnboardingStatus {
  isVerified: boolean;
  hasInsurance: boolean;
  isComplete: boolean;
  pendingItems: number;
}

/**
 * Hook to check customer onboarding completion status.
 * Returns whether ID verification and insurance document upload are complete.
 */
export function useCustomerOnboarding() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-onboarding', customerUser?.customer_id],
    queryFn: async (): Promise<OnboardingStatus> => {
      if (!customerUser?.customer_id) {
        return {
          isVerified: false,
          hasInsurance: false,
          isComplete: false,
          pendingItems: 2,
        };
      }

      // Check verification status
      const { data: verification } = await supabase
        .from('identity_verifications')
        .select('review_result, status')
        .eq('customer_id', customerUser.customer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const verificationResult = verification?.review_result || verification?.status;
      const isVerified = ['GREEN', 'approved', 'verified'].includes(verificationResult || '');

      // Check if customer has at least one insurance document
      const { count: insuranceCount } = await supabase
        .from('customer_documents')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerUser.customer_id)
        .eq('document_type', 'Insurance Certificate');

      const hasInsurance = (insuranceCount || 0) > 0;

      const pendingItems = (isVerified ? 0 : 1) + (hasInsurance ? 0 : 1);

      return {
        isVerified,
        hasInsurance,
        isComplete: isVerified && hasInsurance,
        pendingItems,
      };
    },
    enabled: !!customerUser?.customer_id,
    // Refetch when window regains focus to catch updates
    refetchOnWindowFocus: true,
  });
}
