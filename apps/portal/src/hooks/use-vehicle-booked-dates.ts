import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface BookedRental {
  id: string;
  start_date: string;
  end_date: string | null;
  status: string;
}

/**
 * Fetches booked date ranges for a specific vehicle (Pending/Active rentals)
 * and returns an array of dates to disable in the calendar.
 */
export const useVehicleBookedDates = (vehicleId: string | undefined) => {
  const { tenant } = useTenant();

  const { data: bookedRentals = [], isLoading } = useQuery({
    queryKey: ["vehicle-booked-dates", tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant?.id || !vehicleId) return [];

      const { data, error } = await (supabase as any)
        .from("rentals")
        .select("id, start_date, end_date, status")
        .eq("vehicle_id", vehicleId)
        .eq("tenant_id", tenant.id)
        .in("status", ["Pending", "Active"])
        .not("end_date", "is", null);

      if (error) throw error;
      return (data || []) as BookedRental[];
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  // Build array of disabled dates from booked rentals (full range + 1 buffer day)
  const getBookedDatesArray = (): Date[] => {
    if (!bookedRentals.length) return [];

    const dates: Date[] = [];

    for (const rental of bookedRentals) {
      const [sy, sm, sd] = rental.start_date.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);

      if (!rental.end_date) continue;
      const [ey, em, ed] = rental.end_date.split("-").map(Number);
      const end = new Date(ey, em - 1, ed);

      const current = new Date(start);
      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    }

    return dates;
  };

  return {
    bookedRentals,
    bookedDatesArray: getBookedDatesArray(),
    isLoading,
  };
};
