import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { getRentalStatus } from "@/lib/rental-utils";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import {
  CalendarRental,
  VehicleTimelineData,
  groupRentalsByVehicle,
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

      const { data: rentalsData, error } = await query;
      if (error) throw error;

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
        grouped: groupRentalsByVehicle(calendarRentals),
      };
    },
    enabled: !!tenant,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
};
