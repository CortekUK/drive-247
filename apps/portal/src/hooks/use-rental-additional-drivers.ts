import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface RentalAdditionalDriver {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  verification_status: "unverified" | "pending" | "verified" | "rejected";
  signing_status: "not_sent" | "sent" | "signed" | "declined";
  verification_url: string | null;
  identity_verification_id: string | null;
  boldsign_signer_email: string | null;
  signed_at: string | null;
  created_at: string;
}

/**
 * Fetches additional drivers for a rental. Subscribes to realtime updates so
 * verification status changes from the Veriff webhook surface in the portal
 * without manual refresh.
 */
export function useRentalAdditionalDrivers(rentalId: string | undefined, enabled: boolean = true) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ["rental-additional-drivers", tenant?.id, rentalId] as const;

  useEffect(() => {
    if (!rentalId || !tenant?.id || !enabled) return;
    const channel = supabase
      .channel(`rental-additional-drivers:${rentalId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rental_additional_drivers", filter: `rental_id=eq.${rentalId}` },
        () => queryClient.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [rentalId, tenant?.id, enabled, queryClient, queryKey]);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<RentalAdditionalDriver[]> => {
      if (!rentalId || !tenant?.id) return [];
      const { data, error } = await supabaseUntyped
        .from("rental_additional_drivers")
        .select(
          "id, name, email, phone, license_number, verification_status, signing_status, verification_url, identity_verification_id, boldsign_signer_email, signed_at, created_at",
        )
        .eq("rental_id", rentalId)
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as RentalAdditionalDriver[];
    },
    enabled: enabled && !!rentalId && !!tenant?.id,
  });
}
