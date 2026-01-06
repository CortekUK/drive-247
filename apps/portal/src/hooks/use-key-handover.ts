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
        .order("created_at", { ascending: false });

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
        .maybeSingle();

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

  // Mark key as handed (updates rental status to Active only if approved)
  const markKeyHanded = useMutation({
    mutationFn: async (type: HandoverType) => {
      if (!rentalId) throw new Error("Rental ID required");

      // Ensure handover record exists first
      let handover = getHandover(type);
      if (!handover) {
        // Create the handover record if it doesn't exist
        const { data: existing } = await supabase
          .from("rental_key_handovers")
          .select("id")
          .eq("rental_id", rentalId)
          .eq("handover_type", type)
          .maybeSingle();

        if (existing) {
          handover = existing as any;
        } else {
          const { data: newHandover, error: createError } = await supabase
            .from("rental_key_handovers")
            .insert({
              rental_id: rentalId,
              handover_type: type,
              tenant_id: tenant?.id,
            })
            .select()
            .single();

          if (createError) throw createError;
          handover = newHandover as any;
        }
      }

      // Update handover record with handed_at timestamp
      if (handover) {
        await supabase
          .from("rental_key_handovers")
          .update({ handed_at: new Date().toISOString() })
          .eq("id", handover.id);
      }

      // If giving key, check if rental is approved before setting to Active
      if (type === "giving") {
        // First, get the rental with customer and vehicle info for notifications
        const { data: rental, error: rentalError } = await supabase
          .from("rentals")
          .select(`
            approval_status,
            payment_status,
            booking_reference,
            start_date,
            end_date,
            customer:customers(
              id,
              first_name,
              last_name,
              email,
              phone
            ),
            vehicle:vehicles(
              id,
              make,
              model,
              registration_number,
              color
            )
          `)
          .eq("id", rentalId)
          .single();

        if (rentalError) {
          console.error('Error fetching rental for key handover:', rentalError);
        }
        console.log('Key handover - rental data:', {
          approval_status: rental?.approval_status,
          payment_status: rental?.payment_status,
          hasCustomer: !!rental?.customer,
          hasVehicle: !!rental?.vehicle
        });

        // Only set to Active if rental is approved AND payment is fulfilled
        if (rental?.approval_status === 'approved' && rental?.payment_status === 'fulfilled') {
          const { error } = await supabase
            .from("rentals")
            .update({ status: "Active" })
            .eq("id", rentalId);

          if (error) throw error;

          // Send rental started notification to customer
          try {
            const customer = rental.customer as { first_name: string; last_name: string; email: string; phone: string } | null;
            const vehicle = rental.vehicle as { make: string; model: string; registration_number: string; color: string } | null;

            console.log('Rental started - preparing notification:', {
              customerEmail: customer?.email,
              vehicleMake: vehicle?.make,
              tenantId: tenant?.id
            });

            if (customer?.email && vehicle) {
              const notifyPayload = {
                customerName: `${customer.first_name} ${customer.last_name}`,
                customerEmail: customer.email,
                customerPhone: customer.phone,
                vehicleName: `${vehicle.make} ${vehicle.model}`,
                vehicleReg: vehicle.registration_number,
                vehicleMake: vehicle.make,
                vehicleModel: vehicle.model,
                vehicleColor: vehicle.color,
                bookingRef: rental.booking_reference || rentalId,
                startDate: rental.start_date ? new Date(rental.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
                endDate: rental.end_date ? new Date(rental.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
                tenantId: tenant?.id,
              };
              console.log('Invoking notify-rental-started with payload:', notifyPayload);

              const { data: notifyResult, error: notifyError } = await supabase.functions.invoke('notify-rental-started', {
                body: notifyPayload,
              });

              if (notifyError) {
                console.error('Rental started notification error:', notifyError);
              } else {
                console.log('Rental started notification result:', notifyResult);
              }
            } else {
              console.warn('Missing customer email or vehicle data for notification');
            }
          } catch (notifyError) {
            console.error('Failed to send rental started notification:', notifyError);
            // Don't throw - notification failure shouldn't block the handover
          }

          return { type, becameActive: true };
        }

        return { type, becameActive: false };
      }

      // If receiving key, update rental status to Closed and vehicle to Available
      if (type === "receiving") {
        // Get the vehicle_id from the rental
        const { data: rental } = await supabase
          .from("rentals")
          .select("vehicle_id")
          .eq("id", rentalId)
          .maybeSingle();

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

      return { type, becameActive: false };
    },
    onSuccess: ({ type, becameActive }) => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["key-handover-status", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });

      if (type === "giving") {
        toast({
          title: "Key Handed Over",
          description: becameActive
            ? "Rental is now active."
            : "Key handover recorded. Rental will become active once approved.",
        });
      } else {
        toast({
          title: "Key Received",
          description: "Rental is now closed.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Undo key handed (toggle off)
  const unmarkKeyHanded = useMutation({
    mutationFn: async (type: HandoverType) => {
      if (!rentalId) throw new Error("Rental ID required");

      // Find the handover record
      let handover = getHandover(type);
      if (!handover) {
        // Try to fetch from database
        const { data: existing } = await supabase
          .from("rental_key_handovers")
          .select("id")
          .eq("rental_id", rentalId)
          .eq("handover_type", type)
          .maybeSingle();

        if (existing) {
          handover = existing as any;
        }
      }

      // Update handover record to clear handed_at timestamp
      if (handover) {
        await supabase
          .from("rental_key_handovers")
          .update({ handed_at: null })
          .eq("id", handover.id);
      }

      // If undoing giving key, revert rental status from Active to Pending
      if (type === "giving") {
        // Check current status - only revert if it was Active
        const { data: rental } = await supabase
          .from("rentals")
          .select("status")
          .eq("id", rentalId)
          .single();

        if (rental?.status === 'Active') {
          const { error } = await supabase
            .from("rentals")
            .update({ status: "Pending" })
            .eq("id", rentalId);

          if (error) throw error;
        }
      }

      return { type };
    },
    onSuccess: ({ type }) => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["key-handover-status", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });

      toast({
        title: type === "giving" ? "Key Handover Undone" : "Key Receipt Undone",
        description: type === "giving"
          ? "Vehicle collection has been unmarked."
          : "Vehicle return has been unmarked.",
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
    unmarkKeyHanded,
    updateNotes,
    isUploading: uploadPhoto.isPending,
    isDeleting: deletePhoto.isPending,
    isMarkingHanded: markKeyHanded.isPending,
    isUnmarkingHanded: unmarkKeyHanded.isPending,
  };
}
