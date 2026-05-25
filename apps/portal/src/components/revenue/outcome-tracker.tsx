/**
 * OutcomeTracker — Spec §8.7
 *
 * Lists `pricing_recommendation_outcomes` rows, joined with their parent
 * recommendation for vehicle + price context. Computes a top-of-page summary:
 *   - Total measured applies
 *   - % positive / neutral / negative
 *   - Net measured revenue impact
 *
 * Each row shows the vehicle, the price delta, the before/after bookings +
 * revenue, and a coloured outcome chip.
 */
"use client";

import { useMemo } from "react";
import { CheckCircle2, MinusCircle, XCircle, BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePricingOutcomes, type PricingOutcome } from "@/hooks/use-pricing-recommendations";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface JoinedRec {
  id: string;
  vehicle_id: string;
  applied_price: number | null;
  current_price: number;
  applied_source: string | null;
  applied_at: string | null;
  vehicle: { reg: string | null; make: string | null; model: string | null } | null;
}

interface Props {
  /** How many days back to fetch outcomes for (default 90) */
  days?: number;
}

export function OutcomeTracker({ days = 90 }: Props) {
  const { tenant } = useTenant();
  const outcomes = usePricingOutcomes(days);

  // Pull all parent recs in one query, indexed by id
  const recIds = useMemo(() => (outcomes.data ?? []).map((o) => o.recommendation_id), [outcomes.data]);
  const recsQuery = useQuery({
    queryKey: ["pricing-outcome-recs", tenant?.id, recIds.join(",")],
    queryFn: async (): Promise<Record<string, JoinedRec>> => {
      if (!tenant?.id || recIds.length === 0) return {};
      const { data, error } = await supabase
        .from("pricing_recommendations")
        .select("id, vehicle_id, applied_price, current_price, applied_source, applied_at, vehicle:vehicles(reg, make, model)")
        .in("id", recIds);
      if (error) throw error;
      const map: Record<string, JoinedRec> = {};
      for (const r of ((data ?? []) as unknown as JoinedRec[])) map[r.id] = r;
      return map;
    },
    enabled: !!tenant?.id && recIds.length > 0,
  });

  // Phase 4 — offer dispatches per recommendation, for attributing conversions
  const offerDispatchesQuery = useQuery({
    queryKey: ["pricing-outcome-dispatches", tenant?.id, recIds.join(",")],
    queryFn: async (): Promise<Record<string, { dispatched: number; converted: number; revenueAttributable: number }>> => {
      if (!tenant?.id || recIds.length === 0) return {};
      const { data, error } = await supabaseUntyped
        .from("revenue_optimiser_offer_dispatches")
        .select("recommendation_id, dispatch_status, converted_to_rental_id")
        .in("recommendation_id", recIds);
      if (error) throw error;
      const grouped: Record<string, { dispatched: number; converted: number; revenueAttributable: number }> = {};
      for (const d of ((data ?? []) as unknown as Array<{ recommendation_id: string; dispatch_status: string; converted_to_rental_id: string | null }>)) {
        const g = grouped[d.recommendation_id] ?? { dispatched: 0, converted: 0, revenueAttributable: 0 };
        if (d.dispatch_status === "sent") g.dispatched++;
        if (d.converted_to_rental_id) g.converted++;
        grouped[d.recommendation_id] = g;
      }
      return grouped;
    },
    enabled: !!tenant?.id && recIds.length > 0,
  });

  const summary = useMemo(() => {
    const rows = outcomes.data ?? [];
    const positive = rows.filter((r) => r.outcome === "positive").length;
    const neutral = rows.filter((r) => r.outcome === "neutral").length;
    const negative = rows.filter((r) => r.outcome === "negative").length;
    const netRevenue = rows.reduce((s, r) => s + Number(r.net_revenue_delta ?? 0), 0);
    return { total: rows.length, positive, neutral, negative, netRevenue };
  }, [outcomes.data]);

  if (outcomes.isLoading || recsQuery.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
      </div>
    );
  }

  if (outcomes.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load outcomes: {(outcomes.error as Error).message}
      </div>
    );
  }

  const rows = outcomes.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-10 text-center">
        <BarChart3 className="mx-auto h-7 w-7 text-[#737373]" />
        <h3 className="mt-3 text-sm font-medium text-[#080812]">No measured outcomes yet</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-[#737373]">
          Outcomes are measured 14 days after each apply. Once applied recommendations
          age past the 14-day window, you&apos;ll see before/after revenue impact here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Measured applies" value={summary.total.toString()} />
        <SummaryCard
          label="Positive"
          value={summary.positive.toString()}
          subtext={summary.total > 0 ? `${Math.round((summary.positive / summary.total) * 100)}%` : undefined}
          tone="positive"
        />
        <SummaryCard
          label="Neutral / Negative"
          value={`${summary.neutral} / ${summary.negative}`}
          tone={summary.negative > summary.positive ? "negative" : "neutral"}
        />
        <SummaryCard
          label="Net measured impact"
          value={`${summary.netRevenue >= 0 ? "+" : ""}${fmtMoney(summary.netRevenue)}`}
          tone={summary.netRevenue >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Outcome rows */}
      <ul className="space-y-2">
        {rows.map((o) => (
          <OutcomeRow
            key={o.id}
            outcome={o}
            rec={recsQuery.data?.[o.recommendation_id]}
            offers={offerDispatchesQuery.data?.[o.recommendation_id]}
          />
        ))}
      </ul>
    </div>
  );
}

