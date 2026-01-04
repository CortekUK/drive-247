import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";

export interface CustomerDocument {
  id: string;
  customer_id: string;
  vehicle_id?: string;
  document_type: string;
  document_name: string;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  insurance_provider?: string;
  policy_number?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  verified: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
  vehicles?: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
}

export function useCustomerDocuments(customerId: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-documents", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("customer_documents")
        .select(`
          *,
          vehicles!customer_documents_vehicle_id_fkey(id, reg, make, model)
        `)
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as CustomerDocument[];
    },
    enabled: !!tenant && !!customerId,
  });
}

export function useDeleteCustomerDocument() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async (documentId: string) => {
      // First get the document to find the file URL
      let selectQuery = supabase
        .from("customer_documents")
        .select("file_url, customer_id")
        .eq("id", documentId);

      if (tenant?.id) {
        selectQuery = selectQuery.eq("tenant_id", tenant.id);
      }

      const { data: document } = await selectQuery.single();

      // Delete the file from storage if it exists
      if (document?.file_url) {
        const filePath = document.file_url.replace(`customer-documents/`, '');
        await supabase.storage
          .from("customer-documents")
          .remove([filePath]);
      }

      // Delete the database record
      let deleteQuery = supabase
        .from("customer_documents")
        .delete()
        .eq("id", documentId);

      if (tenant?.id) {
        deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await deleteQuery;

      if (error) throw error;
      return document?.customer_id;
    },
    onSuccess: (customerId) => {
      if (customerId) {
        queryClient.invalidateQueries({ queryKey: ["customer-documents", customerId] });
      }
      toast.success("Document deleted successfully");
    },
    onError: (error) => {
      console.error("Error deleting document:", error);
      toast.error("Failed to delete document");
    },
  });
}

export function useDownloadDocument() {
  return useMutation({
    mutationFn: async (document: CustomerDocument) => {
      if (!document.file_url) {
        throw new Error("No file URL available");
      }

      const filePath = document.file_url.replace(`customer-documents/`, '');
      const { data, error } = await supabase.storage
        .from("customer-documents")
        .download(filePath);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = document.file_name || `document-${document.id}`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onError: (error) => {
      console.error("Error downloading document:", error);
      toast.error("Failed to download document");
    },
  });
}

export function getDocumentStatus(endDate?: string): 'Active' | 'Expired' | 'Expires Soon' | 'Unknown' {
  if (!endDate) return 'Unknown';
  
  const today = new Date();
  const expiry = new Date(endDate);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilExpiry < 0) return 'Expired';
  if (daysUntilExpiry <= 30) return 'Expires Soon';
  return 'Active';
}