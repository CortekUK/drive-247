import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { useToast } from "@/hooks/use-toast";
import { STORED_UNIT, toStoredMiles } from "@/lib/fleet-health-units";
import { invalidateFleetHealth } from "@/hooks/use-fleet-health";
import type { ParsedOdometerRow } from "@/lib/fleet-health-csv";
import type { DistanceUnit } from "@/lib/format-utils";

/**
 * Every vehicle the tenant owns, as {id, reg} — the match table the CSV parser
 * needs.
 *
 * Deliberately not sourced from useFleetHealth: that reads vehicle_health_cache,
 * which only holds vehicles that have been evaluated. A tenant importing for the
 * first time is exactly the tenant whose cache may be incomplete, and a vehicle
 * missing from the match table would be reported to the operator as "no vehicle
 * with this registration" — sending them to fix a spreadsheet that is correct.
 */
export function useMatchableVehicles() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["fleet-health-matchable-vehicles", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg")
        .eq("tenant_id", tenant!.id)
        .or("is_disposed.is.null,is_disposed.eq.false");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; reg: string | null }>;
    },
  });
}

export interface ImportOutcome {
  readingsInserted: number;
  servicesInserted: number;
  failed: Array<{ reg: string; reason: string }>;
}

/**
 * Apply a parsed Fleet Health CSV.
 *
 * Two writes per row at most, both through the same tables the single-vehicle
 * controls use:
 *
 *  - `vehicle_odometer_readings` — converted with `toStoredMiles` and stamped
 *    with an explicit unit. Leaving the unit to its column default is the bug
 *    that made a kilometre reading indistinguishable from a mile one for four
 *    months, so a bulk path is the last place to reintroduce it.
 *  - `service_records` — which is deliberately NOT a direct write to
 *    `vehicles.last_service_*`. Those columns are derived by
 *    update_vehicle_last_service from the newest record, so writing them here
 *    would be undone by the next trigger. Going through service_records also
 *    means the P&L posting and the interval baseline update themselves, which
 *    is the spec's "one settlement path".
 *
 * Rows are inserted in chunks and a failing chunk is reported rather than
 * thrown: an operator importing 22 vehicles should not lose 21 good rows to one
 * bad one, and they need to know which registration to fix.
 */
export function useFleetHealthCsvImport() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const { toast } = useToast();

  return useMutation<ImportOutcome, Error, ParsedOdometerRow[]>({
    mutationFn: async (rows) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const unit: DistanceUnit = (tenant.distance_unit as DistanceUnit) ?? "miles";
      const observedAt = new Date().toISOString();
      const failed: ImportOutcome["failed"] = [];

      const readingRows = rows
        .filter((r) => r.reading !== undefined)
        .map((r) => ({
          tenant_id: tenant.id,
          vehicle_id: r.vehicleId,
          reading: toStoredMiles(r.reading as number, unit),
          unit: STORED_UNIT,
          observed_at: observedAt,
          source: "manual" as const,
          note: "Imported from CSV",
          is_suspect: false,
          recorded_by: appUser?.id ?? null,
        }));

      // A service record needs a date; the parser guarantees a mileage never
      // arrives without one, so `service_date` here is always present.
      const serviceRows = rows
        .filter((r) => r.lastServiceDate !== undefined)
        .map((r) => ({
          tenant_id: tenant.id,
          vehicle_id: r.vehicleId,
          service_date: r.lastServiceDate as string,
          mileage:
            r.lastServiceMileage !== undefined
              ? toStoredMiles(r.lastServiceMileage, unit)
              : null,
          cost: 0,
          description: "Imported from CSV during Fleet Health setup",
        }));

      const CHUNK = 100;

      const insertChunks = async (
        table: "vehicle_odometer_readings" | "service_records",
        payload: any[],
        label: (row: any) => string,
      ): Promise<number> => {
        let ok = 0;
        for (let i = 0; i < payload.length; i += CHUNK) {
          const slice = payload.slice(i, i + CHUNK);
          const { error } = await (supabase.from(table) as any).insert(slice);
          if (error) {
            for (const row of slice) {
              failed.push({ reg: label(row), reason: error.message });
            }
          } else {
            ok += slice.length;
          }
        }
        return ok;
      };

      // Registration is not on the payload, so map vehicle_id back for messages.
      const regFor = new Map(rows.map((r) => [r.vehicleId, r.reg]));
      const label = (row: any) => regFor.get(row.vehicle_id) ?? row.vehicle_id;

      const readingsInserted = await insertChunks("vehicle_odometer_readings", readingRows, label);
      const servicesInserted = await insertChunks("service_records", serviceRows, label);

      return { readingsInserted, servicesInserted, failed };
    },
    onSuccess: (result) => {
      invalidateFleetHealth(qc);
      const parts: string[] = [];
      if (result.readingsInserted) parts.push(`${result.readingsInserted} odometer reading${result.readingsInserted === 1 ? "" : "s"}`);
      if (result.servicesInserted) parts.push(`${result.servicesInserted} service record${result.servicesInserted === 1 ? "" : "s"}`);

      toast({
        title: result.failed.length ? "Imported with problems" : "Import complete",
        description: parts.length
          ? `${parts.join(" and ")} imported.${result.failed.length ? ` ${result.failed.length} row(s) failed.` : ""}`
          : "Nothing was imported.",
        variant: result.failed.length ? "destructive" : undefined,
      });
    },
    onError: (e) =>
      toast({
        title: "Import failed",
        description: e.message ?? "Could not import the file",
        variant: "destructive",
      }),
  });
}
