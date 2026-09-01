import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import type { VehicleOwner, VehicleOwnerInput } from "@/types/vehicle-owners";

interface UseVehicleOwnersOptions {
  includeInactive?: boolean;
}

export function useVehicleOwners({ includeInactive = false }: UseVehicleOwnersOptions = {}) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["vehicle-owners", tenant?.id, includeInactive],
    queryFn: async (): Promise<VehicleOwner[]> => {
      let query = (supabase as any)
        .from("vehicle_owners")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("full_name", { ascending: true });

      if (!includeInactive) query = query.eq("is_active", true);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as VehicleOwner[];
    },
    enabled: !!tenant?.id,
  });
}

export function useVehicleOwner(ownerId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["vehicle-owner", tenant?.id, ownerId],
    queryFn: async (): Promise<VehicleOwner | null> => {
      if (!ownerId) return null;
      const { data, error } = await (supabase as any)
        .from("vehicle_owners")
        .select("*")
        .eq("id", ownerId)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as VehicleOwner | null) ?? null;
    },
    enabled: !!tenant?.id && !!ownerId,
  });
}

export function useCreateVehicleOwner() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: VehicleOwnerInput): Promise<VehicleOwner> => {
      if (!tenant?.id) throw new Error("Tenant context missing");
      const payload = {
        tenant_id: tenant.id,
        full_name: input.full_name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        commission_type: input.commission_type,
        commission_value: input.commission_value,
        flat_fee_period: input.commission_type === "flat_fee" ? input.flat_fee_period ?? "per_month" : null,
        payout_frequency: input.payout_frequency,
        is_active: input.is_active ?? true,
      };
      const { data, error } = await (supabase as any)
        .from("vehicle_owners")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return data as VehicleOwner;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-owners", tenant?.id] });
      toast({ title: "Owner created", description: "The vehicle owner has been added." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create owner", description: err.message, variant: "destructive" });
    },
  });
}

export function useUpdateVehicleOwner() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<VehicleOwnerInput> }): Promise<VehicleOwner> => {
      const updates: Record<string, unknown> = { ...patch };
      // Clear flat_fee_period when switching to percentage
      if (patch.commission_type === "percentage") updates.flat_fee_period = null;
      // Track archive timestamp on deactivation
      if (patch.is_active === false) updates.archived_at = new Date().toISOString();
      if (patch.is_active === true) updates.archived_at = null;

      const { data, error } = await (supabase as any)
        .from("vehicle_owners")
        .update(updates)
        .eq("id", id)
        .eq("tenant_id", tenant!.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as VehicleOwner;
    },
    onSuccess: (owner) => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-owners", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-owner", tenant?.id, owner.id] });
      toast({ title: "Owner updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update owner", description: err.message, variant: "destructive" });
    },
  });
}
