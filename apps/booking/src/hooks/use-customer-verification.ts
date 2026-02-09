import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface IdentityVerification {
  id: string;
  customer_id: string;
  tenant_id: string | null;
  session_id: string | null;
  status: string;
  review_status: string | null;
  review_result: string | null;
  verification_provider: string | null;
  ai_face_match_score: number | null;
  document_type: string | null;
  document_number: string | null;
  document_country: string | null;
  document_expiry_date: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  selfie_image_url: string | null;
  document_front_url: string | null;
  document_back_url: string | null;
  face_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export function useCustomerVerification() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-verification', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return null;

      // Get the most recent verification for this customer
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('*')
        .eq('customer_id', customerUser.customer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching customer verification:', error);
        throw error;
      }

      return data as IdentityVerification | null;
    },
    enabled: !!customerUser?.customer_id,
  });
}

export function useCustomerVerificationHistory() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-verification-history', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      const { data, error } = await supabase
        .from('identity_verifications')
        .select('*')
        .eq('customer_id', customerUser.customer_id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching verification history:', error);
        throw error;
      }

      return (data || []) as IdentityVerification[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

// Helper function to get verification status label
export function getVerificationStatusLabel(verification: IdentityVerification | null | undefined): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (!verification) {
    return { label: 'Not Verified', variant: 'outline' };
  }

  const result = verification.review_result || verification.status;

  switch (result) {
    case 'GREEN':
    case 'approved':
    case 'verified':
      return { label: 'Verified', variant: 'default' };
    case 'RED':
    case 'rejected':
      return { label: 'Rejected', variant: 'destructive' };
    case 'YELLOW':
    case 'pending':
      return { label: 'Pending Review', variant: 'secondary' };
    case 'expired':
      return { label: 'Expired', variant: 'outline' };
    default:
      return { label: 'Unknown', variant: 'outline' };
  }
}
