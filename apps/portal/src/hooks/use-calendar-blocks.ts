import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

/**
 * Create / remove manual availability blocks (blocked_dates) directly from the
 * fleet calendar. Used by the inline drag-to-block interaction. Invalidates the
 * calendar query so the new/removed block appears immediately.
 */
export const useCalendarBlocks = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["calendar-rentals"] });

  const createBlock = useMutation({
    mutationFn: async (input: {
      vehicleId: string;
      startDate: string;
      endDate: string;
      reason?: string | null;
    }) => {
      if (!tenant?.id) throw new Error("No tenant context");
      const { error } = await supabase.from("blocked_dates").insert({
        tenant_id: tenant.id,
        vehicle_id: input.vehicleId,
        start_date: input.startDate,
        end_date: input.endDate,
        reason: input.reason?.trim() || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Dates blocked", description: "The vehicle is now unavailable for that window." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't block dates",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const removeBlock = useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase
        .from("blocked_dates")
        .delete()
        .eq("id", blockId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Block removed", description: "The vehicle is available again for those dates." });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't remove block",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return { createBlock, removeBlock };
};
