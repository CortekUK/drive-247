import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  const query = useQuery({
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
    // Treat fetched data as fresh — Realtime keeps the cache in sync, and a
    // long staleTime prevents transient invalidations from briefly flashing
    // the empty state during a refetch in flight.
    staleTime: 60_000,
    // Polling is a safety net for missed Realtime events (e.g. brief socket
    // disconnect during signing). Active only while something is pending.
    refetchInterval: (q) => {
      const agreements = q.state.data;
      if (!agreements) return false;
      const hasPending = agreements.some(
        (a) =>
          a.document_id &&
          a.document_status !== 'completed' &&
          a.document_status !== 'signed'
      );
      return hasPending ? 60_000 : false;
    },
  });

  // Postgres Realtime subscription: any INSERT/UPDATE/DELETE on
  // rental_agreements for this rental invalidates the cache so the timeline
  // surfaces a freshly-sent agreement (INSERT from /api/esign POST) and a
  // signed status update (UPDATE from boldsign-webhook) without depending on
  // the polling cadence — which is gated on hasPending and therefore wouldn't
  // run at all when the list is currently empty.
  useEffect(() => {
    if (!rentalId || !tenant?.id) return;
    const channel = supabase
      .channel(`rental-agreements:${rentalId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rental_agreements', filter: `rental_id=eq.${rentalId}` },
        () => {
          queryClient.invalidateQueries({
            queryKey: ['rental-agreements', rentalId, tenant.id],
            refetchType: 'all',
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [rentalId, tenant?.id, queryClient]);

  return query;
}
