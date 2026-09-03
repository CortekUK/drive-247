import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { isAreaHidden } from "@/lib/lean-areas";
import type {
  VehicleHealthRow,
  VehicleHealthStatus,
  MaintenanceConflict,
} from "@/types/fleet-health";
import { HEALTH_STATUS_RANK } from "@/types/fleet-health";

/**
 * Every Fleet Health query key that a mutation may invalidate.
 * Follows the DEPENDENT_KEYS fan-out pattern from use-expenses.ts — a maintenance
 * write can move the fleet list, one vehicle's panel, the job list and the vehicle
 * row itself, and missing one leaves a stale "Available" on screen.
 */
const DEPENDENT_KEYS = [
  "fleet-health",
  "vehicle-health",
  "maintenance-jobs",
  "maintenance-rules",
  "odometer-readings",
  "vehicles",
  "vehicle",
  "blocked-dates",
] as const;

function invalidateFleetHealth(qc: ReturnType<typeof useQueryClient>) {
  DEPENDENT_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/**
 * Whether this tenant has turned Fleet Health on.
 *
 * `fleet_health_enabled` is NOT in TenantContext's explicit column list, so it is
 * read from the rental-settings row (a SELECT * on `tenants`) — the same cache the
 * settings toggle writes through. `=== true` keeps every surface hidden while that
 * query is in flight rather than flashing UI the tenant has not enabled.
 *
 * The column defaults to false, so without this gate the feature would effectively
 * ship on for every tenant on the platform with only its navigation hidden.
 *
 * ALSO the single choke point for the lean-product gate, and deliberately so.
 * Every Fleet Health affordance outside the `/fleet-health` route itself already
 * asks this one question before rendering — the Health column and filter on the
 * vehicles list, the whole Fleet Health card on vehicle detail (with its Record
 * odometer / Schedule / Report issue buttons and the maintenance-rules editor),
 * and the health chip on the vehicle picker in rentals/new. Gating HERE closes
 * all of them at once and cannot be missed the next time one is added, which
 * gating each call site individually could.
 *
 * Presentation only: `tenants.fleet_health_enabled` is untouched, cron 66
 * `evaluate-fleet-health` keeps running, and every other tenant is unaffected.
 */
export function useFleetHealthEnabled(): boolean {
  const { settings } = useRentalSettings();
  const { tenantSlug } = useTenant();
  if (isAreaHidden("fleet-health", tenantSlug)) return false;
  return (
    (settings as unknown as { fleet_health_enabled?: boolean } | null)
      ?.fleet_health_enabled === true
  );
}

/** Fleet-wide health, pre-sorted by urgency. Answers "what needs my attention?". */
export function useFleetHealth() {
  const { tenant } = useTenant();
  const enabled = useFleetHealthEnabled();

  return useQuery({
    queryKey: ["fleet-health", tenant?.id],
    queryFn: async (): Promise<VehicleHealthRow[]> => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("vehicle_health_cache")
        .select(
          "*, vehicles!inner(reg, make, model, current_mileage, status, is_disposed)"
        )
        .eq("tenant_id", tenant.id);

      if (error) throw error;

      return (data ?? [])
        .filter((r: any) => r.vehicles && !r.vehicles.is_disposed)
        .map((r: any) => ({
          vehicle_id: r.vehicle_id,
          tenant_id: r.tenant_id,
          status: r.status as VehicleHealthStatus,
          reasons: Array.isArray(r.reasons) ? r.reasons : [],
          next_due_date: r.next_due_date,
          next_due_miles: r.next_due_miles,
          confidence: r.confidence,
          daily_burn: r.daily_burn,
          open_job_count: r.open_job_count ?? 0,
          computed_at: r.computed_at,
          reg: r.vehicles.reg,
          make: r.vehicles.make,
          model: r.vehicles.model,
          current_mileage: r.vehicles.current_mileage,
          vehicle_status: r.vehicles.status,
        }))
        .sort(
          (a, b) =>
            HEALTH_STATUS_RANK[a.status] - HEALTH_STATUS_RANK[b.status] ||
            a.reg.localeCompare(b.reg)
        );
    },
    enabled: !!tenant?.id && enabled,
  });
}

/** Health for a single vehicle, for the vehicle detail page. */
export function useVehicleHealth(vehicleId?: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["vehicle-health", tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant?.id || !vehicleId) return null;

      const { data, error } = await supabase
        .from("vehicle_health_cache")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { ...data, reasons: Array.isArray(data.reasons) ? data.reasons : [] };
    },
    enabled: !!tenant?.id && !!vehicleId,
  });
}

/**
 * Fleet-wide counts, including the setup-coverage figure.
 *
 * `needsSetup` is deliberately prominent: on day one the majority of every real
 * fleet is `unknown`, and an all-unknown table reads as broken software rather
 * than as missing input. The page uses this to decide whether to show the setup
 * screen instead of the list.
 */
export function useFleetHealthStats() {
  const { data: rows = [], isLoading } = useFleetHealth();

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const total = rows.length;
  const seeded = rows.filter((r) => r.current_mileage != null).length;
  const needsAttention =
    (counts.not_road_legal ?? 0) + (counts.overdue ?? 0) + (counts.attention ?? 0);

  return {
    isLoading,
    total,
    counts,
    needsAttention,
    seeded,
    unseeded: total - seeded,
    coverage: total > 0 ? seeded / total : 0,
    /** Below 25% odometer coverage the list is noise — show setup instead. */
    shouldShowSetup: total > 0 && seeded / total < 0.25,
  };
}

/** Recompute on demand — the "Sync now" affordance. */
export function useRecomputeFleetHealth() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async (vehicleId?: string) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      if (vehicleId) {
        const { error } = await supabase.rpc("evaluate_vehicle_health", {
          p_vehicle_id: vehicleId,
        });
        if (error) throw error;
        return 1;
      }

      const { data, error } = await supabase.rpc("evaluate_fleet_health", {
        p_tenant_id: tenant.id,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      invalidateFleetHealth(qc);
      toast({
        title: "Fleet health updated",
        description: `${n} vehicle${n === 1 ? "" : "s"} re-evaluated.`,
      });
    },
    onError: (e: any) =>
      toast({
        title: "Could not refresh",
        description: e.message ?? "Failed to recompute fleet health",
        variant: "destructive",
      }),
  });
}

/**
 * Bookings that a proposed maintenance window would collide with.
 *
 * Checks Active AND Pending. The existing blocked-dates manager checks
 * ['Active','Confirmed'] — 'Confirmed' does not exist in live data and 'Pending'
 * is never checked, so it misses real conflicts today.
 */
export function useMaintenanceConflicts(
  vehicleId?: string,
  start?: string,
  end?: string
) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["maintenance-conflicts", tenant?.id, vehicleId, start, end],
    queryFn: async (): Promise<MaintenanceConflict[]> => {
      if (!vehicleId || !start || !end) return [];

      const { data, error } = await supabase.rpc("preview_maintenance_conflicts", {
        p_vehicle_id: vehicleId,
        p_start: start,
        p_end: end,
      });
      if (error) throw error;
      return (data ?? []) as MaintenanceConflict[];
    },
    enabled: !!tenant?.id && !!vehicleId && !!start && !!end,
  });
}

export { invalidateFleetHealth, DEPENDENT_KEYS };
