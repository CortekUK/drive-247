import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import type { CommissionType, FlatFeePeriod } from "@/types/vehicle-owners";

export interface OwnerVehicleRow {
  id: string;
  reg: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string | null;
  ownership_assigned_at: string | null;
  commission_type_override: CommissionType | null;
  commission_value_override: number | null;
  flat_fee_period_override: FlatFeePeriod | null;
}

export function useOwnerVehicles(ownerId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["owner-vehicles", tenant?.id, ownerId],
    queryFn: async (): Promise<OwnerVehicleRow[]> => {
      if (!ownerId) return [];
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select(
          "id, reg, make, model, year, status, ownership_assigned_at, commission_type_override, commission_value_override, flat_fee_period_override"
        )
        .eq("tenant_id", tenant!.id)
        .eq("owner_id", ownerId)
        .order("reg", { ascending: true });
      if (error) throw error;
      return (data || []) as OwnerVehicleRow[];
    },
    enabled: !!tenant?.id && !!ownerId,
  });
}

export interface AssignVehicleOwnerInput {
  vehicle_id: string;
  owner_id: string | null; // null to unassign
  commission_type_override?: CommissionType | null;
  commission_value_override?: number | null;
  flat_fee_period_override?: FlatFeePeriod | null;
}

export function useAssignVehicleOwner() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AssignVehicleOwnerInput) => {
      const updates: Record<string, unknown> = {
        owner_id: input.owner_id,
        ownership_assigned_at: input.owner_id ? new Date().toISOString() : null,
      };
      if (input.owner_id === null) {
        // Clear overrides when unassigning
        updates.commission_type_override = null;
        updates.commission_value_override = null;
        updates.flat_fee_period_override = null;
      } else {
        if (input.commission_type_override !== undefined) updates.commission_type_override = input.commission_type_override;
        if (input.commission_value_override !== undefined) updates.commission_value_override = input.commission_value_override;
        if (input.flat_fee_period_override !== undefined) updates.flat_fee_period_override = input.flat_fee_period_override;
      }

      const { error } = await (supabase as any)
        .from("vehicles")
        .update(updates)
        .eq("id", input.vehicle_id)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["owner-vehicles", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["vehicles", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle", tenant?.id, input.vehicle_id] });
      toast({
        title: input.owner_id ? "Vehicle assigned" : "Vehicle unassigned",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update vehicle ownership", description: err.message, variant: "destructive" });
    },
  });
}
