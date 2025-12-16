import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface InsurancePolicy {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  policy_number: string;
  provider: string | null;
  start_date: string;
  expiry_date: string;
  status: "Active" | "Expired" | "Suspended" | "Cancelled";
  notes: string | null;
  created_at: string;
  updated_at: string;
  vehicles?: {
    id: string;
    reg: string;
    make: string;
    model: string;
  } | null;
  insurance_documents?: Array<{
    id: string;
    doc_type: string;
    file_url: string;
    file_name: string | null;
    uploaded_at: string;
  }>;
}

export function useCustomerInsurance(customerId: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["customer-insurance", tenant?.id, customerId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("insurance_policies")
        .select(`
          *,
          vehicles(id, reg, make, model),
          insurance_documents(id, doc_type, file_url, file_name, uploaded_at)
        `)
        .eq("tenant_id", tenant.id)
        .eq("customer_id", customerId)
        .order("expiry_date", { ascending: true });

      if (error) throw error;
      return data as InsurancePolicy[];
    },
    enabled: !!tenant && !!customerId,
  });
}

export function usePolicyDocuments(policyId: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["policy-documents", tenant?.id, policyId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("insurance_documents")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("policy_id", policyId)
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!tenant && !!policyId,
  });
}