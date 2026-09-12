"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { getRentalStatus } from "@/lib/rental-utils";
import { EMPTY_TIMELINE, type TimelineData, type TimelineScope, type TimelineVehicle } from "./model";

const sb = supabase as any;
const numeric = (v: unknown): number | null => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const vehicle = (v: any, hideRegistration: boolean): TimelineVehicle => ({ id: v?.id ?? "", reg: hideRegistration ? "" : v?.reg ?? "", make: v?.make ?? "", model: v?.model ?? "", photoUrl: v?.photo_url ?? null, daily: numeric(v?.daily_rent), weekly: numeric(v?.weekly_rent), monthly: numeric(v?.monthly_rent) });
const VEHICLE_COLUMNS = "id,reg,make,model,photo_url,daily_rent,weekly_rent,monthly_rent";

// PostgREST defaults to 1,000 rows. A busy fleet must not silently lose bookings.
async function everyPage(query: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query().range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export function useTimelineData(scope: TimelineScope, start: string, end: string, enabled = true) {
  const { tenant } = useTenant();
  const hideRegistration = (tenant as { hide_vehicle_registration?: boolean } | null)?.hide_vehicle_registration === true;
  return useQuery<TimelineData>({
    queryKey: ["timeline-v2", tenant?.id, scope.kind, "id" in scope ? scope.id : null, start, end, hideRegistration],
    enabled: enabled && !!tenant?.id && (scope.kind === "all" || !!scope.id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context");
      const rentalQuery = () => {
        let q = sb.from("rentals")
          .select(`id,rental_number,start_date,end_date,original_end_date,pickup_time,return_time,status,payment_mode,is_pay_as_you_go,auto_extend_enabled,auto_extend_status,customers!rentals_customer_id_fkey(id,name),vehicles!rentals_vehicle_id_fkey(${VEHICLE_COLUMNS})`)
          .eq("tenant_id", tenant.id).order("id");
        if (scope.kind === "all") q = q.lte("start_date", end).or(`end_date.gte.${start},end_date.is.null`);
        else q = q.eq(scope.kind === "rental" ? "id" : `${scope.kind}_id`, scope.id);
        return q;
      };
      const [rentals, vehicles, blocks, extensions] = await Promise.all([
        everyPage(rentalQuery),
        scope.kind === "customer" || scope.kind === "rental" ? Promise.resolve([]) : everyPage(() => {
          let q = sb.from("vehicles").select(VEHICLE_COLUMNS).eq("tenant_id", tenant.id).order("id");
          return scope.kind === "vehicle" ? q.eq("id", scope.id) : q;
        }),
        scope.kind === "customer" || scope.kind === "rental" ? Promise.resolve([]) : everyPage(() => {
          let q = sb.from("blocked_dates").select("id,vehicle_id,start_date,end_date,reason").eq("tenant_id", tenant.id).lte("start_date", end).gte("end_date", start).order("id");
          return scope.kind === "vehicle" ? q.or(`vehicle_id.eq.${scope.id},vehicle_id.is.null`) : q;
        }),
        scope.kind === "rental" ? everyPage(() => sb.from("rental_extensions").select("id,sequence_number,previous_end_date,new_end_date,status,total_amount").eq("tenant_id", tenant.id).eq("rental_id", scope.id).order("sequence_number")) : Promise.resolve([]),
      ]);
      // This table has no tenant_id. The inner vehicle join enforces ownership.
      const prices = scope.kind === "vehicle" && vehicles.length ? await everyPage(() => sb.from("vehicle_daily_prices")
        .select("id,date,price,vehicles!inner(tenant_id)").eq("vehicle_id", scope.id).eq("vehicles.tenant_id", tenant.id)
        .gte("date", start).lte("date", end).order("id")) : [];
      return {
        ...EMPTY_TIMELINE,
        bookings: rentals.map(r => ({
          id: r.id, rentalId: r.id, number: r.rental_number || "Unnumbered rental", start: r.start_date, end: r.end_date,
          pickupTime: r.pickup_time, returnTime: r.return_time, originalEnd: r.original_end_date,
          paymentMode: r.payment_mode, isPayAsYouGo: r.is_pay_as_you_go === true, autoExtendEnabled: r.auto_extend_enabled === true,
          status: getRentalStatus(r.start_date, r.end_date, r.status, { returnTime: r.return_time, autoExtendEnabled: r.auto_extend_enabled, autoExtendStatus: r.auto_extend_status }),
          customer: { id: r.customers?.id ?? "", name: r.customers?.name || "Customer unavailable" }, vehicle: vehicle(r.vehicles, hideRegistration),
        })),
        vehicles: vehicles.map(v => vehicle(v, hideRegistration)),
        blocks: blocks.map(b => ({ id: b.id, vehicleId: b.vehicle_id, start: b.start_date, end: b.end_date, reason: b.reason })),
        extensions,
        prices: Object.fromEntries(prices.filter(p => numeric(p.price) != null).map(p => [p.date, Number(p.price)])),
      };
    },
  });
}
