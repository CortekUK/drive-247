import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { calculateTotalMileageAllowance, getMileageTier, isUnlimitedMileage } from "@/lib/mileage-utils";

export interface MileageSummary {
  pickupMileage: number;
  returnMileage: number;
  milesDriven: number;
  allowedMileage: number | null; // null = unlimited
  excessMiles: number;
  excessRate: number | null;
  chargeAmount: number | null;
  tier: string;
  isUnlimited: boolean;
}

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
  mileage: number | null;
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

      // Create new handover record (upsert to avoid conflict on race conditions)
      const { data, error } = await supabase
        .from("rental_key_handovers")
        .upsert({
          rental_id: rentalId,
          handover_type: type,
          tenant_id: tenant?.id,
        }, { onConflict: 'rental_id,handover_type' })
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
            .upsert({
              rental_id: rentalId,
              handover_type: type,
              tenant_id: tenant?.id,
            }, { onConflict: 'rental_id,handover_type' })
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
        let rentalQuery = supabase
          .from("rentals")
          .select(`
            id,
            approval_status,
            payment_status,
            start_date,
            end_date,
            customer:customers(
              id,
              name,
              email,
              phone
            ),
            vehicle:vehicles(
              id,
              make,
              model,
              reg,
              color
            )
          `)
          .eq("id", rentalId);

        // Add tenant filter if available
        if (tenant?.id) {
          rentalQuery = rentalQuery.eq("tenant_id", tenant.id);
        }

        const { data: rental, error: rentalError } = await rentalQuery.single();

        if (rentalError) {
          console.error('Error fetching rental for key handover:', rentalError.message || rentalError);
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
            const customer = rental.customer as { name: string; email: string; phone: string } | null;
            const vehicle = rental.vehicle as { make: string; model: string; reg: string; color: string } | null;

            console.log('Rental started - preparing notification:', {
              customerEmail: customer?.email,
              vehicleMake: vehicle?.make,
              tenantId: tenant?.id
            });

            if (customer?.email && vehicle) {
              const notifyPayload = {
                rentalId: rentalId,
                customerName: customer.name,
                customerEmail: customer.email,
                vehicleName: `${vehicle.make} ${vehicle.model}`,
                bookingRef: rentalId,
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

          // Place deposit hold on customer's saved card
          let depositHoldResult: any = null;
          try {
            const { data: holdData, error: holdError } = await supabase.functions.invoke('place-deposit-hold', {
              body: { rentalId, tenantId: tenant?.id },
            });
            if (holdError) {
              console.warn('[KEY-HANDOVER] Deposit hold failed:', holdError);
            } else {
              depositHoldResult = holdData;
              console.log('[KEY-HANDOVER] Deposit hold result:', holdData);
            }
          } catch (holdErr) {
            console.warn('[KEY-HANDOVER] Deposit hold error (non-blocking):', holdErr);
          }

          return {
            type,
            becameActive: true,
            depositRefunded: false,
            depositAmount: depositHoldResult?.amount || 0,
            depositHoldPlaced: depositHoldResult?.success && !depositHoldResult?.skipped && !depositHoldResult?.alreadyHeld,
          };
        }

        return { type, becameActive: false, depositRefunded: false, depositAmount: 0 };
      }

      // If receiving key, update rental status to Closed, vehicle to Available
      if (type === "receiving") {
        // Get the rental details including vehicle_id and tenant_id
        const { data: rental } = await supabase
          .from("rentals")
          .select("vehicle_id, tenant_id, customer_id")
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

        // Release deposit hold (if one exists)
        try {
          const { data: releaseData, error: releaseError } = await supabase.functions.invoke('release-deposit-hold', {
            body: { rentalId, tenantId: rental?.tenant_id || tenant?.id },
          });
          if (releaseError) {
            console.warn('[KEY-HANDOVER] Deposit hold release failed:', releaseError);
          } else {
            console.log('[KEY-HANDOVER] Deposit hold release result:', releaseData);
          }
        } catch (releaseErr) {
          console.warn('[KEY-HANDOVER] Deposit hold release error (non-blocking):', releaseErr);
        }

        // Send rental completed notification
        try {
          await supabase.functions.invoke('notify-rental-completed', {
            body: {
              rentalId: rentalId,
              tenantId: rental?.tenant_id || tenant?.id,
              bookingRef: rentalId.substring(0, 8).toUpperCase(),
            }
          });
        } catch (notifyErr) {
          console.warn('[KEY-HANDOVER] Failed to send rental completed notification:', notifyErr);
        }

        return { type, becameActive: false, depositRefunded: false, depositAmount: 0 };
      }

      return { type, becameActive: false, depositRefunded: false, depositAmount: 0 };
    },
    onSuccess: ({ type, becameActive, depositRefunded, depositAmount, depositHoldPlaced }: any) => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["key-handover-status", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["key-return-status", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      // Also invalidate payment/invoice data for refund updates
      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
      queryClient.invalidateQueries({ queryKey: ["rental-invoice"] });
      queryClient.invalidateQueries({ queryKey: ["rental-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payments-data"] });
      queryClient.invalidateQueries({ queryKey: ["rental-charges"] });
      queryClient.invalidateQueries({ queryKey: ["key-handovers-mileage", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["excess-mileage-charge", rentalId] });

      if (type === "giving") {
        const depositMsg = depositHoldPlaced ? ` Deposit hold of $${depositAmount} placed on card.` : '';
        toast({
          title: "Key Handed Over",
          description: becameActive
            ? `Rental is now active.${depositMsg}`
            : "Key handover recorded. Rental will become active once approved.",
        });
      } else {
        toast({
          title: "Key Received",
          description: "Rental is now closed. Deposit hold released.",
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
      queryClient.invalidateQueries({ queryKey: ["key-return-status", rentalId] });
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

  // Update mileage
  const updateMileage = useMutation({
    mutationFn: async ({ type, mileage }: { type: HandoverType; mileage: number | null }) => {
      if (!rentalId) throw new Error("Rental ID required");

      const handover = await ensureHandover.mutateAsync(type);

      const { error } = await supabase
        .from("rental_key_handovers")
        .update({ mileage })
        .eq("id", handover.id);

      if (error) throw error;

      // Update the vehicle's current_mileage on both giving and receiving handovers
      if (mileage) {
        const { data: rental } = await supabase
          .from("rentals")
          .select("vehicle_id")
          .eq("id", rentalId)
          .maybeSingle();

        if (rental?.vehicle_id) {
          await supabase
            .from("vehicles")
            .update({ current_mileage: mileage })
            .eq("id", rental.vehicle_id);
        }

        // Auto-calculate excess mileage charge on return
        if (type === "receiving") {
          try {
            const { error: calcError } = await supabase.functions.invoke('calculate-excess-mileage', {
              body: { rentalId, tenantId: tenant?.id },
            });
            if (calcError) {
              console.error('[MILEAGE] Excess mileage calculation error:', calcError);
            }
          } catch (calcErr) {
            console.error('[MILEAGE] Error calling calculate-excess-mileage:', calcErr);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["key-handovers", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["key-handovers-mileage", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-mileage"] });
      queryClient.invalidateQueries({ queryKey: ["rental-charges"] });
      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
      queryClient.invalidateQueries({ queryKey: ["rental-invoice"] });
      queryClient.invalidateQueries({ queryKey: ["excess-mileage-charge", rentalId] });
      toast({
        title: "Mileage Updated",
        description: "Odometer reading has been recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch mileage summary after return — used to show the excess mileage popup
  const fetchMileageSummary = async (): Promise<MileageSummary | null> => {
    if (!rentalId) return null;

    // Fetch both handovers
    const { data: ho } = await supabase
      .from("rental_key_handovers")
      .select("handover_type, mileage")
      .eq("rental_id", rentalId);

    const pickupMileage = ho?.find((h) => h.handover_type === "giving")?.mileage;
    const returnMileage = ho?.find((h) => h.handover_type === "receiving")?.mileage;

    if (!pickupMileage || !returnMileage) return null;

    // Fetch rental dates + mileage overrides
    const { data: rental } = await supabase
      .from("rentals")
      .select("vehicle_id, start_date, end_date, daily_mileage_override, weekly_mileage_override, monthly_mileage_override, excess_mileage_rate_override")
      .eq("id", rentalId)
      .single();

    if (!rental?.vehicle_id) return null;

    // Fetch vehicle mileage config
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate")
      .eq("id", rental.vehicle_id)
      .single();

    if (!vehicle) return null;

    const effectiveVehicle = {
      daily_mileage: rental.daily_mileage_override ?? vehicle.daily_mileage,
      weekly_mileage: rental.weekly_mileage_override ?? vehicle.weekly_mileage,
      monthly_mileage: rental.monthly_mileage_override ?? vehicle.monthly_mileage,
    };
    const effectiveExcessRate = rental.excess_mileage_rate_override ?? vehicle.excess_mileage_rate;

    let rentalDays = 1;
    if (rental.start_date && rental.end_date) {
      rentalDays = Math.max(1, Math.ceil(
        (new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)
      ));
    }

    const monthlyTierDays = tenant?.monthly_tier_days ?? 30;
    const unlimited = isUnlimitedMileage(effectiveVehicle);
    const allowedMileage = calculateTotalMileageAllowance(effectiveVehicle, rentalDays, monthlyTierDays);
    const tier = getMileageTier(rentalDays, monthlyTierDays);
    const milesDriven = returnMileage - pickupMileage;
    const excessMiles = allowedMileage !== null ? Math.max(0, milesDriven - allowedMileage) : 0;
    const chargeAmount = excessMiles > 0 && effectiveExcessRate
      ? Math.round(excessMiles * effectiveExcessRate * 100) / 100
      : null;

    return {
      pickupMileage,
      returnMileage,
      milesDriven,
      allowedMileage,
      excessMiles,
      excessRate: effectiveExcessRate,
      chargeAmount,
      tier,
      isUnlimited: unlimited,
    };
  };

  return {
    handovers,
    isLoading,
    getHandover,
    givingHandover: getHandover("giving"),
    receivingHandover: getHandover("receiving"),
    fetchMileageSummary,
    uploadPhoto,
    deletePhoto,
    markKeyHanded,
    unmarkKeyHanded,
    updateNotes,
    updateMileage,
    isUploading: uploadPhoto.isPending,
    isDeleting: deletePhoto.isPending,
    isMarkingHanded: markKeyHanded.isPending,
    isUnmarkingHanded: unmarkKeyHanded.isPending,
    isUpdatingMileage: updateMileage.isPending,
  };
}
