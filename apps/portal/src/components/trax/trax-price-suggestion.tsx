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
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { useTenantHolidays } from "@/hooks/use-tenant-holidays";
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
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  low: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
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
  const { settings: weekendSettings } = useWeekendPricing();
  const { holidays } = useTenantHolidays();
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

  // ── seasonal markups (applied automatically on top of the base at booking) ──
  // Trax's number is a clean BASE — weekend/holiday surcharges stack on top.
  // Surface the resulting FINAL prices so the operator isn't surprised.
  const base = suggested!;
  const weekendPct = Number(weekendSettings?.weekend_surcharge_percent) || 0;
  const seasonalLines: { key: string; label: string; pct: number; final: number; tone: string }[] = [];
  if (weekendPct > 0) {
    seasonalLines.push({
      key: "weekend",
      label: "Weekends",
      pct: weekendPct,
      final: base * (1 + weekendPct / 100),
      tone: "text-amber-600 dark:text-amber-400",
    });
  }
  for (const h of holidays) {
    const hp = Number(h.surcharge_percent) || 0;
    if (hp > 0) {
      seasonalLines.push({
        key: `holiday-${h.id ?? h.name}`,
        label: h.name,
        pct: hp,
        final: base * (1 + hp / 100),
        tone: "text-orange-600 dark:text-orange-400",
      });
    }
    if (seasonalLines.length >= 4) break; // weekend + up to 3 holidays
  }
  const holidayLines = seasonalLines.filter((l) => l.key !== "weekend").slice(0, 3);
  const finalLines = [
    ...seasonalLines.filter((l) => l.key === "weekend"),
    ...holidayLines,
  ];

  const seasonalBlock =
    finalLines.length > 0 ? (
      <SeasonalMarkups lines={finalLines} tier={tier} />
    ) : null;

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
            "group relative overflow-hidden rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-white p-4 transition-shadow hover:shadow-[0_0_0_1px_rgba(99,102,241,0.25)] dark:border-indigo-500/20 dark:from-indigo-950/30 dark:via-gray-900 dark:to-gray-900",
            className,
          )}
        >
          {/* ambient glow */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-indigo-400/10 blur-2xl dark:bg-indigo-500/10" />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm">
                <TraxIcon size={15} color="#ffffff" />
              </span>
              <span className="text-sm font-semibold text-[#080812] dark:text-gray-100">
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

          <div className="relative mt-3 flex flex-wrap items-end gap-x-2 gap-y-1 tabular-nums">
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-3xl font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-300">
              {money(suggested)}
            </span>
            <span className="pb-1 text-xs text-[#737373] dark:text-gray-500">
              {TIER_LABEL[tier]}
            </span>
            {direction === "hold" ? (
              <span className="mb-0.5 ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                <Check className="h-2.5 w-2.5" /> Well aligned
              </span>
            ) : (
              delta != null && (
                <span
                  className={cn(
                    "mb-0.5 ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    dirChip,
                  )}
                >
                  <DirIcon className="h-3 w-3" />
                  {delta > 0 ? "+" : ""}
                  {delta}%
                </span>
              )
            )}
          </div>

          {/* the substance — real insight, not filler */}
          <div className="relative mt-1 text-[11px] leading-relaxed text-[#737373] dark:text-gray-500">
            {direction !== "hold" && (
              <>
                was{" "}
                <span className="line-through">{money(current)}</span>
                <span className="px-1">·</span>
              </>
            )}
            {comps.count} similar {comps.count === 1 ? "vehicle" : "vehicles"} on the network
            <span className="px-1">·</span>
            median {money(comps.median)}
          </div>

          {seasonalBlock && <div className="relative">{seasonalBlock}</div>}

          <div className="relative mt-3 flex items-center gap-2">
            {onImplement && direction !== "hold" && (
              <Button
                size="sm"
                onClick={() => onImplement(suggested!)}
                className="h-7 bg-gradient-to-r from-indigo-600 to-violet-600 px-3 text-[11px] text-white hover:from-indigo-500 hover:to-violet-500"
              >
                <Check className="mr-1 h-3 w-3" /> Apply {money(suggested)}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
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
    <div className={cn("inline-block", className)}>
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs",
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
      {seasonalBlock}
      {dialog}
    </div>
  );
}

function SeasonalMarkups({
  lines,
  tier,
}: {
  lines: { key: string; label: string; pct: number; final: number; tone: string }[];
  tier: TraxTier;
}) {
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed">
      <div className="font-medium text-foreground">With your seasonal markups</div>
      <div className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <div key={l.key} className="flex items-baseline justify-between gap-2 tabular-nums">
            <span className="truncate text-muted-foreground">
              <span className={cn("font-medium", l.tone)}>{l.label}</span>{" "}
              (+{l.pct}%)
            </span>
            <span className="shrink-0 font-semibold text-foreground">
              {money(l.final)}
              <span className="font-normal text-muted-foreground">{TIER_LABEL[tier]}</span>
            </span>
          </div>
        ))}
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
