import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export function useUploadGigDriverImage() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ customerId, file }: { customerId: string; file: File }) => {
      if (!tenant?.id) throw new Error("No tenant");

      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `${tenant.id}/${customerId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('gig-driver-images')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data, error: dbError } = await (supabase as any)
        .from('gig_driver_images')
        .insert({
          customer_id: customerId,
          tenant_id: tenant.id,
          image_url: filePath,
          file_name: file.name,
          file_size: file.size,
        })
        .select()
        .single();

      if (dbError) throw new Error(`Save failed: ${dbError.message}`);
      return data as GigDriverImage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gig-driver-images"] });
    },
  });
}

export function useDeleteGigDriverImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (image: GigDriverImage) => {
      await supabase.storage.from('gig-driver-images').remove([image.image_url]);
      const { error } = await (supabase as any)
        .from('gig_driver_images')
        .delete()
        .eq('id', image.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gig-driver-images"] });
    },
  });
}
