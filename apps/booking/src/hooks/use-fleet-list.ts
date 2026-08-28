"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { canRevealRegistration } from "@/lib/vehicle-identity";

export interface FleetVehicle {
  id: string;
  reg: string;
  make: string | null;
  model: string | null;
  status: string | null;
  is_currently_booked: boolean;
}

/**
 * Returns the entire active fleet for the current tenant — including currently
 * booked vehicles — so the enquiry modal can offer the full list. Each vehicle
 * is annotated with `is_currently_booked` for a UI hint only.
 */
export function useFleetList() {
  const { tenant } = useTenant();
  const [data, setData] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!tenant?.id) {
      setData([]);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: vehicles, error: vErr } = await supabaseUntyped
          .from("vehicles")
          // reg only when this tenant permits it — this hook feeds the public
          // /apply and enquiry vehicle pickers, so a hardcoded reg published
          // every plate regardless of the setting.
          .select(canRevealRegistration(tenant) ? "id, reg, make, model, status" : "id, make, model, status")
          .eq("tenant_id", tenant.id)
          .in("status", ["Available", "Rented"])
          // A paused vehicle is off the road. This picker still reads no
          // blocked_dates, so a date-scoped block does not remove a car here —
          // only Pause and the all-durations-off check below do.
          .eq("is_paused", false)
          // A car with every hire duration switched off is off sale — /fleet
          // already excludes it (fleet/page.tsx). This picker previously did
          // not, so an operator who switched all three off still saw the car
          // offered in their own enquiry form. Partial combinations are
          // untouched: a monthly-only car is still legitimately offerable.
          .or("available_daily.eq.true,available_weekly.eq.true,available_monthly.eq.true")
          .order("make", { ascending: true })
          .order("model", { ascending: true });
        if (vErr) throw vErr;

        const today = new Date().toISOString().slice(0, 10);
        const { data: liveRentals } = await supabase
          .from("rentals")
          .select("vehicle_id")
          .eq("tenant_id", tenant.id)
          .in("status", ["Active", "Pending", "Confirmed"])
          .lte("start_date", today)
          .gte("end_date", today);

        const bookedIds = new Set(
          (liveRentals || [])
            .map((r: { vehicle_id: string | null }) => r.vehicle_id)
            .filter((id): id is string => Boolean(id))
        );

        if (!cancelled) {
          setData(
            (vehicles || []).map((v) => ({
              ...v,
              is_currently_booked: bookedIds.has(v.id) || v.status === "Rented",
            }))
          );
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load fleet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [tenant?.id]);

  return { data, loading, error };
}
