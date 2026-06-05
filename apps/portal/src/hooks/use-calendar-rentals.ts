import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { getRentalStatus } from "@/lib/rental-utils";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import {
  CalendarRental,
  CalendarBlock,
  VehicleTimelineData,
  groupTimelineByVehicle,
} from "@/lib/calendar-utils";

export const useCalendarRentals = (
  rangeStart: Date,
  rangeEnd: Date,
  filters: RentalFilters = {}
) => {
  const { tenant } = useTenant();
  const {
    search = "",
    status = "all",
    paymentMode = "all",
  } = filters;

  const startStr = rangeStart.toISOString().split("T")[0];
  const endStr = rangeEnd.toISOString().split("T")[0];

  return useQuery<{
    rentals: CalendarRental[];
    grouped: VehicleTimelineData[];
  }>({
    queryKey: [
      "calendar-rentals",
      tenant?.id,
      startStr,
      endStr,
      search,
      status,
      paymentMode,
    ],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      // Fetch rentals that overlap with the visible date range
      // A rental overlaps if: start_date <= rangeEnd AND (end_date >= rangeStart OR end_date IS NULL)
      let query = supabase
        .from("rentals")
        .select(
          `
          id,
          rental_number,
          start_date,
          end_date,
          monthly_amount,
          status,
          payment_mode,
          customers!rentals_customer_id_fkey(id, name),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model, vehicle_photos(photo_url))
        `
        )
        .eq("tenant_id", tenant.id)
        .lte("start_date", endStr)
        .or(`end_date.gte.${startStr},end_date.is.null`) as any;

      // Manual blocks (blocked_dates) overlapping the visible range — operator-
      // marked unavailable windows (e.g. car rented out on Turo). A block overlaps
      // when start_date <= rangeEnd AND end_date >= rangeStart.
      const blocksQuery = supabase
        .from("blocked_dates")
        .select("id, vehicle_id, start_date, end_date, reason")
        .eq("tenant_id", tenant.id)
        .lte("start_date", endStr)
        .gte("end_date", startStr) as any;

      // Lightweight vehicle lookup so block-only vehicles (no rentals in range)
      // still get a row with reg/make/model/photo.
      const vehiclesQuery = supabase
        .from("vehicles")
        .select("id, reg, make, model, vehicle_photos(photo_url)")
        .eq("tenant_id", tenant.id) as any;

      const [
        { data: rentalsData, error },
        { data: blocksData, error: blocksError },
        { data: vehiclesData, error: vehiclesError },
      ] = await Promise.all([query, blocksQuery, vehiclesQuery]);

      if (error) throw error;
      if (blocksError) throw blocksError;
      if (vehiclesError) throw vehiclesError;

      const vehicleLookup = new Map<string, VehicleTimelineData["vehicle"]>();
      for (const v of (vehiclesData || []) as any[]) {
        vehicleLookup.set(v.id, {
          id: v.id,
          reg: v.reg,
          make: v.make,
          model: v.model,
          photo_url: v.vehicle_photos?.[0]?.photo_url || undefined,
        });
      }

      const calendarBlocks: CalendarBlock[] = ((blocksData || []) as any[]).map(
        (b) => ({
          id: b.id,
          vehicle_id: b.vehicle_id,
          start_date: b.start_date,
          end_date: b.end_date,
          reason: b.reason,
          source: "manual" as const,
        })
      );

      const calendarRentals: CalendarRental[] = (rentalsData || [])
        .filter((r: any) => r.customers && r.vehicles)
        .map((rental: any) => ({
          id: rental.id,
          rental_number: rental.rental_number,
          start_date: rental.start_date,
          end_date: rental.end_date,
          monthly_amount: rental.monthly_amount,
          status: rental.status,
          computed_status: getRentalStatus(
            rental.start_date,
            rental.end_date,
            rental.status
          ),
          customer: rental.customers as any,
          vehicle: {
            ...(rental.vehicles as any),
            photo_url: rental.vehicles?.vehicle_photos?.[0]?.photo_url || undefined,
          },
        }))
        .filter((rental: CalendarRental) => {
          if (paymentMode !== "all" && (rental as any).payment_mode !== paymentMode)
            return false;
          if (status !== "all") {
            if (rental.computed_status.toLowerCase() !== status.toLowerCase())
              return false;
          }
          if (search) {
            const s = search.toLowerCase();
            const matchesRental = rental.rental_number
              ?.toLowerCase()
              .includes(s);
            const matchesCustomer = rental.customer?.name
              ?.toLowerCase()
              .includes(s);
            const matchesVehicle = rental.vehicle?.reg
              ?.toLowerCase()
              .includes(s);
            if (!matchesRental && !matchesCustomer && !matchesVehicle)
              return false;
          }
          return true;
        });

      return {
        rentals: calendarRentals,
        grouped: groupTimelineByVehicle(
          calendarRentals,
          calendarBlocks,
          vehicleLookup
        ),
      };
    },
    enabled: !!tenant,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};
