import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { invalidateFleetHealth } from "@/hooks/use-fleet-health";
import type { OdometerReading, OdometerSource } from "@/types/fleet-health";

/**
 * Odometer readings.
 *
 * Before this existed there was NO screen anywhere in the product that let a human
 * enter an odometer reading — the only writer was the key-handover flow. That is
 * why 80% of real vehicles have no reading and mileage-interval maintenance was
 * computable for exactly 5 vehicles platform-wide. This hook is the gate that
 * unblocks every mileage rule, and the only way to correct a bad cached value.
 */
export function useOdometerReadings(vehicleId?: string, limit = 20) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["odometer-readings", tenant?.id, vehicleId, limit],
    queryFn: async (): Promise<OdometerReading[]> => {
      if (!tenant?.id || !vehicleId) return [];

      const { data, error } = await supabase
        .from("vehicle_odometer_readings")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("vehicle_id", vehicleId)
        .order("observed_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as OdometerReading[];
    },
    enabled: !!tenant?.id && !!vehicleId,
  });
}

export interface RecordOdometerInput {
  vehicleId: string;
  reading: number;
  observedAt?: string;
  source?: OdometerSource;
  note?: string | null;
  /**
   * Set when the operator has been warned the value is lower than the last known
   * reading and has confirmed anyway. Stored but never allowed to move the cached
   * current_mileage, so a typo cannot silently reset an interval baseline.
   */
  isSuspect?: boolean;
}

export function useRecordOdometer() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { appUser } = useAuth();

  return useMutation({
    mutationFn: async (input: RecordOdometerInput) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      // A literal 0 is legitimate on a brand-new vehicle. The existing handover
      // writer guards with `if (mileage)`, so 0 is falsy there and the reading is
      // silently dropped along with the excess-mileage calculation.
      if (input.reading === null || input.reading === undefined) {
        throw new Error("A reading is required");
      }
      if (!Number.isFinite(input.reading) || input.reading < 0) {
        throw new Error("Reading must be a positive number");
      }

      const { data, error } = await supabase
        .from("vehicle_odometer_readings")
        .insert({
          tenant_id: tenant.id,
          vehicle_id: input.vehicleId,
          reading: Math.round(input.reading),
          observed_at: input.observedAt ?? new Date().toISOString(),
          source: input.source ?? "manual",
          note: input.note ?? null,
          is_suspect: input.isSuspect ?? false,
          recorded_by: appUser?.id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as OdometerReading;
    },
    onSuccess: (row) => {
      invalidateFleetHealth(qc);
      toast({
        title: "Reading recorded",
        description: row.is_suspect
          ? "Saved for the record, but flagged as suspect so it will not change the vehicle's mileage."
          : `Odometer set to ${row.reading.toLocaleString()}.`,
      });
    },
    onError: (e: any) =>
      toast({
        title: "Could not record reading",
        description: e.message ?? "Failed to record odometer reading",
        variant: "destructive",
      }),
  });
}

/**
 * Vehicles with no reading at all — the setup work-list.
 *
 * Ordered by how much the missing reading costs: cars with a compliance date, then
 * cars that have been rented, then the rest. An operator setting up a 22-vehicle
 * fleet should be asked about the vehicles that matter first, and should be able to
 * see the work is finite.
 */
export function useVehiclesNeedingOdometer() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["vehicles-needing-odometer", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model, current_mileage, mot_due_date, tax_due_date, last_service_date")
        .eq("tenant_id", tenant.id)
        .or("is_disposed.is.null,is_disposed.eq.false")
        .is("current_mileage", null)
        .order("reg");

      if (error) throw error;

      return (data ?? []).sort((a: any, b: any) => {
        const score = (v: any) =>
          (v.mot_due_date || v.tax_due_date ? 0 : 1) + (v.last_service_date ? 0 : 1);
        return score(a) - score(b) || String(a.reg).localeCompare(String(b.reg));
      });
    },
    enabled: !!tenant?.id,
  });
}
