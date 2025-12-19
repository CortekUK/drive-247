import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

export type HandoverType = "giving" | "receiving";

export interface HandoverPhoto {
  id: string;
  handover_id: string;
  file_path: string;
  file_url: string;
  file_name: string;
  caption: string | null;
  uploaded_at: string;
}

export interface KeyHandover {
  id: string;
  rental_id: string;
  handover_type: HandoverType;
  notes: string | null;
  handed_at: string | null;
  handed_by: string | null;
  created_at: string;
  photos: HandoverPhoto[];
}

export function useKeyHandover(rentalId: string | undefined) {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch handovers for this rental
  const { data: handovers, isLoading } = useQuery({
    queryKey: ["key-handovers", rentalId],
    queryFn: async () => {
      if (!rentalId) return [];

      const { data, error } = await supabase
        .from("rental_key_handovers")
        .select(`
          *,
          photos:rental_handover_photos(*)
        `)
        .eq("rental_id", rentalId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data as KeyHandover[];
    },
    enabled: !!rentalId,
  });

  // Get specific handover (giving or receiving)
  const getHandover = (type: HandoverType): KeyHandover | undefined => {
    return handovers?.find((h) => h.handover_type === type);
  };

  // Create or get handover record
  const ensureHandover = useMutation({
    mutationFn: async (type: HandoverType) => {
      if (!rentalId) throw new Error("Rental ID required");

      // Check if handover already exists
      const { data: existing } = await supabase
        .from("rental_key_handovers")
        .select("id")
        .eq("rental_id", rentalId)
        .eq("handover_type", type)
        .single();

      if (existing) return existing;

      // Create new handover record
      const { data, error } = await supabase
        .from("rental_key_handovers")
        .insert({
          rental_id: rentalId,
          handover_type: type,
          tenant_id: tenant?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
    },
  });

  // Upload photo
  const uploadPhoto = useMutation({
    mutationFn: async ({
      type,
      file,
      caption,
    }: {
      type: HandoverType;
      file: File;
      caption?: string;
    }) => {
      if (!rentalId) throw new Error("Rental ID required");

      // Ensure handover record exists
      const handover = await ensureHandover.mutateAsync(type);

      // Generate unique file name
      const fileExt = file.name.split(".").pop();
      const fileName = `${rentalId}/${type}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("rental-handover-photos")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("rental-handover-photos")
        .getPublicUrl(fileName);

      // Save photo record
      const { data, error } = await supabase
        .from("rental_handover_photos")
        .insert({
          handover_id: handover.id,
          file_path: fileName,
          file_url: urlData.publicUrl,
          file_name: file.name,
          caption: caption || null,
          tenant_id: tenant?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      toast({
        title: "Photo Uploaded",
        description: "Car condition photo has been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete photo
  const deletePhoto = useMutation({
    mutationFn: async (photo: HandoverPhoto) => {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from("rental-handover-photos")
        .remove([photo.file_path]);

      if (storageError) console.warn("Storage delete error:", storageError);

      // Delete from database
      let deleteQuery = supabase
        .from("rental_handover_photos")
        .delete()
        .eq("id", photo.id);

      if (tenant?.id) {
        deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await deleteQuery;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      toast({
        title: "Photo Deleted",
        description: "Photo has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mark key as handed (updates rental status to Active)
  const markKeyHanded = useMutation({
    mutationFn: async (type: HandoverType) => {
      if (!rentalId) throw new Error("Rental ID required");

      // Update handover record with handed_at timestamp
      const handover = getHandover(type);
      if (handover) {
        await supabase
          .from("rental_key_handovers")
          .update({ handed_at: new Date().toISOString() })
          .eq("id", handover.id);
      }

      // If giving key, update rental status to Active
      if (type === "giving") {
        const { error } = await supabase
          .from("rentals")
          .update({ status: "Active" })
          .eq("id", rentalId);

        if (error) throw error;
      }

      // If receiving key, update rental status to Closed and vehicle to Available
      if (type === "receiving") {
        // Get the vehicle_id from the rental
        const { data: rental } = await supabase
          .from("rentals")
          .select("vehicle_id")
          .eq("id", rentalId)
          .single();

        // Update rental status to Closed
        const { error } = await supabase
          .from("rentals")
          .update({ status: "Closed" })
          .eq("id", rentalId);

        if (error) throw error;

        // Update vehicle status to Available
        if (rental?.vehicle_id) {
          await supabase
            .from("vehicles")
            .update({ status: "Available" })
            .eq("id", rental.vehicle_id);
        }
      }

      return { type };
    },
    onSuccess: ({ type }) => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });

      toast({
        title: type === "giving" ? "Key Handed Over" : "Key Received",
        description: type === "giving"
          ? "Rental is now active."
          : "Rental is now closed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update notes
  const updateNotes = useMutation({
    mutationFn: async ({ type, notes }: { type: HandoverType; notes: string }) => {
      if (!rentalId) throw new Error("Rental ID required");

      const handover = await ensureHandover.mutateAsync(type);

      const { error } = await supabase
        .from("rental_key_handovers")
        .update({ notes })
        .eq("id", handover.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
    },
  });

  return {
    handovers,
    isLoading,
    getHandover,
    givingHandover: getHandover("giving"),
    receivingHandover: getHandover("receiving"),
    uploadPhoto,
    deletePhoto,
    markKeyHanded,
    updateNotes,
    isUploading: uploadPhoto.isPending,
    isDeleting: deletePhoto.isPending,
    isMarkingHanded: markKeyHanded.isPending,
  };
}
