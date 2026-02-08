import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { VehicleTimelineData } from "@/lib/calendar-utils";
import { differenceInDays, parseISO, format } from "date-fns";

export interface RentalInsight {
  type: "gap" | "busy" | "idle" | "recommendation";
  title: string;
  description: string;
  severity: "info" | "warning" | "success";
  vehicleRefs?: string[];
}

export interface InsightsResponse {
  insights: RentalInsight[];
  summary: string;
}

interface RentalSummary {
  rentalNumber: string;
  customer: string;
  vehicle: string;
  startDate: string;
  endDate: string | null;
  status: string;
  monthlyAmount: number;
  durationDays: number;
}

function preparePayload(
  grouped: VehicleTimelineData[],
  rangeStart: Date,
  rangeEnd: Date
) {
  const rentals: RentalSummary[] = [];
  const statusCounts: Record<string, number> = {};
  const dayBookingCounts: Record<string, number> = {};
  let totalRevenue = 0;

  for (const v of grouped) {
    for (const r of v.rentals) {
      const rStart = parseISO(r.start_date);
      const rEnd = r.end_date ? parseISO(r.end_date) : rangeEnd;
      const clampedStart = rStart < rangeStart ? rangeStart : rStart;
      const clampedEnd = rEnd > rangeEnd ? rangeEnd : rEnd;
      const durationDays = Math.max(0, differenceInDays(clampedEnd, clampedStart) + 1);

      rentals.push({
        rentalNumber: r.rental_number,
        customer: r.customer.name,
        vehicle: `${v.vehicle.reg} (${v.vehicle.make} ${v.vehicle.model})`,
        startDate: r.start_date,
        endDate: r.end_date,
        status: r.computed_status,
        monthlyAmount: r.monthly_amount,
        durationDays,
      });

      statusCounts[r.computed_status] = (statusCounts[r.computed_status] || 0) + 1;
      totalRevenue += r.monthly_amount;

      // Count bookings per day for density analysis
      const cur = new Date(clampedStart);
      while (cur <= clampedEnd) {
        const key = format(cur, "yyyy-MM-dd");
        dayBookingCounts[key] = (dayBookingCounts[key] || 0) + 1;
        cur.setDate(cur.getDate() + 1);
      }
    }
  }

  // Find peak and quiet days
  const dayCounts = Object.entries(dayBookingCounts).sort(([, a], [, b]) => b - a);
  const peakDays = dayCounts.slice(0, 3).map(([date, count]) => `${date}: ${count} bookings`);
  const quietDays = dayCounts.filter(([, count]) => count <= 1).length;

  // Upcoming starts and ends in range
  const upcomingStarts = rentals
    .filter((r) => r.status === "Upcoming")
    .map((r) => `${r.rentalNumber} (${r.customer}) starts ${r.startDate} — ${r.vehicle}`);

  const endingSoon = rentals
    .filter((r) => r.endDate && r.status === "Active")
    .sort((a, b) => (a.endDate! > b.endDate! ? 1 : -1))
    .slice(0, 5)
    .map((r) => `${r.rentalNumber} (${r.customer}) ends ${r.endDate} — ${r.vehicle}`);

  return {
    dateRange: {
      from: rangeStart.toISOString().split("T")[0],
      to: rangeEnd.toISOString().split("T")[0],
    },
    totalRentals: rentals.length,
    totalVehicles: grouped.length,
    totalRevenue,
    statusBreakdown: statusCounts,
    peakDays,
    quietDaysCount: quietDays,
    upcomingStarts: upcomingStarts.slice(0, 8),
    endingSoon,
    rentals: rentals.slice(0, 30), // cap to stay within token limits
  };
}

async function fetchInsights(
  grouped: VehicleTimelineData[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<InsightsResponse> {
  const payload = preparePayload(grouped, rangeStart, rangeEnd);

  const { data, error } = await supabase.functions.invoke(
    "rental-insights",
    { body: payload }
  );

  if (error) throw error;
  return data as InsightsResponse;
}

/**
 * Cached query — calls OpenAI once per tenant, caches for 10 minutes.
 * Shared across dashboard and calendar page.
 */
export const useRentalInsights = (
  grouped: VehicleTimelineData[],
  enabled: boolean = true
) => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const query = useQuery<InsightsResponse>({
    queryKey: ["rental-insights", tenant?.id],
    queryFn: () => {
      // Use today as the range for insights — always a daily snapshot
      const now = new Date();
      const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      return fetchInsights(grouped, rangeStart, rangeEnd);
    },
    enabled: enabled && !!tenant && grouped.length > 0,
    staleTime: 10 * 60 * 1000, // 10 minutes — don't refetch on navigation
    gcTime: 30 * 60 * 1000, // keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["rental-insights", tenant?.id] });
  };

  return { ...query, refresh };
};
