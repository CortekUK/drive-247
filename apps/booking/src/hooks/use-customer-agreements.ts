import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { toast } from 'sonner';

export interface CustomerAgreement {
  id: string; // rental_agreements.id
  rental_id: string;
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
  // Joined from rental
  rental_number: string | null;
  rental_start_date: string;
  rental_end_date: string | null;
  vehicles: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
  } | null;
  signed_document: {
    id: string;
    file_url: string | null;
    file_name: string | null;
    document_name: string;
  } | null;
}

export function useCustomerAgreements() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-agreements', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      // First get customer's rental IDs
      const { data: rentals, error: rentalsError } = await supabase
        .from('rentals')
        .select('id')
        .eq('customer_id', customerUser.customer_id);

      if (rentalsError || !rentals?.length) return [];

      const rentalIds = rentals.map(r => r.id);

      // Then query rental_agreements for those rentals
      const { data, error } = await supabase
        .from('rental_agreements')
        .select(`
          id,
          rental_id,
          agreement_type,
          document_id,
          document_status,
          boldsign_mode,
          envelope_created_at,
          envelope_sent_at,
          envelope_completed_at,
          signed_document_id,
          period_start_date,
          period_end_date,
          created_at,
          rentals:rental_id (
            id,
            rental_number,
            start_date,
            end_date,
            vehicles (
              id,
              reg,
              make,
              model
            )
          ),
          customer_documents:signed_document_id (
            id,
            file_url,
            file_name,
            document_name
          )
        `)
        .in('rental_id', rentalIds)
        .not('document_id', 'is', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customer agreements:', error);
        throw error;
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        rental_id: row.rental_id,
        agreement_type: row.agreement_type,
        document_id: row.document_id,
        document_status: row.document_status,
        boldsign_mode: row.boldsign_mode,
        envelope_created_at: row.envelope_created_at,
        envelope_sent_at: row.envelope_sent_at,
        envelope_completed_at: row.envelope_completed_at,
        signed_document_id: row.signed_document_id,
        period_start_date: row.period_start_date,
        period_end_date: row.period_end_date,
        created_at: row.created_at,
        rental_number: row.rentals?.rental_number || null,
        rental_start_date: row.rentals?.start_date,
        rental_end_date: row.rentals?.end_date,
        vehicles: row.rentals?.vehicles || null,
        signed_document: row.customer_documents || null,
      })) as CustomerAgreement[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

export function useCustomerAgreementStats() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-agreement-stats', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return null;

      // Get rental IDs first
      const { data: rentals } = await supabase
        .from('rentals')
        .select('id')
        .eq('customer_id', customerUser.customer_id);

      if (!rentals?.length) return { total: 0, signed: 0, pending: 0 };

      const rentalIds = rentals.map(r => r.id);

      const { data, error } = await supabase
        .from('rental_agreements')
        .select('id, document_status')
        .in('rental_id', rentalIds)
        .not('document_id', 'is', null);

      if (error) {
        console.error('Error fetching agreement stats:', error);
        throw error;
      }

      const agreements = data || [];
      const total = agreements.length;
      const signed = agreements.filter((a) => a.document_status === 'completed' || a.document_status === 'signed').length;
      const pending = agreements.filter(
        (a) => a.document_status && ['sent', 'delivered'].includes(a.document_status)
      ).length;

      return { total, signed, pending };
    },
    enabled: !!customerUser?.customer_id,
  });
}

export function useDownloadAgreement() {
  return useMutation({
    mutationFn: async (agreement: CustomerAgreement) => {
      // If signed document exists with URL, download from storage
      if (agreement.signed_document?.file_url) {
        const fileUrl = agreement.signed_document.file_url;

        if (fileUrl.startsWith('http')) {
          const response = await fetch(fileUrl);
          if (!response.ok) throw new Error('Failed to download document');
          const blob = await response.blob();

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = agreement.signed_document.file_name || `rental-agreement-${agreement.rental_number || agreement.rental_id}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }

        const filePath = fileUrl.replace('customer-documents/', '');
        const { data, error } = await supabase.storage
          .from('customer-documents')
          .download(filePath);

        if (error) throw error;

        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = agreement.signed_document.file_name || `rental-agreement-${agreement.rental_number || agreement.rental_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      // Otherwise fetch from BoldSign API via view route
      if (!agreement.document_id) {
        throw new Error('No document available');
      }

      const response = await fetch('/api/esign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: agreement.rental_id, agreementId: agreement.id }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch document');
      }

      if (result.documentUrl) {
        const response = await fetch(result.documentUrl);
        if (!response.ok) throw new Error('Failed to download document');
        const blob = await response.blob();

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rental-agreement-${agreement.rental_number || agreement.rental_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      if (result.documentBase64) {
        const byteCharacters = atob(result.documentBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rental-agreement-${agreement.rental_number || agreement.rental_id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      throw new Error('No document data received');
    },
    onSuccess: () => {
      toast.success('Agreement downloaded successfully');
    },
    onError: (error) => {
      console.error('Error downloading agreement:', error);
      toast.error('Failed to download agreement');
    },
  });
}

export function useViewAgreement() {
  return useMutation({
    mutationFn: async (agreement: CustomerAgreement): Promise<string> => {
      // If signed document exists with URL, return it
      if (agreement.signed_document?.file_url) {
        return agreement.signed_document.file_url;
      }

      // Otherwise fetch from BoldSign API
      if (!agreement.document_id) {
        throw new Error('No document available');
      }

      const response = await fetch('/api/esign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: agreement.rental_id, agreementId: agreement.id }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch document');
      }

      if (result.documentUrl) {
        return result.documentUrl;
      }

      if (result.documentBase64) {
        const byteCharacters = atob(result.documentBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        return URL.createObjectURL(blob);
      }

      throw new Error('No document data received');
    },
    onError: (error) => {
      console.error('Error viewing agreement:', error);
      toast.error('Failed to load document');
    },
  });
}

export function useSignAgreement() {
  return useMutation({
    mutationFn: async (agreement: CustomerAgreement): Promise<{ signingUrl?: string; emailSent?: boolean; error?: string }> => {
      if (!agreement.document_id) {
        throw new Error('No document for this agreement');
      }

      // Check if already signed
      if (agreement.document_status === 'completed' || agreement.document_status === 'signed') {
        throw new Error('Document already signed');
      }

      const response = await fetch('/api/esign/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: agreement.rental_id, agreementId: agreement.id }),
      });

      const result = await response.json();

      if (result.signingUrl) {
        return { signingUrl: result.signingUrl };
      }

      if (result.emailSent) {
        return { emailSent: true, error: result.error };
      }

      throw new Error(result.error || 'Failed to get signing URL');
    },
    onError: (error) => {
      console.error('Error getting signing URL:', error);
    },
  });
}

export function getAgreementStatusInfo(status: string | null): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  switch (status?.toLowerCase()) {
    case 'sent':
      return { label: 'Awaiting Signature', variant: 'secondary' };
    case 'delivered':
      return { label: 'Viewed', variant: 'secondary' };
    case 'signed':
      return { label: 'Signed', variant: 'default' };
    case 'completed':
      return { label: 'Completed', variant: 'default' };
    case 'declined':
      return { label: 'Declined', variant: 'destructive' };
    case 'voided':
      return { label: 'Voided', variant: 'destructive' };
    default:
      return { label: 'Pending', variant: 'outline' };
  }
}
