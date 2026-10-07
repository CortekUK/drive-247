import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * "What Drive247 did for you this month" — the card at the bottom of the
 * portal home, v1 and v2.
 *
 * Everything is counted in the database by `get_tenant_value_summary` (see
 * supabase/migrations/20261007180000_tenant_value_summary.sql for exactly what
 * each number is), because "messages sent for you" includes customer
 * notifications, which portal users cannot read directly.
 *
 * Calendar month, in the browser's time zone, against the same days of last
 * month so "vs last month" compares like with like (the 1st–7th against the
 * 1st–7th, not against a whole month).
 */

export interface ValueSummary {
  bookings: number;
  rentalRevenue: number;
  repeatCustomers: number;
  messagesSent: number;
}

export interface ValueSummaryResult {
  thisMonth: ValueSummary;
  /** Same span of last month — the 1st up to today's date. */
  lastMonthToDate: ValueSummary;
  monthLabel: string;
}

function read(raw: unknown): ValueSummary {
  const d = (raw ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(d[k]) || 0;
  return {
    bookings: n("bookings"),
    rentalRevenue: n("rental_revenue"),
    repeatCustomers: n("repeat_customers"),
    messagesSent: n("messages_sent"),
  };
}

export function useValueSummary() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["value-summary", tenant?.id, new Date().toDateString()],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ValueSummaryResult> => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      // Clamp to last month's length: on the 31st, last month may only have 30 days.
      const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      const prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), prevDays) + 1);

      const call = (from: Date, to: Date) =>
        supabaseUntyped.rpc("get_tenant_value_summary", {
          p_tenant_id: tenant!.id,
          p_from: from.toISOString(),
          p_to: to.toISOString(),
        });
      const [cur, prev] = await Promise.all([call(monthStart, tomorrow), call(prevStart, prevEnd)]);
      if (cur.error) throw cur.error;
      return {
        thisMonth: read(cur.data),
        lastMonthToDate: prev.error ? read(null) : read(prev.data),
        monthLabel: now.toLocaleDateString("en-US", { month: "long" }),
      };
    },
  });
}

/** "+3 vs last month" — or null when there is nothing to compare with. */
export function changeLabel(now: number, before: number, format: (n: number) => string = String): string | null {
  if (before === 0 && now === 0) return null;
  const diff = now - before;
  if (diff === 0) return "Same as last month";
  return `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))} vs last month`;
}
