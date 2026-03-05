import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface RentalAgreement {
  id: string;
  rental_id: string;
  agreement_type: 'original' | 'extension';
  document_id: string | null;
  document_status: string | null;
  boldsign_mode: string | null;
  envelope_sent_at: string | null;
  envelope_completed_at: string | null;
  signed_document_id: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
  created_at: string | null;
  signed_document: {
    id: string;
    file_url: string | null;
    file_name: string | null;
    document_name: string;
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
          id,
          rental_id,
          agreement_type,
          document_id,
          document_status,
          boldsign_mode,
          envelope_sent_at,
          envelope_completed_at,
          signed_document_id,
          period_start_date,
          period_end_date,
          created_at,
          customer_documents:signed_document_id (
            id,
            file_url,
            file_name,
            document_name
          )
        `)
        .eq('rental_id', rentalId)
        .not('document_id', 'is', null)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching rental agreements:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        rental_id: row.rental_id,
        agreement_type: row.agreement_type,
        document_id: row.document_id,
        document_status: row.document_status,
        boldsign_mode: row.boldsign_mode,
        envelope_sent_at: row.envelope_sent_at,
        envelope_completed_at: row.envelope_completed_at,
        signed_document_id: row.signed_document_id,
        period_start_date: row.period_start_date,
        period_end_date: row.period_end_date,
        created_at: row.created_at,
        signed_document: row.customer_documents || null,
      })) as RentalAgreement[];
    },
    enabled: !!rentalId && !!tenant,
  });
}
