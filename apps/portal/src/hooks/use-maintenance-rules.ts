import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { invalidateFleetHealth } from "@/hooks/use-fleet-health";
import type { MaintenanceRule } from "@/types/fleet-health";

/**
 * Maintenance schedules.
 *
 * Rules are STRICTLY OPT-IN and never a prerequisite: with zero rules configured
 * the feature still surfaces compliance dates and last-service age. 12 of 23
 * vehicle-owning tenants have four vehicles or fewer, and forcing them through
 * interval setup before the product does anything is a guaranteed abandonment.
 *
 * A rule with vehicle_id = null is a tenant-wide default; a rule with a vehicle_id
 * overrides the default for the same service_type on that one vehicle.
 */
export function useMaintenanceRules(vehicleId?: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["maintenance-rules", tenant?.id, vehicleId ?? "tenant"],
    queryFn: async (): Promise<MaintenanceRule[]> => {
      if (!tenant?.id) throw new Error("No tenant context available");

      let q = supabase
        .from("vehicle_maintenance_rules")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("sort_order")
        .order("name");

      // Vehicle view shows that vehicle's overrides plus the tenant defaults.
      q = vehicleId
        ? q.or(`vehicle_id.eq.${vehicleId},vehicle_id.is.null`)
        : q.is("vehicle_id", null);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MaintenanceRule[];
    },
    enabled: !!tenant?.id,
  });
}

export interface RuleFormData {
  id?: string;
  vehicle_id?: string | null;
  name: string;
  service_type?: string | null;
  interval_miles?: number | null;
  interval_months?: number | null;
  lead_miles?: number;
  lead_days?: number;
  is_active?: boolean;
  is_excluded?: boolean;
  sort_order?: number;
}

export function useMaintenanceRuleActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  const done = (title: string) => {
    invalidateFleetHealth(qc);
    toast({ title });
  };

  const fail = (fallback: string) => (e: any) =>
    toast({
      title: "Could not save schedule",
      description: e.message ?? fallback,
      variant: "destructive",
    });

  const upsert = useMutation({
    mutationFn: async (form: RuleFormData) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      if (!form.interval_miles && !form.interval_months) {
        throw new Error("Set a mileage interval, a time interval, or both");
      }

      const payload = {
        tenant_id: tenant.id,
        vehicle_id: form.vehicle_id ?? null,
        name: form.name,
        service_type: form.service_type ?? null,
        interval_miles: form.interval_miles ?? null,
        interval_months: form.interval_months ?? null,
        lead_miles: form.lead_miles ?? 500,
        lead_days: form.lead_days ?? 14,
        is_active: form.is_active ?? true,
        is_excluded: form.is_excluded ?? false,
        sort_order: form.sort_order ?? 0,
      };

      const q = form.id
        ? supabase
            .from("vehicle_maintenance_rules")
            .update(payload)
            .eq("id", form.id)
            .eq("tenant_id", tenant.id)
        : supabase.from("vehicle_maintenance_rules").insert(payload);

      const { data, error } = await q.select().single();
      if (error) throw error;

      // A tenant-wide default (vehicle_id null) changes the schedule for every
      // vehicle, but the DB trigger only recomputes when it can name ONE vehicle
      // (`IF v_vehicle IS NOT NULL`), so saving a default refreshed nothing —
      // verified as 0 of 242 vehicles. Until the nightly pass ran, the operator
      // saw their own change have no effect.
      //
      // The recompute is asked for HERE rather than fanned out from the trigger:
      // an inline per-vehicle loop measured ~4s on a fleet this size and would
      // sit inside the operator's save. evaluate_fleet_health is the same
      // set-based pass the nightly cron uses, it is already flag-gated and
      // per-vehicle guarded, and it is fired without await so a slow refresh
      // never blocks the save that succeeded.
      if ((form.vehicle_id ?? null) === null) {
        void supabase
          .rpc("evaluate_fleet_health", { p_tenant_id: tenant.id })
          .then(({ error: evalError }) => {
            if (evalError) {
              // Non-fatal: the rule is saved either way and the nightly pass
              // reconciles. Surfacing it as a failure would be a lie.
              console.warn("[FLEET-HEALTH] default-rule recompute failed:", evalError);
            }
            invalidateFleetHealth(qc);
          });
      }

      return data as MaintenanceRule;
    },
    onSuccess: () => done("Schedule saved"),
    onError: fail("Failed to save schedule"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!tenant?.id) throw new Error("No tenant context available");
      const { error } = await supabase
        .from("vehicle_maintenance_rules")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenant.id);
      if (error) throw error;
    },
    onSuccess: () => done("Schedule removed"),
    onError: fail("Failed to remove schedule"),
  });

  /**
   * One-tap starting point. Intervals mirror the manufacturer defaults most
   * operators use; service_type strings MUST match add-service-record-dialog.tsx
   * exactly or completed work will never match back to its rule.
   */
  const seedDefaults = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const defaults = [
        { name: "Oil Change", service_type: "Oil Change", interval_miles: 5000, interval_months: 6, lead_miles: 500, lead_days: 14, sort_order: 1 },
        { name: "Tyre Rotation", service_type: "Tire Rotation", interval_miles: 7500, interval_months: null, lead_miles: 750, lead_days: 14, sort_order: 2 },
        { name: "Brake Inspection", service_type: "Brake Service", interval_miles: 10000, interval_months: 12, lead_miles: 1000, lead_days: 21, sort_order: 3 },
        { name: "Air Filter", service_type: "Air Filter", interval_miles: 15000, interval_months: null, lead_miles: 1000, lead_days: 21, sort_order: 4 },
        { name: "Full Service", service_type: "Full Service", interval_miles: 30000, interval_months: 12, lead_miles: 2000, lead_days: 30, sort_order: 5 },
      ];

      const { data: existing } = await supabase
        .from("vehicle_maintenance_rules")
        .select("service_type")
        .eq("tenant_id", tenant.id)
        .is("vehicle_id", null);

      const have = new Set((existing ?? []).map((r: any) => r.service_type));
      const toInsert = defaults
        .filter((d) => !have.has(d.service_type))
        .map((d) => ({ ...d, tenant_id: tenant.id, vehicle_id: null }));

      if (toInsert.length === 0) return 0;

      const { error } = await supabase.from("vehicle_maintenance_rules").insert(toInsert);
      if (error) throw error;
      return toInsert.length;
    },
    onSuccess: (n) => {
      invalidateFleetHealth(qc);
      toast({
        title: n ? "Default schedules added" : "Already set up",
        description: n
          ? `${n} schedule${n === 1 ? "" : "s"} created. Adjust or remove any that do not apply.`
          : "Your default schedules are already in place.",
      });
    },
    onError: fail("Failed to create default schedules"),
  });

  return {
    upsertRule: upsert.mutate,
    upsertRuleAsync: upsert.mutateAsync,
    removeRule: remove.mutate,
    seedDefaults: seedDefaults.mutate,
    isSaving: upsert.isPending,
    isRemoving: remove.isPending,
    isSeeding: seedDefaults.isPending,
  };
}
