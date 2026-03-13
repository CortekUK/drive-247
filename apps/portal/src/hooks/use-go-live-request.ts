import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";

export type GoLiveRequestStatus = "pending" | "approved" | "rejected";

export interface GoLiveRequest {
  id: string;
  tenant_id: string;
  requested_by: string;
  integration_type: string;
  status: GoLiveRequestStatus;
  note: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useGoLiveRequests() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["go-live-requests", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("go_live_requests")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as GoLiveRequest[];
    },
    enabled: !!tenant,
    staleTime: 30_000,
  });

  const submitRequest = useMutation({
    mutationFn: async ({
      integrationType,
      note,
    }: {
      integrationType: string;
      note?: string;
    }) => {
      const { data, error } = await (supabase as any)
        .from("go_live_requests")
        .insert({
          tenant_id: tenant!.id,
          requested_by: appUser!.id,
          integration_type: integrationType,
          note: note || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as GoLiveRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["go-live-requests", tenant?.id],
      });
    },
  });

  // Helper to get request status for a specific integration
  const getRequestStatus = (
    integrationType: string
  ): GoLiveRequestStatus | null => {
    const request = requests.find(
      (r) =>
        r.integration_type === integrationType && r.status === "pending"
    );
    return request?.status ?? null;
  };

  return {
    requests,
    isLoading,
    submitRequest,
    getRequestStatus,
  };
}
