import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { format, addDays, startOfWeek } from "date-fns";

export interface TodaySchedule {
  pickupsToday: number;
  returnsToday: number;
  activeCount: number;
  weekDensity: { date: string; count: number }[];
}

export const useCalendarToday = () => {
  const { tenant } = useTenant();
  const today = format(new Date(), "yyyy-MM-dd");

  return useQuery<TodaySchedule>({
    queryKey: ["calendar-today", tenant?.id, today],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      // Fetch pickups today (start_date = today)
      const { count: pickupsToday } = await supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("start_date", today)
        .neq("status", "Cancelled");

      // Fetch returns today (end_date = today)
      const { count: returnsToday } = await supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("end_date", today)
        .neq("status", "Cancelled");

      // Active rentals (start_date <= today AND (end_date >= today OR end_date IS NULL) AND status not cancelled/closed)
      const { count: activeCount } = await supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .lte("start_date", today)
        .or(`end_date.gte.${today},end_date.is.null`)
        .not("status", "in", '("Cancelled","Closed")');

      // Weekly density: count overlapping rentals per day for the current week
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekDays = Array.from({ length: 7 }, (_, i) =>
        format(addDays(weekStart, i), "yyyy-MM-dd")
      );

      // Get all rentals that overlap with this week
      const { data: weekRentals } = await supabase
        .from("rentals")
        .select("start_date, end_date")
        .eq("tenant_id", tenant.id)
        .lte("start_date", weekDays[6])
        .or(`end_date.gte.${weekDays[0]},end_date.is.null`)
        .neq("status", "Cancelled");

      const weekDensity = weekDays.map((day) => {
        const count = (weekRentals || []).filter((r) => {
          const start = r.start_date;
          const end = r.end_date || "9999-12-31";
          return start <= day && end >= day;
        }).length;
        return { date: day, count };
      });

      return {
        pickupsToday: pickupsToday || 0,
        returnsToday: returnsToday || 0,
        activeCount: activeCount || 0,
        weekDensity,
      };
    },
    enabled: !!tenant,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
};
