import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface BookedRental {
  id: string;
  rental_number: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
}

export interface BlockedDateRange {
  id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
}

export type DateOccupancyType = "active" | "pending" | "upcoming" | "blocked";

export interface DateOccupancy {
  date: Date;
  type: DateOccupancyType;
  label: string;
}

/**
 * Fetches booked date ranges for a specific vehicle (Pending/Active/Upcoming
 * rentals + blocked dates). Mirrors apps/portal/src/hooks/use-vehicle-booked-dates.ts
 * so the customer-portal extension calendar can reuse the same occupancy shape.
 */
export const useVehicleBookedDates = (vehicleId: string | undefined, excludeRentalId?: string) => {
  const { tenant } = useTenant();

  const { data: bookedRentals = [], isLoading: rentalsLoading } = useQuery({
    queryKey: ["vehicle-booked-dates", tenant?.id, vehicleId, excludeRentalId],
    queryFn: async () => {
      if (!tenant?.id || !vehicleId) return [];

      // PAYG rentals have NULL end_date (open-ended). They MUST appear on the
      // occupancy calendar — otherwise customers see an available date picker
      // for dates that will fail at checkout (the DB trigger blocks the
      // overlap). We render them as booked from start_date forward; the loops
      // below cap the rendered range at +365 days for calendar performance.
      const { data, error } = await (supabase as any)
        .from("rentals")
        .select("id, rental_number, start_date, end_date, status")
        .eq("vehicle_id", vehicleId)
        .eq("tenant_id", tenant.id)
        .in("status", ["Pending", "Active", "Upcoming", "Confirmed", "Started"]);

      if (error) throw error;
      let results = (data || []) as BookedRental[];
      if (excludeRentalId) {
        results = results.filter((r) => r.id !== excludeRentalId);
      }
      return results;
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  const { data: blockedDates = [], isLoading: blockedLoading } = useQuery({
    queryKey: ["vehicle-blocked-dates-calendar", tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant?.id || !vehicleId) return [];

      const today = new Date().toISOString().split("T")[0];

      const { data, error } = await (supabase as any)
        .from("blocked_dates")
        .select("id, start_date, end_date, reason")
        .eq("tenant_id", tenant.id)
        .gte("end_date", today)
        .or(`vehicle_id.eq.${vehicleId},vehicle_id.is.null`);

      if (error) throw error;
      return (data || []) as BlockedDateRange[];
    },
    enabled: !!tenant?.id && !!vehicleId,
  });

  const getOccupancyType = (status: string): DateOccupancyType => {
    const s = status.toLowerCase();
    if (s === "active" || s === "started") return "active";
    if (s === "pending") return "pending";
    return "upcoming";
  };

  // PAYG rentals have NULL end_date. Cap the rendered range at start + 365
  // days so the calendar shows the vehicle as booked far enough out to be
  // unmistakable, without trying to paint every date until the year 9999.
  const PAYG_HORIZON_DAYS = 365;

  const resolveEndDate = (rental: BookedRental): { end: Date; isOpenEnded: boolean } => {
    if (rental.end_date) {
      const [ey, em, ed] = rental.end_date.split("-").map(Number);
      return { end: new Date(ey, em - 1, ed), isOpenEnded: false };
    }
    const [sy, sm, sd] = rental.start_date.split("-").map(Number);
    const horizon = new Date(sy, sm - 1, sd);
    horizon.setDate(horizon.getDate() + PAYG_HORIZON_DAYS);
    return { end: horizon, isOpenEnded: true };
  };

  const getOccupancyMap = (): Map<string, DateOccupancy[]> => {
    const map = new Map<string, DateOccupancy[]>();

    const formatDateLabel = (start: string, end: string | null, isOpenEnded: boolean) => {
      const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const s = new Date(start + "T00:00:00");
      if (isOpenEnded || !end) {
        return `${fmt(s)} - ongoing`;
      }
      const e = new Date(end + "T00:00:00");
      return `${fmt(s)} - ${fmt(e)}`;
    };

    for (const rental of bookedRentals) {
      const type = getOccupancyType(rental.status);
      const ref = rental.rental_number || rental.id.substring(0, 8).toUpperCase();
      const typeLabel =
        type === "active" ? "Active" : type === "pending" ? "Pending" : "Upcoming";
      const { end, isOpenEnded } = resolveEndDate(rental);
      const dateRange = formatDateLabel(rental.start_date, rental.end_date, isOpenEnded);
      const label = `${typeLabel}: ${ref} (${dateRange})`;

      const [sy, sm, sd] = rental.start_date.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);

      const current = new Date(start);
      while (current <= end) {
        const key = current.toDateString();
        const entry: DateOccupancy = {
          date: new Date(current),
          type,
          label,
        };
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(entry);
        current.setDate(current.getDate() + 1);
      }
    }

    for (const block of blockedDates) {
      const reason = block.reason || "Blocked";
      const [sy, sm, sd] = block.start_date.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);
      const [ey, em, ed] = block.end_date.split("-").map(Number);
      const end = new Date(ey, em - 1, ed);

      const current = new Date(start);
      while (current <= end) {
        const key = current.toDateString();
        const entry: DateOccupancy = {
          date: new Date(current),
          type: "blocked",
          label: `Blocked: ${reason}`,
        };
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(entry);
        current.setDate(current.getDate() + 1);
      }
    }

    return map;
  };

  const getOccupancyModifiers = (): Record<DateOccupancyType, Date[]> => {
    const mods: Record<DateOccupancyType, Date[]> = {
      active: [],
      pending: [],
      upcoming: [],
      blocked: [],
    };

    for (const rental of bookedRentals) {
      const type = getOccupancyType(rental.status);
      const [sy, sm, sd] = rental.start_date.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);
      const { end } = resolveEndDate(rental);
      const current = new Date(start);
      while (current <= end) {
        mods[type].push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    }

    for (const block of blockedDates) {
      const [sy, sm, sd] = block.start_date.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);
      const [ey, em, ed] = block.end_date.split("-").map(Number);
      const end = new Date(ey, em - 1, ed);
      const current = new Date(start);
      while (current <= end) {
        mods.blocked.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    }

    return mods;
  };

  return {
    bookedRentals,
    blockedDates,
    occupancyMap: getOccupancyMap(),
    occupancyModifiers: getOccupancyModifiers(),
    isLoading: rentalsLoading || blockedLoading,
  };
};
