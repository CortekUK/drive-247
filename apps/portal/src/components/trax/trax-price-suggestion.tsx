/**
 * TraxPriceSuggestion — Trax price hint + "Why?" dialog.
 *
 * Two looks, same brain:
 *   variant="inline" (default) — compact one-liner for the vehicle edit dialog
 *                                and the New Rental rate field.
 *   variant="card"             — a premium AI tile for the Vehicle Pricing
 *                                section on the vehicle detail page.
 *
 * The number is math (trax_price_suggest RPC); the "Why?" narrative is fetched
 * lazily only when the dialog opens.
 */
"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Check, Loader2, Sparkles } from "lucide-react";
import { TraxIcon } from "@/components/chat/TraxIcon";
import { useAuthStore } from "@/stores/auth-store";
import {
  useTraxPrice,
  useTraxWhy,
  type TraxTier,
  type TraxConfidence,
} from "@/hooks/use-trax-price";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(n);

const TIER_LABEL: Record<TraxTier, string> = {
  daily: "/day",
  weekly: "/week",
  monthly: "/mo",
};

const MATCH_LABEL: Record<string, string> = {
  make_model_year: "near-identical vehicles (same make, model & year)",
  make_model: "vehicles of the same make & model",
  make: "vehicles of the same brand",
};

const CONFIDENCE_STYLE: Record<TraxConfidence, string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  medium: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  low: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  none: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

interface Props {
  vehicleId?: string;
  tier: TraxTier;
  /** Draft mode (add-vehicle): no id yet — match on the typed make/model/year. */
  draftMake?: string;
  draftModel?: string;
  draftYear?: number;
  /** Live price to compare against (e.g. the form field value). Falls back to the stored rate. */
  currentPrice?: number;
  onImplement?: (price: number) => void;
  /** Show a subtle "not enough data" state instead of rendering nothing. */
  showEmpty?: boolean;
  /** Visual treatment. "card" is the premium tile used on the vehicle detail page. */
  variant?: "inline" | "card";
  /** Tier label shown in the card header (e.g. "Daily"). */
  label?: string;
  className?: string;
}

