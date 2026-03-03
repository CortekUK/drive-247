import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface RentalAgreement {
  id: string;
  rental_id: string;
  tenant_id: string;
  agreement_type: 'original' | 'extension';
  document_id: string | null;
  document_status: string | null;
  boldsign_mode: string | null;
  envelope_created_at: string | null;
  envelope_sent_at: string | null;
  envelope_completed_at: string | null;
  signed_document_id: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  signed_document: {
    id: string;
    file_url: string | null;
    file_name: string | null;
  } | null;
}

export function useRentalAgreements(rentalId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['rental-agreements', rentalId, tenant?.id],
    queryFn: async () => {
      if (!rentalId) return [];

      const { data, error } = await supabase
        .from('rental_agreements')
        .select(`
          *,
          signed_document:signed_document_id (
            id,
            file_url,
            file_name
          )
        `)
        .eq('rental_id', rentalId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching rental agreements:', error);
        throw error;
      }

      return (data || []) as RentalAgreement[];
    },
    enabled: !!rentalId && !!tenant,
    // Poll every 5s if any agreement has a document_id but is not yet signed
    refetchInterval: (query) => {
      const agreements = query.state.data;
      if (!agreements) return false;
      const hasPending = agreements.some(
        (a) =>
          a.document_id &&
          a.document_status !== 'completed' &&
          a.document_status !== 'signed'
      );
      return hasPending ? 5000 : false;
    },
  });
}
