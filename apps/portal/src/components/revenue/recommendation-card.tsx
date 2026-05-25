/**
 * RecommendationCard — Spec §8.3
 *
 * Single recommendation card with price delta, confidence badge, top-3 reasons,
 * GPT explanation, and the four action buttons (Apply / Details / Dismiss / Snooze).
 *
 * Used inside RecommendationsList. Click "Details" to open the elasticity drawer.
 */
"use client";

import { TrendingUp, TrendingDown, Sparkles, MoreHorizontal, Check, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PricingRecommendation } from "@/hooks/use-pricing-recommendations";

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const TIER_LABEL: Record<PricingRecommendation["tier"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  weekend_daily: "Weekend",
};

const CONFIDENCE_STYLE: Record<PricingRecommendation["confidence"], string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-zinc-50 text-zinc-600 border-zinc-200",
};

interface Props {
  rec: PricingRecommendation;
  onApply: (rec: PricingRecommendation) => void;
  onDetails: (rec: PricingRecommendation) => void;
  onDismiss: (rec: PricingRecommendation) => void;
  onSnooze: (rec: PricingRecommendation) => void;
  isBusy?: boolean;
}

export function RecommendationCard({ rec, onApply, onDetails, onDismiss, onSnooze, isBusy }: Props) {
  const v = rec.vehicle;
  // Phase 3 patch — prefer the LIVE price from the joined vehicle row over
  // the snapshot stored on the rec. If the operator edited the price on the
  // vehicle page between this morning's generate and now, the card shows
  // the true "from → to" delta. Falls back to rec.current_price if the
  // join didn't run.
  const liveCurrent = liveCurrentPriceFor(v, rec.tier) ?? rec.current_price;
  const diff = rec.recommended_price - liveCurrent;
  const pct = liveCurrent > 0 ? (diff / liveCurrent) * 100 : 0;
  const goingUp = diff > 0;
  const title = [v?.make, v?.model].filter(Boolean).join(" ") || "Vehicle";
  const top3 = (rec.reasons ?? []).slice(0, 3);
  const priceShifted = Math.abs(liveCurrent - rec.current_price) >= 1;

  return (
    <article className="rounded-lg border border-[#f1f5f9] bg-white p-5 transition-colors hover:border-indigo-200">
      <div className="flex items-start justify-between gap-4">
        {/* Left: vehicle + delta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-600">
              {TIER_LABEL[rec.tier]} rate
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLE[rec.confidence]}`}>
              {rec.confidence} confidence
            </span>
            {rec.status === "pending_approval" && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                Approval required
              </span>
            )}
            {rec.experiment_arm && (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                A/B · {rec.experiment_arm}
              </span>
            )}
            {v?.reg && (
              <span className="rounded-full border border-[#f1f5f9] bg-[#f8fafc] px-2 py-0.5 text-[10px] text-[#404040]">
                {v.reg}
              </span>
            )}
          </div>
          <h3 className="mt-1 truncate text-base font-medium text-[#080812]">{title}</h3>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="text-sm text-[#737373] line-through">{fmtMoney(liveCurrent)}</span>
            <span className="text-2xl font-medium text-[#080812]">{fmtMoney(rec.recommended_price)}</span>
            <span className={`flex items-center gap-0.5 text-xs font-medium ${goingUp ? "text-emerald-600" : "text-red-600"}`}>
              {goingUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {goingUp ? "+" : ""}{pct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 text-[11px] text-[#737373]">
            Range {fmtMoney(rec.recommended_range_low)} – {fmtMoney(rec.recommended_range_high)}
            {priceShifted && (
              <span className="ml-1 text-amber-700">
                · price was {fmtMoney(rec.current_price)} when generated
              </span>
            )}
          </div>
        </div>

        {/* Right: projected lift */}
        {rec.projected_revenue_delta_monthly !== null && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wide text-[#737373]">Projected/mo</div>
            <div className={`mt-0.5 text-lg font-medium tabular-nums ${rec.projected_revenue_delta_monthly >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {rec.projected_revenue_delta_monthly >= 0 ? "+" : ""}{fmtMoney(rec.projected_revenue_delta_monthly)}
            </div>
          </div>
        )}
      </div>

      {/* Reasons */}
      {top3.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {top3.map((r, i) => (
            <li key={`${r.code}-${i}`} className="rounded-full bg-[#f8fafc] px-2 py-0.5 text-[11px] text-[#404040]">
              {r.label}
            </li>
          ))}
        </ul>
      )}

      {/* GPT explanation */}
      {rec.ai_explanation && (
        <div className="mt-3 rounded-md border border-[#f1f5f9] bg-[#fafafa] p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
            <p className="text-[13px] leading-relaxed text-[#404040]">{rec.ai_explanation}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDetails(rec)}
          disabled={isBusy}
          className="text-xs"
        >
          Details
        </Button>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={isBusy} aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => onSnooze(rec)}>
                <Clock className="mr-2 h-3.5 w-3.5" /> Snooze 7 days
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDismiss(rec)} className="text-red-600 focus:text-red-700">
                <X className="mr-2 h-3.5 w-3.5" /> Dismiss
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            onClick={() => onApply(rec)}
            disabled={isBusy}
            className="bg-[#0f172a] text-xs text-white hover:bg-[#0f172a]/90"
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            Apply
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Pull the live tier rent from the joined vehicle row. Null if the join didn't run. */
function liveCurrentPriceFor(
  vehicle: PricingRecommendation["vehicle"],
  tier: PricingRecommendation["tier"],
): number | null {
  if (!vehicle) return null;
  const key =
    tier === "daily" ? "daily_rent" :
    tier === "weekly" ? "weekly_rent" :
    tier === "monthly" ? "monthly_rent" :
    "daily_rent";  // weekend_daily uses the daily column
  const raw = (vehicle as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