export function TraxPriceSuggestion({
  vehicleId,
  tier,
  draftMake,
  draftModel,
  draftYear,
  currentPrice,
  onImplement,
  showEmpty = false,
  variant = "inline",
  label,
  className,
}: Props) {
  const appUser = useAuthStore((s) => s.appUser);
  const firstName = (appUser?.name ?? "").trim().split(/\s+/)[0] || "there";

  const { data, isLoading } = useTraxPrice({
    vehicleId,
    tier,
    make: draftMake,
    model: draftModel,
    year: draftYear,
  });
  const why = useTraxWhy();
  const [open, setOpen] = useState(false);
  const [reasoning, setReasoning] = useState<string>("");

  const suggested = data?.suggested_price;
  const current = currentPrice ?? data?.current_price ?? 0;
  const hasSuggestion = !!data && data.confidence !== "none" && suggested != null;

  const delta =
    hasSuggestion && current > 0
      ? Math.round(((suggested! - current) / current) * 1000) / 10
      : null;
  const direction =
    delta == null || current === 0
      ? "set"
      : Math.abs(delta) < 3
        ? "hold"
        : suggested! > current
          ? "up"
          : "down";

  const vehicleLabel = [data?.year, data?.make, data?.model].filter(Boolean).join(" ");

  useEffect(() => {
    if (open && hasSuggestion && !reasoning && !why.isPending) {
      why.mutate(
        { breakdown: data!, userName: firstName, vehicleLabel },
        { onSuccess: (text) => setReasoning(text) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isCard = variant === "card";

  // ── loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    if (isCard) {
      return (
        <div
          className={cn(
            "rounded-xl border border-[#f1f5f9] dark:border-gray-800 bg-[#f8fafc] dark:bg-gray-800/40 p-4",
            className,
          )}
        >
          <div className="flex items-center gap-2 text-[11px] text-[#737373] dark:text-gray-500">
            <TraxIcon size={16} />
            <Loader2 className="h-3 w-3 animate-spin" /> Trax is reading the market…
          </div>
        </div>
      );
    }
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] text-[#737373] dark:text-gray-500",
          className,
        )}
      >
        <TraxIcon size={14} />
        <Loader2 className="h-3 w-3 animate-spin" /> Trax is checking the market…
      </span>
    );
  }

  // ── no confident suggestion ───────────────────────────────────────────────
  if (!hasSuggestion) {
    if (!showEmpty) return null;
    const text =
      "Not enough comparable vehicles on the network yet for a confident suggestion.";
    if (isCard) {
      return (
        <div
          className={cn(
            "rounded-xl border border-dashed border-[#e5e7eb] dark:border-gray-800 bg-[#fafafa] dark:bg-gray-800/30 p-4",
            className,
          )}
        >
          <div className="flex items-start gap-2 text-[11px] leading-relaxed text-[#737373] dark:text-gray-500">
            <TraxIcon size={16} />
            <span>
              {label ? <span className="font-medium text-[#404040] dark:text-gray-300">{label}: </span> : null}
              {text}
            </span>
          </div>
        </div>
      );
    }
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] text-[#737373] dark:text-gray-500",
          className,
        )}
      >
        <TraxIcon size={14} />
        {text}
      </span>
    );
  }

  const DirIcon = direction === "down" ? TrendingDown : TrendingUp;
  const dirColor =
    direction === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : direction === "down"
        ? "text-amber-600 dark:text-amber-400"
        : "text-[#737373] dark:text-gray-400";
  const dirChip =
    direction === "up"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
      : direction === "down"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";

  const comps = data!.comps!;
  const util = data!.utilization!;

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md dark:bg-gray-900 dark:border-gray-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#080812] dark:text-gray-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm">
              <TraxIcon size={16} color="#ffffff" />
            </span>
            Trax pricing suggestion
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-baseline gap-2 tabular-nums">
          {direction !== "hold" && (
            <span className="text-sm text-[#737373] dark:text-gray-500 line-through">
              {money(current)}
            </span>
          )}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-2xl font-semibold text-transparent dark:from-indigo-400 dark:to-violet-400">
            {money(suggested)}
            <span className="text-xs font-normal text-[#737373] dark:text-gray-500">
              {TIER_LABEL[tier]}
            </span>
          </span>
          {delta != null && direction !== "hold" && (
            <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", dirColor)}>
              <DirIcon className="h-3.5 w-3.5" />
              {delta > 0 ? "+" : ""}
              {delta}%
            </span>
          )}
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
              CONFIDENCE_STYLE[data!.confidence],
            )}
          >
            {data!.confidence} confidence
          </span>
        </div>

        <div className="rounded-md bg-[#f8fafc] dark:bg-gray-800/50 px-3 py-2.5 text-[13px] leading-relaxed text-[#404040] dark:text-gray-300 min-h-[3rem]">
          {why.isPending && !reasoning ? (
            <span className="inline-flex items-center gap-2 text-[#737373] dark:text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Trax is writing…
            </span>
          ) : (
            reasoning ||
            "Here's how this price compares to the network and this vehicle's recent activity."
          )}
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="font-medium text-[#080812] dark:text-gray-200">How I worked this out</div>
          <FactorRow
            label="Network comparables"
            value={`${comps.count} ${MATCH_LABEL[data!.tier_used ?? ""] ?? "comparable vehicles"}`}
          />
          <FactorRow
            label={`Network ${tier} range`}
            value={`${money(comps.p25)} – ${money(comps.p75)} (median ${money(comps.median)})`}
          />
          <FactorRow
            label="This vehicle's use (90d)"
            value={
              util.level === "unknown"
                ? "No rental history yet"
                : `${util.booked_days_90d}/90 days booked (${Math.round(util.ratio * 100)}%) — ${util.level}`
            }
          />
        </div>

        <p className="text-[11px] leading-relaxed text-[#737373] dark:text-gray-500">
          Trax suggestions are guidance based on anonymised pricing across the
          Drive247 network and this vehicle's recent activity — not a guarantee.
          You always set the final price.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="text-xs">
            Close
          </Button>
          {onImplement && direction !== "hold" && (
            <Button
              onClick={() => {
                onImplement(suggested!);
                setOpen(false);
              }}
              className="bg-gradient-to-r from-indigo-600 to-violet-600 text-xs text-white hover:from-indigo-500 hover:to-violet-500"
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Implement {money(suggested)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ── premium card variant ──────────────────────────────────────────────────
  if (isCard) {
    return (
      <>
        <div
          className={cn(
            "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-[#f1f5f9] bg-white p-5 transition-all hover:border-[#e2e8f0] hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700",
            className,
          )}
        >
          {/* header */}
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-500/10">
                <TraxIcon size={16} />
              </span>
              <span className="text-[15px] font-semibold text-[#080812] dark:text-gray-100">
                {label ?? tier}
              </span>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                CONFIDENCE_STYLE[data!.confidence],
              )}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {data!.confidence}
            </span>
          </div>

          {/* price */}
          <div className="relative mt-4 flex items-end gap-2 tabular-nums">
            <span className="text-[34px] font-bold leading-none tracking-tight text-[#080812] dark:text-gray-50">
              {money(suggested)}
            </span>
            <span className="pb-0.5 text-xs text-[#737373] dark:text-gray-500">
              {TIER_LABEL[tier]}
            </span>
            <span className="ml-auto">
              {direction === "hold" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <Check className="h-2.5 w-2.5" /> Aligned
                </span>
              ) : (
                delta != null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      dirChip,
                    )}
                  >
                    <DirIcon className="h-3 w-3" />
                    {delta > 0 ? "+" : ""}
                    {delta}%
                  </span>
                )
              )}
            </span>
          </div>

          {/* stat cells — clean, no mid-number wrapping */}
          <div className="relative mt-4 grid grid-cols-3 gap-2 border-t border-indigo-100/70 pt-3 dark:border-gray-800">
            {direction !== "hold" ? (
              <Stat label="Was" value={money(current)} strike />
            ) : (
              <Stat label="Your rate" value={money(current)} />
            )}
            <Stat label="Network median" value={money(comps.median)} />
            <Stat label="Comparables" value={String(comps.count)} />
          </div>

          {/* actions */}
          <div className="relative mt-4 flex items-center gap-3 pt-1">
            {onImplement && direction !== "hold" && (
              <Button
                size="sm"
                onClick={() => onImplement(suggested!)}
                className="h-8 bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 text-xs font-medium text-white shadow-sm shadow-indigo-500/30 hover:from-indigo-500 hover:to-violet-500"
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Apply {money(suggested)}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              <Sparkles className="h-3 w-3" /> Why this price?
            </button>
          </div>
        </div>
        {dialog}
      </>
    );
  }

  // ── inline variant ──────────────────────────────────────────────────────
  return (
    <>
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs",
          className,
        )}
      >
        <TraxIcon size={15} />
        {direction !== "hold" && (
          <span className="text-[#737373] dark:text-gray-500 line-through tabular-nums">
            {money(current)}
          </span>
        )}
        <span className="font-semibold text-[#080812] dark:text-gray-100 tabular-nums">
          {money(suggested)}
          <span className="font-normal text-[10px] text-[#737373] dark:text-gray-500">
            {TIER_LABEL[tier]}
          </span>
        </span>
        {direction !== "hold" && delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", dirColor)}>
            <DirIcon className="h-3 w-3" />
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
        <span className="text-[#737373] dark:text-gray-400">
          {direction === "hold"
            ? `${firstName}, your price looks well-aligned.`
            : `${firstName}, here's my suggestion.`}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Why?
        </button>
      </span>
      {dialog}
    </>
  );
}

function Stat({
  label,
  value,
  strike,
}: {
  label: string;
  value: string;
  strike?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide text-[#9ca3af] dark:text-gray-500">
        {label}
      </div>
      <div
        className={cn(
          "truncate text-sm font-semibold tabular-nums text-[#080812] dark:text-gray-200",
          strike && "font-normal text-[#9ca3af] line-through dark:text-gray-500",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FactorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[#737373] dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-[#080812] dark:text-gray-200">
        {value}
      </span>
    </div>
  );
}
