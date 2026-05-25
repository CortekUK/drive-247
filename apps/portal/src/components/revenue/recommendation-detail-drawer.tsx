/**
 * RecommendationDetailDrawer — Spec §8.4
 *
 * Right-hand sheet showing the full "why" behind a recommendation:
 *   1. Headline price delta + confidence
 *   2. AI explanation (full text)
 *   3. Top reasons (all, not just top-3)
 *   4. Data points grid (the numbers behind the math)
 *   5. Elasticity curve (recharts line chart) — current vs recommended marked
 *   6. Actions: Apply / Custom Price / Dismiss / Snooze / Revert (if applied)
 */
"use client";

import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sparkles, Check, X, Clock, Undo2, TrendingUp, TrendingDown } from "lucide-react";
import type { PricingRecommendation } from "@/hooks/use-pricing-recommendations";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtPct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

interface Props {
  open: boolean;
  rec: PricingRecommendation | null;
  onClose: () => void;
  onApply: (rec: PricingRecommendation) => void;
  onDismiss: (rec: PricingRecommendation) => void;
  onSnooze: (rec: PricingRecommendation) => void;
  onRevert: (rec: PricingRecommendation) => void;
  isBusy: boolean;
}

export function RecommendationDetailDrawer({
  open, rec, onClose, onApply, onDismiss, onSnooze, onRevert, isBusy,
}: Props) {
  const curveData = useMemo(() => {
    if (!rec?.elasticity_curve) return [];
    return rec.elasticity_curve
      .filter((p) => Number.isFinite(p.price) && Number.isFinite(p.predicted_qty))
      .map((p) => ({ price: Math.round(p.price), qty: Math.round(p.predicted_qty * 100) / 100 }));
  }, [rec?.elasticity_curve]);

  if (!rec) return null;
  const diff = rec.recommended_price - rec.current_price;
  const pct = rec.current_price > 0 ? (diff / rec.current_price) * 100 : 0;
  const goingUp = diff > 0;
  const v = rec.vehicle;
  const title = [v?.make, v?.model].filter(Boolean).join(" ") || "Vehicle";
  const data = rec.data_points as Record<string, unknown> | null;
  const num = (k: string): number | null => {
    if (!data) return null;
    const x = data[k];
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const bool = (k: string): boolean | null => {
    if (!data) return null;
    const x = data[k];
    return typeof x === "boolean" ? x : null;
  };
  const str = (k: string): string | null => {
    if (!data) return null;
    const x = data[k];
    return typeof x === "string" ? x : null;
  };

  const isApplied = rec.status === "applied";
  const isPending = rec.status === "pending";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            {title}
            {v?.reg && (
              <span className="rounded-full border border-[#f1f5f9] bg-[#f8fafc] px-2 py-0.5 text-[10px] text-[#404040]">
                {v.reg}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs text-[#737373]">
            Generated {new Date(rec.created_at).toLocaleString()} · expires {new Date(rec.expires_at).toLocaleDateString()}
          </SheetDescription>
        </SheetHeader>

        {/* Headline */}
        <div className="mt-4 rounded-lg border border-[#f1f5f9] bg-[#f8fafc] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
            {rec.tier.replace("_", " ")} rate · {rec.confidence} confidence
          </div>
          <div className="mt-1 flex items-baseline gap-2 tabular-nums">
            <span className="text-sm text-[#737373] line-through">{fmtMoney(rec.current_price)}</span>
            <span className="text-3xl font-medium text-[#080812]">{fmtMoney(rec.recommended_price)}</span>
            <span className={`flex items-center gap-0.5 text-sm font-medium ${goingUp ? "text-emerald-600" : "text-red-600"}`}>
              {goingUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {goingUp ? "+" : ""}{pct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 text-xs text-[#737373]">
            Recommended range {fmtMoney(rec.recommended_range_low)} – {fmtMoney(rec.recommended_range_high)}
          </div>
          {rec.projected_revenue_delta_monthly !== null && (
            <div className="mt-3 text-xs">
              <span className="text-[#737373]">Projected monthly impact: </span>
              <span className={`font-medium tabular-nums ${rec.projected_revenue_delta_monthly >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {rec.projected_revenue_delta_monthly >= 0 ? "+" : ""}{fmtMoney(rec.projected_revenue_delta_monthly)}
              </span>
            </div>
          )}
          {bool("clamped") && str("clamp_reason") && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              Adjusted by safety rails: {str("clamp_reason")}
            </div>
          )}
        </div>

        {/* GPT explanation */}
        {rec.ai_explanation && (
          <section className="mt-5">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#737373]">
              <Sparkles className="h-3 w-3 text-indigo-500" /> Why we suggest this
            </h3>
            <p className="rounded-md border border-[#f1f5f9] bg-white p-3 text-[13px] leading-relaxed text-[#404040]">
              {rec.ai_explanation}
            </p>
          </section>
        )}

        {/* Reasons */}
        {rec.reasons && rec.reasons.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">Signals</h3>
            <ul className="space-y-1.5">
              {rec.reasons.map((r, i) => (
                <li key={`${r.code}-${i}`} className="flex items-start justify-between gap-2 rounded-md border border-[#f1f5f9] bg-white px-3 py-2 text-[13px]">
                  <span className="text-[#404040]">{r.label}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#737373]">
                    weight {Math.round(r.weight * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Data points */}
        <section className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">Data points</h3>
          <dl className="grid grid-cols-2 gap-2 text-[12px]">
            <DataPoint label="Bookings (30d)" value={num("bookings_30d")} />
            <DataPoint label="Bookings (90d)" value={num("bookings_90d")} />
            <DataPoint label="Utilisation (30d)" value={num("utilization_30d")} suffix="%" />
            <DataPoint label="Fleet avg utilisation" value={num("fleet_avg_utilization")} suffix="%" />
            <DataPoint label="Idle days" value={num("idle_days")} />
            <DataPoint label="Active enquiries (14d)" value={num("active_enquiries_14d")} />
            <DataPoint label="Conversion @ current price" value={num("conversion_at_current_price")} suffix="%" />
            <DataPoint label="Similar cars available" value={num("similar_available_pct")} suffix="%" />
            <DataPoint label="Elasticity" value={num("elasticity")} digits={2} />
            <DataPoint label="Elasticity R²" value={num("elasticity_r_squared")} digits={2} />
          </dl>
        </section>

        {/* Elasticity curve */}
        {curveData.length >= 2 && (
          <section className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#737373]">
              Demand curve at this price point
            </h3>
            <div className="rounded-md border border-[#f1f5f9] bg-white p-3">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={curveData} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="price"
                    tick={{ fill: "#737373", fontSize: 10 }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <YAxis
                    tick={{ fill: "#737373", fontSize: 10 }}
                    width={32}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #f1f5f9" }}
                    formatter={(value: number) => [value.toFixed(2), "Predicted bookings"]}
                    labelFormatter={(p: number) => `$${p}`}
                  />
                  <Line type="monotone" dataKey="qty" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <ReferenceDot
                    x={Math.round(rec.current_price)}
                    y={findQtyForPrice(curveData, rec.current_price)}
                    r={5}
                    fill="#737373"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                  <ReferenceDot
                    x={Math.round(rec.recommended_price)}
                    y={findQtyForPrice(curveData, rec.recommended_price)}
                    r={6}
                    fill="#6366f1"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-1 flex items-center justify-between text-[10px] text-[#737373]">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#737373]" /> Current {fmtMoney(rec.current_price)}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#6366f1]" /> Recommended {fmtMoney(rec.recommended_price)}</span>
              </div>
            </div>
          </section>
        )}

        {/* Status panel for applied recs */}
        {isApplied && (
          <section className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
            <div className="font-medium text-emerald-900">Applied {rec.applied_at ? new Date(rec.applied_at).toLocaleDateString() : ""}</div>
            <p className="mt-0.5 text-emerald-800">
              Price set to {fmtMoney(rec.applied_price ?? rec.recommended_price)} via {rec.applied_source ?? "manual"}.
              Outcome will be measured 14 days from apply.
            </p>
          </section>
        )}

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#f1f5f9] pt-4">
          {isPending && (
            <>
              <Button
                onClick={() => onApply(rec)}
                disabled={isBusy}
                className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
              >
                <Check className="mr-1.5 h-4 w-4" /> Apply
              </Button>
              <Button
                variant="outline"
                onClick={() => onSnooze(rec)}
                disabled={isBusy}
              >
                <Clock className="mr-1.5 h-4 w-4" /> Snooze 7 days
              </Button>
              <Button
                variant="ghost"
                onClick={() => onDismiss(rec)}
                disabled={isBusy}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <X className="mr-1.5 h-4 w-4" /> Dismiss
              </Button>
            </>
          )}
          {isApplied && (
            <Button
              variant="outline"
              onClick={() => onRevert(rec)}
              disabled={isBusy}
            >
              <Undo2 className="mr-1.5 h-4 w-4" /> Revert price
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DataPoint({ label, value, suffix, digits = 0 }: { label: string; value: number | null; suffix?: string; digits?: number }) {
  return (
    <div className="rounded-md border border-[#f1f5f9] bg-white px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-[#737373]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-[#080812]">
        {value === null ? "—" : `${value.toFixed(digits)}${suffix ?? ""}`}
      </dd>
    </div>
  );
}

function findQtyForPrice(curve: Array<{ price: number; qty: number }>, target: number): number {
  if (curve.length === 0) return 0;
  let best = curve[0];
  let bestDelta = Math.abs(best.price - target);
  for (const p of curve) {
    const d = Math.abs(p.price - target);
    if (d < bestDelta) { best = p; bestDelta = d; }
  }
  return best.qty;
}
