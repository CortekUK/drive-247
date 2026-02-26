import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface GigDriverImage {
  id: string;
  customer_id: string;
  tenant_id: string;
  image_url: string;
  file_name: string;
  file_size: number | null;
  created_at: string;
}

export function useGigDriverImages(customerId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["gig-driver-images", tenant?.id, customerId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("gig_driver_images")
        .select("*")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as GigDriverImage[];
    },
    enabled: !!tenant && !!customerId,
  });
}
