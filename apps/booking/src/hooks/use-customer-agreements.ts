import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { toast } from 'sonner';

export interface CustomerAgreement {
  id: string;
  rental_number: string | null;
  start_date: string;
  end_date: string | null;
  document_status: string | null;
  docusign_envelope_id: string | null;
  envelope_created_at: string | null;
  envelope_sent_at: string | null;
  envelope_completed_at: string | null;
  signed_document_id: string | null;
  created_at: string | null;
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

      const { data, error } = await supabase
        .from('rentals')
        .select(`
          id,
          rental_number,
          start_date,
          end_date,
          document_status,
          docusign_envelope_id,
          envelope_created_at,
          envelope_sent_at,
          envelope_completed_at,
          signed_document_id,
          created_at,
          vehicles (
            id,
            reg,
            make,
            model
          ),
          customer_documents!rentals_signed_document_id_fkey (
            id,
            file_url,
            file_name,
            document_name
          )
        `)
        .eq('customer_id', customerUser.customer_id)
        .not('docusign_envelope_id', 'is', null)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching customer agreements:', error);
        throw error;
      }

      return (data || []).map((rental: any) => ({
        id: rental.id,
        rental_number: rental.rental_number,
        start_date: rental.start_date,
        end_date: rental.end_date,
        document_status: rental.document_status,
        docusign_envelope_id: rental.docusign_envelope_id,
        envelope_created_at: rental.envelope_created_at,
        envelope_sent_at: rental.envelope_sent_at,
        envelope_completed_at: rental.envelope_completed_at,
        signed_document_id: rental.signed_document_id,
        created_at: rental.created_at,
        vehicles: rental.vehicles,
        signed_document: rental.customer_documents,
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

      const { data, error } = await supabase
        .from('rentals')
        .select('id, document_status, docusign_envelope_id')
        .eq('customer_id', customerUser.customer_id)
        .not('docusign_envelope_id', 'is', null);

      if (error) {
        console.error('Error fetching agreement stats:', error);
        throw error;
      }

      const agreements = data || [];
      const total = agreements.length;
      const signed = agreements.filter((a) => a.document_status === 'completed').length;
      const pending = agreements.filter(
        (a) => a.document_status && ['sent', 'delivered'].includes(a.document_status)
      ).length;

      return {
        total,
        signed,
        pending,
      };
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
          a.download = agreement.signed_document.file_name || `rental-agreement-${agreement.rental_number || agreement.id}.pdf`;
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
        a.download = agreement.signed_document.file_name || `rental-agreement-${agreement.rental_number || agreement.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      // Otherwise fetch from DocuSign API
      if (!agreement.docusign_envelope_id) {
        throw new Error('No document available');
      }

      const response = await fetch('/api/esign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: agreement.id }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch document');
      }

      // If we got a URL, redirect to it
      if (result.documentUrl) {
        const response = await fetch(result.documentUrl);
        if (!response.ok) throw new Error('Failed to download document');
        const blob = await response.blob();

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rental-agreement-${agreement.rental_number || agreement.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      // If we got base64, convert and download
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
        a.download = `rental-agreement-${agreement.rental_number || agreement.id}.pdf`;
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

      // Otherwise fetch from DocuSign API
      if (!agreement.docusign_envelope_id) {
        throw new Error('No document available');
      }

      const response = await fetch('/api/esign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: agreement.id }),
      });

      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch document');
      }

      // If we got a URL, return it
      if (result.documentUrl) {
        return result.documentUrl;
      }

      // If we got base64, convert to blob URL
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
      if (!agreement.docusign_envelope_id) {
        throw new Error('No document for this agreement');
      }

      // Check if already signed
      if (agreement.document_status === 'completed' || agreement.document_status === 'signed') {
        throw new Error('Document already signed');
      }

      const response = await fetch('/api/esign/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: agreement.id }),
      });

      const result = await response.json();

      if (result.signingUrl) {
        // Open DocuSign signing page in a new tab
        window.open(result.signingUrl, '_blank');
        return { signingUrl: result.signingUrl };
      }

      if (result.emailSent) {
        return { emailSent: true, error: result.error };
      }

      throw new Error(result.error || 'Failed to get signing URL');
    },
    onError: (error) => {
      console.error('Error getting signing URL:', error);
      // Don't show toast here - let the component handle it
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
