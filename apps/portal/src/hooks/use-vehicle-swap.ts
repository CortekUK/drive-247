import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

const FAR_FUTURE = "9999-12-31";

export interface SwapCandidate {
  id: string;
  reg: string;
  make: string;
  model: string;
  status: string;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  /** Has another active/pending rental overlapping this rental's dates. */
  unavailable: boolean;
  /** Has a vehicle-specific blocked-dates range overlapping this rental's dates. */
  blocked: boolean;
  conflictReason?: string;
}

interface UseVehicleSwapArgs {
  rentalId: string;
  currentVehicleId?: string | null;
  /** YYYY-MM-DD */
  startDate?: string | null;
  /** YYYY-MM-DD — null/undefined for open-ended (PAYG) rentals. */
  endDate?: string | null;
  enabled?: boolean;
}

export interface SwapVehicleInput {
  newVehicleId: string;
  reason?: string;
  /** Optional maintenance block on the old vehicle (YYYY-MM-DD). */
  blockOldStart?: string | null;
  blockOldEnd?: string | null;
}

/**
 * Powers the "Swap Vehicle" dialog on the rental detail page. Lists the tenant's
 * vehicles as swap candidates (flagging the ones that already overlap a booking
 * or a vehicle-specific block for this rental's dates) and exposes a mutation
 * that calls the `swap_rental_vehicle` RPC — which atomically reassigns the
 * vehicle, frees the old car, marks the new one rented, optionally blocks the
 * old car for maintenance, and records a history row.
 */
export const useVehicleSwap = ({
  rentalId,
  currentVehicleId,
  startDate,
  endDate,
  enabled = true,
}: UseVehicleSwapArgs) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const candidatesQuery = useQuery({
    queryKey: ["swap-vehicle-candidates", tenant?.id, rentalId, startDate, endDate],
    queryFn: async (): Promise<SwapCandidate[]> => {
      if (!tenant) throw new Error("No tenant context available");

      // 1. All non-disposed vehicles for this tenant (the current car is excluded below).
      const { data: vehicles, error: vErr } = await (supabase as any)
        .from("vehicles")
        .select("id, reg, make, model, status, daily_rent, weekly_rent, monthly_rent")
        .eq("tenant_id", tenant.id)
        .neq("status", "Disposed")
        .order("reg", { ascending: true });
      if (vErr) throw vErr;

      const start = startDate || new Date().toISOString().split("T")[0];
      const end = endDate || FAR_FUTURE;

      // 2. Vehicles tied up by another active/pending rental overlapping these dates.
      const { data: overlapRentals, error: rErr } = await (supabase as any)
        .from("rentals")
        .select("vehicle_id, start_date, end_date, status")
        .eq("tenant_id", tenant.id)
        .neq("id", rentalId)
        .in("status", ["Active", "Pending"])
        .lte("start_date", end);
      if (rErr) throw rErr;

      const unavailableIds = new Set<string>();
      for (const r of overlapRentals || []) {
        const rEnd = r.end_date || FAR_FUTURE;
        // overlap when r.start <= end AND r.end >= start
        if (r.start_date <= end && rEnd >= start && r.vehicle_id) {
          unavailableIds.add(r.vehicle_id);
        }
      }

      // 3. Vehicle-specific blocked-dates overlapping these dates.
      const { data: blocks, error: bErr } = await (supabase as any)
        .from("blocked_dates")
        .select("vehicle_id, start_date, end_date")
        .eq("tenant_id", tenant.id)
        .not("vehicle_id", "is", null)
        .gte("end_date", start);
      if (bErr) throw bErr;

      const blockedIds = new Set<string>();
      for (const b of blocks || []) {
        if (b.start_date <= end && b.end_date >= start && b.vehicle_id) {
          blockedIds.add(b.vehicle_id);
        }
      }

      return (vehicles || [])
        .filter((v: any) => v.id !== currentVehicleId)
        .map((v: any): SwapCandidate => {
          const unavailable = unavailableIds.has(v.id);
          const blocked = blockedIds.has(v.id);
          return {
            ...v,
            unavailable,
            blocked,
            conflictReason: unavailable
              ? "Booked for overlapping dates"
              : blocked
              ? "Blocked for maintenance"
              : undefined,
          };
        });
    },
    enabled: !!tenant && enabled && !!rentalId,
  });

  const swapMutation = useMutation({
    mutationFn: async (input: SwapVehicleInput) => {
      const { data, error } = await (supabase as any).rpc("swap_rental_vehicle", {
        p_rental_id: rentalId,
        p_new_vehicle_id: input.newVehicleId,
        p_reason: input.reason?.trim() || null,
        p_block_old_start: input.blockOldStart || null,
        p_block_old_end: input.blockOldEnd || null,
      });
      if (error) throw error;
      return data as { swap_id: string; old_vehicle_id: string; new_vehicle_id: string };
    },
    onSuccess: (data, input) => {
      toast({
        title: "Vehicle swapped",
        description: "The rental has been moved to the new vehicle.",
      });
      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["active-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["customer-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["blocked-dates"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-swap-history", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["swap-vehicle-candidates"] });

      logAction({
        action: "rental_vehicle_swapped",
        entityType: "rental",
        entityId: rentalId,
        details: {
          old_vehicle_id: data?.old_vehicle_id,
          new_vehicle_id: input.newVehicleId,
          reason: input.reason || null,
          blocked_old:
            input.blockOldStart && input.blockOldEnd
              ? { start: input.blockOldStart, end: input.blockOldEnd }
              : null,
        },
      });
    },
    onError: (error: any) => {
      const raw = error?.message || "Failed to swap vehicle. Please try again.";
      const message = /overlap/i.test(raw)
        ? "That vehicle already has a booking overlapping these dates."
        : raw;
      toast({ title: "Couldn't swap vehicle", description: message, variant: "destructive" });
    },
  });

  return {
    candidates: candidatesQuery.data ?? [],
    isLoadingCandidates: candidatesQuery.isLoading,
    swap: swapMutation.mutate,
    isSwapping: swapMutation.isPending,
  };
};

export interface VehicleSwapHistoryRow {
  id: string;
  reason: string | null;
  created_at: string;
  old_vehicle: { reg: string; make: string; model: string } | null;
  new_vehicle: { reg: string; make: string; model: string } | null;
}

/** Swap history for a single rental, newest first. */
export const useVehicleSwapHistory = (rentalId?: string) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["vehicle-swap-history", rentalId],
    queryFn: async (): Promise<VehicleSwapHistoryRow[]> => {
      const { data, error } = await (supabase as any)
        .from("rental_vehicle_swaps")
        .select(
          "id, reason, created_at, " +
            "old_vehicle:vehicles!rental_vehicle_swaps_old_vehicle_id_fkey(reg, make, model), " +
            "new_vehicle:vehicles!rental_vehicle_swaps_new_vehicle_id_fkey(reg, make, model)"
        )
        .eq("rental_id", rentalId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as VehicleSwapHistoryRow[];
    },
    enabled: !!tenant && !!rentalId,
  });
};
