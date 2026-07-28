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
  label: string; // e.g. "Active: R-ABC123 (Apr 1 - Apr 10)"
}

/**
 * Fetches booked date ranges for a specific vehicle (Pending/Active/Upcoming rentals + blocked dates)
 * Returns typed occupancy data for calendar highlighting.
 */
export const useVehicleBookedDates = (vehicleId: string | undefined, excludeRentalId?: string) => {
  const { tenant } = useTenant();

  const { data: bookedRentals = [], isLoading: rentalsLoading } = useQuery({
    queryKey: ["vehicle-booked-dates", tenant?.id, vehicleId, excludeRentalId],
    queryFn: async () => {
      if (!tenant?.id || !vehicleId) return [];

      const { data, error } = await (supabase as any)
        .from("rentals")
        .select("id, rental_number, start_date, end_date, status")
        .eq("vehicle_id", vehicleId)
        .eq("tenant_id", tenant.id)
        .in("status", ["Pending", "Active", "Upcoming", "Confirmed", "Started"]);
      // NOTE: deliberately NO `.not("end_date","is",null)`. Open-ended rentals
      // (PAYG / rolling monthly) have a NULL end_date, and filtering them out
      // here made an occupied vehicle render as completely free on every date —
      // the operator-reported bug. The booking app already handles these via
      // resolveEndDate(); this hook now matches it.

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

      // Fetch both vehicle-specific and global blocked dates
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

  // Classify rental status into occupancy type
  const getOccupancyType = (status: string): DateOccupancyType => {
    const s = status.toLowerCase();
    if (s === "active" || s === "started") return "active";
    if (s === "pending") return "pending";
    return "upcoming"; // Confirmed, Upcoming
  };

  // PAYG rentals have NULL end_date. Cap the rendered range at start + 365
  // days so the calendar shows the vehicle as booked far enough out to be
  // unmistakable, without trying to paint every date until the year 9999.
  const PAYG_HORIZON_DAYS = 365;

  /**
   * The date a rental stops occupying the vehicle, and whether that end is real
   * or synthetic. Two cases produce a synthetic (open-ended) end:
   *   1. end_date IS NULL — a PAYG / rolling rental with no scheduled return.
   *   2. an Active rental whose end_date is already in the past — the car is
   *      physically still out (a paused auto-extend, or simply not closed yet).
   * Both must keep painting the calendar forward, or the operator sees a car as
   * free while someone is driving it. Ported from the booking app, which fixed
   * this first; keep the two in step.
   */
  const resolveEndDate = (
    rental: BookedRental,
  ): { end: Date; isOpenEnded: boolean } => {
    if (rental.end_date) {
      const [ey, em, ed] = rental.end_date.split("-").map(Number);
      const end = new Date(ey, em - 1, ed);
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      if (getOccupancyType(rental.status) === "active" && end < t) {
        const horizon = new Date(t);
        horizon.setDate(horizon.getDate() + PAYG_HORIZON_DAYS);
        return { end: horizon, isOpenEnded: true };
      }
      return { end, isOpenEnded: false };
    }
    const [sy, sm, sd] = rental.start_date.split("-").map(Number);
    const horizon = new Date(sy, sm - 1, sd);
    horizon.setDate(horizon.getDate() + PAYG_HORIZON_DAYS);
    return { end: horizon, isOpenEnded: true };
  };

  // Build occupancy map: dateString -> DateOccupancy[]
  const getOccupancyMap = (): Map<string, DateOccupancy[]> => {
    const map = new Map<string, DateOccupancy[]>();

    const formatDateLabel = (
      start: string,
      end: string | null,
      isOpenEnded: boolean,
    ) => {
      const s = new Date(start + "T00:00:00");
      const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      // An open-ended rental has no meaningful end to print — saying
      // "Jan 1 - Jan 1 2027" would imply a return date that does not exist.
      if (isOpenEnded || !end) return `${fmt(s)} - ongoing`;
      return `${fmt(s)} - ${fmt(new Date(end + "T00:00:00"))}`;
    };

    // Add rental occupancies
    for (const rental of bookedRentals) {
      const type = getOccupancyType(rental.status);
      const ref = rental.rental_number || rental.id.substring(0, 8).toUpperCase();
      const typeLabel =
        type === "active"
          ? "Active"
          : type === "pending"
          ? "Pending"
          : "Upcoming";
      const { end, isOpenEnded } = resolveEndDate(rental);
      const dateRange = formatDateLabel(
        rental.start_date,
        rental.end_date,
        isOpenEnded,
      );
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

    // Add blocked date occupancies
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

  // Build modifier arrays: type -> Date[] for react-day-picker modifiers
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

  // Legacy: flat array of all booked dates for disabling
  const getBookedDatesArray = (): Date[] => {
    if (!bookedRentals.length) return [];
    const dates: Date[] = [];
    for (const rental of bookedRentals) {
      const [sy, sm, sd] = rental.start_date.split("-").map(Number);
      const start = new Date(sy, sm - 1, sd);
      const { end } = resolveEndDate(rental);
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
    blockedDates,
    bookedDatesArray: getBookedDatesArray(),
    occupancyMap: getOccupancyMap(),
    occupancyModifiers: getOccupancyModifiers(),
    isLoading: rentalsLoading || blockedLoading,
  };
};
