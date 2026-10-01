import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO, startOfMonth, startOfWeek, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Money collected over a range, for the v2 dashboard's revenue chart.
 *
 * Returns the range as a RUNNING TOTAL (it climbs to the headline figure), the
 * previous range of the same length as a second running total for the ghost
 * line, a few stats, and — for the daily ranges — a forecast: charges already
 * on the ledger falling due in the next 7 days, stacked on top of today's total.
 *
 * "Collected" is a payment whose status says the money arrived: Applied,
 * Completed, Partial, Credit and Partial Refund. Pending, Reversed and Refunded
 * are left out, and a partial refund's `refund_amount` is taken off its day.
 *
 * TENANT ISOLATION: RLS is OFF on `payments` and `ledger_entries` (V2_PLAN §5).
 * The `.eq('tenant_id', …)` on both queries below is the only thing keeping
 * this to one operator.
 */

const COLLECTED = ["Applied", "Completed", "Partial", "Credit", "Partial Refund"];
const PAGE = 1000; // PostgREST's row cap — page past it rather than truncate silently.
const FORECAST_DAYS = 7;

export type RevenueRange = "7d" | "30d" | "90d" | "12m";

/** Days covered and how points are grouped. Longer ranges group, so the line stays readable. */
export const REVENUE_RANGES: Record<RevenueRange, { days: number; bucket: "day" | "week" | "month"; label: string }> = {
  "7d": { days: 7, bucket: "day", label: "7D" },
  "30d": { days: 30, bucket: "day", label: "30D" },
  "90d": { days: 90, bucket: "week", label: "90D" },
  "12m": { days: 365, bucket: "month", label: "12M" },
};

export interface RevenuePoint {
  /** yyyy-MM-dd — the day, or the first day of the week/month the point groups. */
  date: string;
  /** Running total up to and including this point. Undefined on forecast-only points. */
  total?: number;
  /** The previous range's running total at the same position. */
  previous?: number;
  /** Today's total plus scheduled charges up to this day. Only on today and the days after. */
  forecast?: number;
}

export interface RevenueSeries {
  points: RevenuePoint[];
  bucket: "day" | "week" | "month";
  total: number;
  previousTotal: number;
  /** How many payments make up `total`. */
  paymentCount: number;
  averagePerDay: number;
  bestDay: { date: string; amount: number } | null;
  /** Sum of charges due in the next 7 days. 0 on grouped ranges, where no forecast is drawn. */
  scheduled: number;
}

type PaymentRow = { payment_date: string; amount: number | null; refund_amount: number | null };

async function fetchPayments(tenantId: string, from: string): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("payments")
      .select("payment_date, amount, refund_amount")
      .eq("tenant_id", tenantId)
      .in("status", COLLECTED)
      .gte("payment_date", from)
      .order("payment_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as PaymentRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

function bucketKey(date: string, bucket: "day" | "week" | "month"): string {
  if (bucket === "day") return date;
  const d = parseISO(date);
  return dayKey(bucket === "week" ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d));
}

/** Every bucket in [from, to], in order, empty ones included — a skipped zero draws a slope that never happened. */
function bucketsBetween(from: Date, to: Date, bucket: "day" | "week" | "month"): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(dayKey(d), bucket);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export const useDashboardRevenueSeries = (range: RevenueRange = "30d") => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["dashboard-revenue-series", tenant?.id, range],
    queryFn: async (): Promise<RevenueSeries> => {
      const { days, bucket } = REVENUE_RANGES[range];
      const today = new Date();
      const start = subDays(today, days - 1);
      const prevStart = subDays(today, days * 2 - 1);
      const startKey = dayKey(start);

      const [rows, charges] = await Promise.all([
        fetchPayments(tenant!.id, dayKey(prevStart)),
        bucket === "day"
          ? supabase
              .from("ledger_entries")
              .select("due_date, remaining_amount")
              .eq("tenant_id", tenant!.id)
              .eq("type", "Charge")
              .gt("remaining_amount", 0)
              .gt("due_date", dayKey(today))
              .lte("due_date", dayKey(addDays(today, FORECAST_DAYS)))
              .limit(PAGE)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (charges.error) throw charges.error;

      // Net per day, split into this range and the one before.
      const current = new Map<string, number>();
      const previous = new Map<string, number>();
      let paymentCount = 0;
      for (const r of rows) {
        const net = Number(r.amount ?? 0) - Number(r.refund_amount ?? 0);
        if (r.payment_date >= startKey) {
          current.set(r.payment_date, (current.get(r.payment_date) ?? 0) + net);
          paymentCount++;
        } else {
          previous.set(r.payment_date, (previous.get(r.payment_date) ?? 0) + net);
        }
      }

      let bestDay: RevenueSeries["bestDay"] = null;
      for (const [date, amount] of current) {
        if (amount > 0 && (!bestDay || amount > bestDay.amount)) bestDay = { date, amount };
      }

      const group = (daily: Map<string, number>) => {
        const out = new Map<string, number>();
        for (const [date, amount] of daily) {
          const k = bucketKey(date, bucket);
          out.set(k, (out.get(k) ?? 0) + amount);
        }
        return out;
      };
      const currentBuckets = group(current);
      // The previous range, re-keyed onto this range's buckets by position.
      const prevKeys = bucketsBetween(prevStart, subDays(start, 1), bucket);
      const prevBuckets = group(previous);
      const keys = bucketsBetween(start, today, bucket);

      const round = (n: number) => Math.round(n * 100) / 100;
      let run = 0;
      let prevRun = 0;
      const points: RevenuePoint[] = keys.map((date, i) => {
        run += currentBuckets.get(date) ?? 0;
        const pk = prevKeys[i];
        if (pk !== undefined) prevRun += prevBuckets.get(pk) ?? 0;
        return { date, total: round(run), previous: pk !== undefined ? round(prevRun) : undefined };
      });

      // Forecast: starts at today's total so the dotted line joins the solid one.
      let scheduled = 0;
      if (bucket === "day" && points.length) {
        const due = new Map<string, number>();
        for (const c of (charges.data ?? []) as { due_date: string; remaining_amount: number }[]) {
          due.set(c.due_date, (due.get(c.due_date) ?? 0) + Number(c.remaining_amount ?? 0));
        }
        points[points.length - 1].forecast = round(run);
        let ahead = run;
        for (let i = 1; i <= FORECAST_DAYS; i++) {
          const date = dayKey(addDays(today, i));
          ahead += due.get(date) ?? 0;
          points.push({ date, forecast: round(ahead) });
        }
        scheduled = round(ahead - run);
      }

      const total = round(run);
      return {
        points,
        bucket,
        total,
        previousTotal: round([...previous.values()].reduce((s, n) => s + n, 0)),
        paymentCount,
        averagePerDay: round(total / days),
        bestDay,
        scheduled,
      };
    },
    enabled: !!tenant,
    staleTime: 60 * 1000,
  });
};
