/**
 * BacktestReportView — Spec §8.2.
 *
 * Shows projected lift, monthly bar chart, top-vehicles table, caveats, and
 * the two enable CTAs (Insights / Recommendations).
 *
 * Pure presentation — parent owns the backtest data + the toggle handlers.
 */
"use client";

import { Loader2, AlertCircle, RefreshCw, Sparkles, Eye, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BacktestResult } from "@/hooks/use-revenue-optimiser";

interface Props {
  report: BacktestResult;
  canAccessRecommendations: boolean;
  recommendationsRequiredTier: string;
  isToggling: boolean;
  isRunningBacktest: boolean;
  onEnableInsights: () => void;
  onEnableRecommendations: () => void;
  onRerunBacktest: () => void;
  currentMode?: string;
  isEnabled?: boolean;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const confidenceMeta: Record<string, { color: string; label: string }> = {
  high: { color: "text-emerald-600", label: "High" },
  medium: { color: "text-amber-600", label: "Medium" },
  low: { color: "text-zinc-500", label: "Low" },
};

export function BacktestReportView({
  report,
  canAccessRecommendations,
  recommendationsRequiredTier,
  isToggling,
  isRunningBacktest,
  onEnableInsights,
  onEnableRecommendations,
  onRerunBacktest,
  currentMode,
  isEnabled,
}: Props) {
  const narrative = report.per_vehicle_summary?.narrative ?? "";
  const perVehicle = report.per_vehicle_summary?.rows ?? [];
  const months = report.monthly_breakdown ?? [];
  const maxMonthBar = Math.max(1, ...months.flatMap((m) => [m.actual, m.projected]));
  const conf = confidenceMeta[report.confidence] ?? confidenceMeta.low;

  return (
    <main className="mx-auto w-full max-w-[960px] px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
            Backtest Report
          </div>
          <h1 className="mt-1 text-[30px] font-medium text-[#080812]">
            {report.period_start} → {report.period_end}
          </h1>
          <p className="mt-1 text-sm text-[#737373]">
            {report.vehicles_analysed} vehicles · {report.bookings_analysed} bookings
            · Generated {new Date(report.generated_at).toLocaleString()}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRerunBacktest} disabled={isRunningBacktest}>
          {isRunningBacktest
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Re-running…</>
            : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-run backtest</>}
        </Button>
      </header>

      {narrative && (
        <section className="mb-6 rounded-lg border-l-4 border-indigo-500 bg-indigo-50/40 p-4">
          <p className="text-[15px] leading-relaxed text-[#404040]">{narrative}</p>
        </section>
      )}

      {/* KPI grid */}
      <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Projected lift" value={`+${report.uplift_percent}%`} sub={fmtMoney(report.uplift_amount)} accent="text-emerald-600" />
        <KpiCard label="Actual revenue" value={fmtMoney(report.actual_revenue)} sub="What you earned" />
        <KpiCard label="Projected revenue" value={fmtMoney(report.projected_revenue)} sub="What you could have earned" />
        <KpiCard label="Confidence" value={conf.label} sub={`${report.bookings_analysed} bookings`} accent={conf.color} />
      </section>

      {months.length > 0 && (
        <section className="mb-6 rounded-lg border border-[#f1f5f9] bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#737373]">
            Revenue by month — actual vs. projected
          </h2>
          <div className="space-y-2">
            {months.map((m) => (
              <div key={m.month}>
                <div className="mb-1 flex items-center justify-between text-xs text-[#737373]">
                  <span>{m.month}</span>
                  <span className="tabular-nums">
                    {fmtMoney(m.actual)} → <span className="font-medium text-emerald-700">{fmtMoney(m.projected)}</span>
                  </span>
                </div>
                <div className="relative h-5 overflow-hidden rounded bg-zinc-100">
                  <div className="absolute inset-y-0 left-0 bg-zinc-300" style={{ width: `${(m.actual / maxMonthBar) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 border-r-2 border-emerald-600" style={{ width: `${(m.projected / maxMonthBar) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-[10px] text-[#737373]">
            <span><span className="inline-block h-2.5 w-2.5 bg-zinc-300 align-middle mr-1" />Actual</span>
            <span><span className="inline-block h-2.5 w-2.5 border-2 border-emerald-600 align-middle mr-1" />Projected with Revenue Optimiser</span>
          </div>
        </section>
      )}

      {perVehicle.length > 0 && (
        <section className="mb-6 rounded-lg border border-[#f1f5f9] bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#737373]">
            Top vehicles by projected lift
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f1f5f9] text-left text-xs text-[#737373]">
                <th className="py-2 font-medium">Vehicle</th>
                <th className="py-2 font-medium text-right">Bookings</th>
                <th className="py-2 font-medium text-right">Actual</th>
                <th className="py-2 font-medium text-right">Projected</th>
                <th className="py-2 font-medium text-right">Lift</th>
              </tr>
            </thead>
            <tbody>
              {perVehicle.slice(0, 10).map((v) => {
                const lift = v.projected - v.actual;
                const liftPct = v.actual > 0 ? (lift / v.actual) * 100 : 0;
                return (
                  <tr key={v.vehicle_id} className="border-b border-[#f1f5f9] last:border-0">
                    <td className="py-2">
                      <div className="text-[#080812]">{v.make} {v.model}</div>
                      <div className="text-xs text-[#737373]">{v.reg}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-[#737373]">{v.bookings}</td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(v.actual)}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-700">{fmtMoney(v.projected)}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-emerald-700">
                      {lift > 0 ? "+" : ""}{fmtMoney(lift)}
                      <span className="ml-1 text-[10px] text-[#737373]">({liftPct > 0 ? "+" : ""}{Math.round(liftPct * 10) / 10}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {perVehicle.length > 10 && (
            <p className="mt-2 text-xs text-[#737373]">… plus {perVehicle.length - 10} more vehicles</p>
          )}
        </section>
      )}

      <section className="mb-8 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-xs text-[#404040] space-y-1">
            <p className="font-medium">Caveats</p>
            <ul className="ml-5 list-disc space-y-0.5">
              <li>Backtest assumes historical demand patterns. Real-world results depend on how often you apply recommendations.</li>
              <li>Projection uses current vehicle prices as the baseline. Mid-period price changes may distort the estimate.</li>
              <li>Vehicles with &lt; 60 days of history are excluded from this view.</li>
              {report.per_vehicle_summary?.cap_applied && (
                <li>You have {report.per_vehicle_summary.total_fleet_size} usable vehicles; analysis was capped at the first 500. Re-run for the long tail separately.</li>
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* Enable CTAs — only when not already enabled */}
      {!isEnabled && (
        <section className="rounded-lg border border-[#f1f5f9] bg-white p-6">
          <h2 className="text-base font-medium text-[#080812]">Ready to start?</h2>
          <p className="mt-1 text-sm text-[#737373]">
            Pick how much control you want. You can switch modes anytime.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Button variant="outline" onClick={onEnableInsights} disabled={isToggling}>
              <Eye className="mr-1.5 h-4 w-4" /> Enable Insights Mode
            </Button>
            {canAccessRecommendations ? (
              <Button onClick={onEnableRecommendations} disabled={isToggling}>
                <Sparkles className="mr-1.5 h-4 w-4" /> Enable Recommendations
              </Button>
            ) : (
              <Button variant="outline" disabled title={`Recommendations needs the ${recommendationsRequiredTier} tier.`}>
                <Lock className="mr-1.5 h-4 w-4" /> Recommendations (need {recommendationsRequiredTier})
              </Button>
            )}
          </div>
          <p className="mt-3 text-[11px] text-[#737373]">
            <span className="font-medium">Insights:</span> we collect data, surface observations, no price changes.{" "}
            <span className="font-medium">Recommendations:</span> per-vehicle price suggestions you approve.
          </p>
        </section>
      )}
      {isEnabled && (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 text-sm text-emerald-900">
          Revenue Optimiser is <span className="font-medium capitalize">{currentMode}</span> mode for this tenant.
        </section>
      )}
    </main>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[#f1f5f9] bg-white p-4">
      <div className="text-[10px] uppercase tracking-wider text-[#737373]">{label}</div>
      <div className={`mt-1 text-2xl font-medium tabular-nums ${accent ?? "text-[#080812]"}`}>{value}</div>
      <div className="mt-1 text-xs text-[#737373]">{sub}</div>
    </div>
  );
}
