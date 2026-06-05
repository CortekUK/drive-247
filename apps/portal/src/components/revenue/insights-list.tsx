/**
 * InsightsList + CalibrationBanner — Phase 1 Insights mode surface.
 *
 * Shown after the operator enables Insights Mode. The daily cron writes
 * observations into revenue_optimiser_insights; this component groups them
 * by date and renders them as cards with icons per observation type.
 */
"use client";

import {
  Flame, Snowflake, Pause, Inbox, PackageSearch, Layers, Clock,
} from "lucide-react";
import type { RevenueOptimiserInsight } from "@/hooks/use-revenue-optimiser";

const TYPE_ICON: Record<string, { Icon: typeof Flame; color: string; label: string }> = {
  high_utilization: { Icon: Flame, color: "text-orange-600", label: "High utilisation" },
  low_utilization: { Icon: Snowflake, color: "text-blue-600", label: "Low utilisation" },
  idle_streak: { Icon: Pause, color: "text-zinc-500", label: "Idle vehicle" },
  enquiry_hotspot: { Icon: Inbox, color: "text-indigo-600", label: "Enquiry hotspot" },
  fleet_supply_high: { Icon: PackageSearch, color: "text-amber-600", label: "Fleet supply high" },
  fleet_supply_low: { Icon: PackageSearch, color: "text-emerald-600", label: "Fleet supply low" },
  fleet_summary: { Icon: Layers, color: "text-zinc-700", label: "Fleet summary" },
};

interface Props {
  insights: RevenueOptimiserInsight[];
  isLoading: boolean;
}

export function InsightsList({ insights, isLoading }: Props) {
  if (isLoading) {
    return <p className="text-sm text-[#737373]">Loading insights…</p>;
  }
  if (insights.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white p-8 text-center">
        <Clock className="mx-auto h-7 w-7 text-[#737373]" />
        <h3 className="mt-3 text-sm font-medium text-[#080812]">No observations yet</h3>
        <p className="mt-1 text-xs text-[#737373]">
          The daily cron runs at 07:10 UTC. Once it fires, you&apos;ll see fleet observations here.
        </p>
      </div>
    );
  }

  // Group by date
  const byDate = new Map<string, RevenueOptimiserInsight[]>();
  for (const i of insights) {
    const list = byDate.get(i.observation_date) ?? [];
    list.push(i);
    byDate.set(i.observation_date, list);
  }

  return (
    <div className="space-y-5">
      {[...byDate.entries()].map(([date, rows]) => (
        <section key={date}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">
            {new Date(date).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </h3>
          <ul className="space-y-2">
            {rows.map((i) => {
              const meta = TYPE_ICON[i.observation_type] ?? { Icon: Layers, color: "text-zinc-500", label: i.observation_type };
              const Icon = meta.Icon;
              return (
                <li key={i.id} className="flex items-start gap-3 rounded-md border border-[#f1f5f9] bg-white p-3">
                  <div className={`mt-0.5 rounded-md bg-[#f8fafc] p-1.5 ${meta.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wide text-[#737373]">{meta.label}</div>
                    <div className="text-sm text-[#080812]">{i.label}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface CalibrationProps {
  calibrationStartedAt: string | null;
  calibrationComplete: boolean;
  canAccessRecommendations: boolean;
  recommendationsRequiredTier: string;
}

export function CalibrationBanner({
  calibrationStartedAt,
  calibrationComplete,
  canAccessRecommendations,
  recommendationsRequiredTier,
}: CalibrationProps) {
  if (calibrationComplete) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
        <div className="flex items-start gap-2">
          <div className="rounded-md bg-emerald-100 p-1.5 text-emerald-700">
            <Flame className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm">
            <div className="font-medium text-emerald-900">Calibration complete</div>
            <p className="mt-0.5 text-xs text-emerald-800">
              {canAccessRecommendations
                ? "You can now switch to Recommendations Mode and start seeing per-vehicle price suggestions."
                : `Recommendations Mode is on the ${recommendationsRequiredTier} tier — upgrade to unlock per-vehicle pricing.`}
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (!calibrationStartedAt) return null;
  const started = new Date(calibrationStartedAt);
  const daysElapsed = Math.floor((Date.now() - started.getTime()) / 86_400_000);
  const daysRemaining = Math.max(0, 30 - daysElapsed);
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="flex items-start gap-2">
        <div className="rounded-md bg-indigo-100 p-1.5 text-indigo-700">
          <Clock className="h-4 w-4" />
        </div>
        <div className="flex-1 text-sm">
          <div className="font-medium text-indigo-900">
            Calibration period · {daysRemaining} day{daysRemaining === 1 ? "" : "s"} remaining
          </div>
          <p className="mt-0.5 text-xs text-indigo-800">
            We&apos;re still building a baseline of your fleet&apos;s demand. After 30 days,
            you can switch to Recommendations Mode.
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
            <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (daysElapsed / 30) * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