function SummaryCard({
  label, value, subtext, tone,
}: { label: string; value: string; subtext?: string; tone?: "positive" | "neutral" | "negative" }) {
  const colour =
    tone === "positive" ? "text-emerald-600" :
    tone === "negative" ? "text-red-600" :
    tone === "neutral" ? "text-amber-600" :
    "text-[#080812]";
  return (
    <div className="rounded-lg border border-[#f1f5f9] bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-[#737373]">{label}</div>
      <div className={`mt-1 text-xl font-medium tabular-nums ${colour}`}>{value}</div>
      {subtext && <div className="text-[11px] text-[#737373]">{subtext}</div>}
    </div>
  );
}

function OutcomeRow({
  outcome, rec, offers,
}: {
  outcome: PricingOutcome;
  rec?: JoinedRec;
  offers?: { dispatched: number; converted: number; revenueAttributable: number };
}) {
  const v = rec?.vehicle;
  const title = [v?.make, v?.model].filter(Boolean).join(" ") || "Vehicle";
  const appliedPrice = rec?.applied_price ?? null;
  const previousPrice = rec?.current_price ?? null;

  const ICON_MAP = {
    positive: { Icon: CheckCircle2, colour: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    neutral: { Icon: MinusCircle, colour: "text-amber-600", chip: "bg-amber-50 text-amber-700 border-amber-200" },
    negative: { Icon: XCircle, colour: "text-red-600", chip: "bg-red-50 text-red-700 border-red-200" },
  };
  const m = ICON_MAP[outcome.outcome] ?? ICON_MAP.neutral;
  const Icon = m.Icon;

  return (
    <li className="rounded-lg border border-[#f1f5f9] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${m.colour}`} />
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.chip}`}>
              {outcome.outcome}
            </span>
            {v?.reg && (
              <span className="rounded-full border border-[#f1f5f9] bg-[#f8fafc] px-2 py-0.5 text-[10px] text-[#404040]">
                {v.reg}
              </span>
            )}
            <span className="text-[10px] text-[#737373]">
              Measured {new Date(outcome.measured_at).toLocaleDateString()}
            </span>
          </div>
          <div className="mt-1 text-sm font-medium text-[#080812]">{title}</div>
          {appliedPrice !== null && previousPrice !== null && (
            <div className="mt-0.5 text-xs text-[#737373]">
              Price moved {fmtMoney(previousPrice)} → {fmtMoney(appliedPrice)} ·
              {" "}via {rec?.applied_source ?? "manual"}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-[#737373]">Net 14d revenue</div>
          <div className={`mt-0.5 text-lg font-medium tabular-nums ${(outcome.net_revenue_delta ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {(outcome.net_revenue_delta ?? 0) >= 0 ? "+" : ""}
            {fmtMoney(outcome.net_revenue_delta ?? 0)}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <MetricBlock label="Bookings before" value={outcome.bookings_before} />
        <MetricBlock label="Bookings after" value={outcome.bookings_after} />
        <MetricBlock label="Revenue before" value={outcome.revenue_before} money />
        <MetricBlock label="Revenue after" value={outcome.revenue_after} money />
      </div>
      {offers && offers.dispatched > 0 && (
        <div className="mt-2 rounded-md border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-indigo-900">
          <strong>{offers.converted}</strong> of <strong>{offers.dispatched}</strong> contacted leads booked
          {offers.dispatched > 0 && offers.converted === 0 && " — no conversions yet"}
        </div>
      )}
    </li>
  );
}

function MetricBlock({ label, value, money }: { label: string; value: number | null; money?: boolean }) {
  return (
    <div className="rounded-md border border-[#f1f5f9] bg-[#f8fafc] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[#737373]">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums text-[#080812]">
        {value === null ? "—" : money ? fmtMoney(value) : value.toString()}
      </div>
    </div>
  );
}
